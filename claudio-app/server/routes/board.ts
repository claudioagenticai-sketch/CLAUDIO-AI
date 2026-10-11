// Board / token / market-data REST endpoints backed by the in-memory TokenStore.
//   GET /api/board?chain=&phase=&limit=   → TokenSnapshot[]
//   GET /api/token/:key                   → TokenDetail (unknown → on-demand GMGN lookup, ≤ 2.5 s; still unknown → 404)
//   GET /api/candles/:key?res=&limit=     → Candle[] (res ∈ 15|60|300|900|3600, default 60; thin → GMGN kline backfill)
//   GET /api/trades/:key?limit=           → Trade[] (newest first)
//   GET /api/search?q=&limit=             → TokenSnapshot[] (our index first, then GMGN search results)
//   GET /api/status                       → ChainStatus[] (+ detail / sources)
// Simple token-bucket rate limit per IP (20 req/s sustained, burst 40).

import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { tokenStore } from "../store";
import { hubStats } from "../hub";
import { backfillCandles, lookupToken, noteViewer, searchGmgn } from "../insights";

const chainSchema = z.enum(["sol", "hood", "bsc", "base", "arc"]);
const phaseSchema = z.enum(["new", "almost", "migrated"]);

const boardQuery = z.object({
  chain: chainSchema,
  phase: phaseSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
const candleQuery = z.object({
  res: z.coerce.number().int().refine((v) => [15, 60, 300, 900, 3600].includes(v), "res must be 15|60|300|900|3600").optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });
const searchQuery = z.object({ q: z.string().trim().min(1).max(128), limit: z.coerce.number().int().min(1).max(50).optional() });

// ─── Rate limit ─────────────────────────────────────────────────────

const RATE = 20; // tokens per second
const BURST = 40;
const buckets = new Map<string, { tokens: number; at: number }>();

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60_000).unref();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = typeof fwd === "string" ? fwd.split(",")[0].trim() : "";
  return first || req.socket.remoteAddress || "unknown";
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = clientIp(req);
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: BURST, at: now };
    buckets.set(ip, b);
  }
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE);
  b.at = now;
  if (b.tokens < 1) {
    res.setHeader("Retry-After", "1");
    res.status(429).json({ message: "Too many requests" });
    return;
  }
  b.tokens -= 1;
  next();
}

function keyParam(req: Request): string | null {
  const raw = req.params.key;
  if (typeof raw !== "string" || !raw || raw.length > 200) return null;
  let key = raw;
  try {
    // Express already decodes path params once; decode again only if still encoded (e.g. "hood%3A0x…").
    if (/%[0-9a-f]{2}/i.test(key)) key = decodeURIComponent(key);
  } catch {
    return null;
  }
  return key.includes(":") ? key : null;
}

/** Express 4 doesn't catch async handler rejections. */
function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      console.error("[board] route failed:", e instanceof Error ? e.message : e);
      if (!res.headersSent) res.status(500).json({ message: "internal error" });
    });
  };
}

/** A series with fewer candles than this gets a GMGN kline backfill. */
const THIN_SERIES = 30;

function bad(res: Response, err: z.ZodError): void {
  res.status(400).json({ message: err.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; ") });
}

export function registerBoardRoutes(app: Express): void {
  app.get("/api/board", rateLimit, (req, res) => {
    const q = boardQuery.safeParse(req.query);
    if (!q.success) return bad(res, q.error);
    noteViewer();
    res.setHeader("Cache-Control", "no-store");
    res.json(tokenStore.list(q.data.chain, q.data.phase, q.data.limit ?? 300));
  });

  app.get(
    "/api/token/:key",
    rateLimit,
    wrap(async (req, res) => {
      const key = keyParam(req);
      if (!key) return void res.status(400).json({ message: "bad token key (expected <chain>:<address>)" });
      noteViewer();
      // Unknown → on-demand lookup (GMGN token/info, ≤ 2.5 s). GMGN can't answer → 404 (the page retries).
      if (!tokenStore.has(key)) await lookupToken(key);
      else tokenStore.touch(key);
      const detail = tokenStore.detail(key);
      if (!detail) return void res.status(404).json({ message: "token not indexed" });
      res.setHeader("Cache-Control", "no-store");
      res.json(detail);
    }),
  );

  app.get(
    "/api/candles/:key",
    rateLimit,
    wrap(async (req, res) => {
      const key = keyParam(req);
      if (!key) return void res.status(400).json({ message: "bad token key" });
      const q = candleQuery.safeParse(req.query);
      if (!q.success) return bad(res, q.error);
      if (!tokenStore.has(key) && !(await lookupToken(key))) return void res.status(404).json({ message: "token not indexed" });
      const resSec = q.data.res ?? 60;
      const limit = q.data.limit ?? 300;
      let out = tokenStore.candles(key, resSec, limit);
      if (out.length < Math.min(limit, THIN_SERIES) && (await backfillCandles(key, resSec, limit)) > 0) out = tokenStore.candles(key, resSec, limit);
      res.setHeader("Cache-Control", "no-store");
      res.json(out);
    }),
  );

  app.get(
    "/api/trades/:key",
    rateLimit,
    wrap(async (req, res) => {
      const key = keyParam(req);
      if (!key) return void res.status(400).json({ message: "bad token key" });
      const q = limitQuery.safeParse(req.query);
      if (!q.success) return bad(res, q.error);
      if (!tokenStore.has(key) && !(await lookupToken(key))) return void res.status(404).json({ message: "token not indexed" });
      res.setHeader("Cache-Control", "no-store");
      res.json(tokenStore.trades(key, q.data.limit ?? 100));
    }),
  );

  app.get(
    "/api/search",
    rateLimit,
    wrap(async (req, res) => {
      const q = searchQuery.safeParse(req.query);
      if (!q.success) return bad(res, q.error);
      const limit = q.data.limit ?? 20;
      const local = tokenStore.search(q.data.q, limit);
      // Our index first; GMGN search (interactive lane, cached 30 s, ≤ 2 s) fills the rest.
      const extra = local.length < limit ? await searchGmgn(q.data.q, new Set(local.map((t) => t.key)), limit - local.length) : [];
      res.setHeader("Cache-Control", "no-store");
      res.json([...local, ...extra]);
    }),
  );

  app.get("/api/status", rateLimit, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Array of ChainStatus (+ `detail`/`sources`), as the client expects; hub/store stats go in headers.
    const hub = hubStats();
    res.setHeader("X-Claudio-Clients", String(hub.clients));
    res.setHeader("X-Claudio-Tokens", String(tokenStore.count()));
    res.json(tokenStore.status());
  });
}
