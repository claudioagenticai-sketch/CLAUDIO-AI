// /api/mcp/* — what the /connect and /confirm pages call (wallet session cookie), plus the confirm-page API for
// prepared trades / launches (the unguessable id is the capability; signing still needs the user's own wallet).
//
//   GET    /api/mcp/connections            connected apps (OAuth grants) + MCP keys + watchlist sharing
//   POST   /api/mcp/keys                   create an MCP key (shown once)        DELETE /api/mcp/keys/:id
//   DELETE /api/mcp/grants/:id             disconnect an app (revokes its tokens)
//   PUT    /api/mcp/watchlist  { keys }    share the browser watchlist           DELETE /api/mcp/watchlist
//   GET    /api/mcp/prepared/:id           what /confirm/:id shows
//   POST   /api/mcp/prepared/:id/result    { signatures, mint?, launchId?, error? } after the wallet signed
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { audit, getSession, hit } from "../auth";
import { agentBySlug, q as agentQ } from "../agents/store";
import { McpError, SCOPES, createKey, effectiveStatus, getPrepared, getWatchlist, q, revokeGrant, revokeKey, setWatchlist, updatePrepared, type PreparedRow } from "./store";
import { baseUrl } from "./oauth";

const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function send(res: Response, e: unknown): void {
  if (e instanceof McpError) return void res.status(e.status).json({ error: e.code, message: e.message });
  if (e instanceof z.ZodError) return void res.status(400).json({ error: "bad_request", message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
  console.error("[mcp] manage:", (e as Error)?.message ?? e);
  res.status(500).json({ error: "internal", message: "Something went wrong" });
}

async function wallet(req: Request): Promise<string> {
  const s = await getSession(req);
  if (!s) throw new McpError(401, "sign_in_required", "Sign in with your wallet first");
  const o = req.get("origin");
  if (req.method !== "GET" && o && o !== baseUrl(req) && o !== `${req.protocol}://${req.get("host")}`) throw new McpError(403, "bad_origin", "Cross-site request refused");
  return s.wallet;
}

async function agentSlugs(ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await agentQ<{ id: string; slug: string }>(`SELECT id, slug FROM agents WHERE id = ANY($1)`, [list]);
  return new Map(rows.map((r) => [r.id, r.slug]));
}

async function ownedAgentId(slug: unknown, owner: string): Promise<string> {
  const a = typeof slug === "string" && slug ? await agentBySlug(slug).catch(() => undefined) : undefined;
  if (!a || a.ownerWallet !== owner) throw new McpError(400, "agent_required", "Pick one of your agents to post as, or untick posting.");
  if (a.status !== "active") throw new McpError(400, "agent_inactive", `That agent is ${a.status}.`);
  return a.id;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export function preparedView(p: PreparedRow) {
  return {
    id: p.id,
    kind: p.kind,
    status: effectiveStatus(p),
    wallet: p.wallet,
    createdAt: iso(p.created_at),
    expiresAt: iso(p.expires_at),
    clientName: p.client_name,
    params: p.params,
    summary: p.summary,
    signatures: p.signatures ?? [],
    mint: p.mint,
    error: p.error,
  };
}

const KeyBody = z.object({
  name: z.string().trim().min(1).max(40),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  agentSlug: z.string().max(64).optional(),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.literal(0)]).default(90),
});
const WatchBody = z.object({ keys: z.array(z.string().regex(/^sol:[1-9A-HJ-NP-Za-km-z]{32,44}$/)).max(200) });
const ResultBody = z.object({
  signatures: z.array(z.string().regex(SIG)).max(8).default([]),
  mint: z.string().regex(SOL).optional(),
  launchId: z.string().max(80).optional(),
  error: z.string().max(300).optional(),
});

export function registerManageRoutes(app: Express): void {
  app.get("/api/mcp/connections", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const w = await wallet(req);
      const [grants, keys, watch] = await Promise.all([
        q(`SELECT id, client_id, client_name, scopes, agent_id, created_at, last_used_at FROM mcp_grants WHERE wallet = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`, [w]),
        q(`SELECT id, name, prefix, scopes, agent_id, created_at, last_used_at, expires_at FROM mcp_keys WHERE wallet = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC`, [w]),
        getWatchlist(w),
      ]);
      const slugs = await agentSlugs([...grants.map((g) => g.agent_id), ...keys.map((k) => k.agent_id)]).catch(() => new Map<string, string>());
      res.json({
        wallet: w,
        grants: grants.map((g) => ({ id: g.id, clientId: g.client_id, clientName: g.client_name, scopes: g.scopes, agentSlug: g.agent_id ? slugs.get(g.agent_id) ?? null : null, createdAt: iso(g.created_at), lastUsedAt: iso(g.last_used_at) })),
        keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, agentSlug: k.agent_id ? slugs.get(k.agent_id) ?? null : null, createdAt: iso(k.created_at), lastUsedAt: iso(k.last_used_at), expiresAt: iso(k.expires_at) })),
        watchlistShared: watch !== null,
        watchlistCount: watch?.length ?? 0,
      });
    } catch (e) {
      send(res, e);
    }
  });

  app.post("/api/mcp/keys", async (req, res) => {
    try {
      const w = await wallet(req);
      if (!hit(`mcp-key:${w}`, 10, 3600_000)) throw new McpError(429, "rate_limited", "Too many new keys; try again later");
      const b = KeyBody.parse(req.body ?? {});
      const scopes = SCOPES.filter((s) => s === "read" || b.scopes.includes(s));
      const agentId = scopes.includes("thread:write") ? await ownedAgentId(b.agentSlug, w) : null;
      const k = await createKey({ wallet: w, name: b.name, scopes, agent_id: agentId, expires_at: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86_400_000) : null });
      audit({ actor: w, action: "mcp.key_created", target: k.id, ip: req.ip, detail: { scopes } });
      res.status(201).json({ ...k, agentSlug: agentId ? b.agentSlug : null });
    } catch (e) {
      send(res, e);
    }
  });

  app.delete("/api/mcp/keys/:id", async (req, res) => {
    try {
      const w = await wallet(req);
      if (!(await revokeKey(String(req.params.id), w))) throw new McpError(404, "not_found", "No such key");
      audit({ actor: w, action: "mcp.key_revoked", target: String(req.params.id), ip: req.ip });
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  app.delete("/api/mcp/grants/:id", async (req, res) => {
    try {
      const w = await wallet(req);
      if (!(await revokeGrant(String(req.params.id), w))) throw new McpError(404, "not_found", "No such connection");
      audit({ actor: w, action: "mcp.grant_revoked", target: String(req.params.id), ip: req.ip });
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  app.put("/api/mcp/watchlist", async (req, res) => {
    try {
      const w = await wallet(req);
      if (!hit(`mcp-watch:${w}`, 60, 60_000)) throw new McpError(429, "rate_limited", "Too many updates");
      const b = WatchBody.parse(req.body ?? {});
      const keys = [...new Set(b.keys)];
      await setWatchlist(w, keys);
      res.json({ ok: true, count: keys.length });
    } catch (e) {
      send(res, e);
    }
  });

  app.delete("/api/mcp/watchlist", async (req, res) => {
    try {
      await setWatchlist(await wallet(req), null);
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  app.get("/api/mcp/prepared/:id", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      if (!hit(`mcp-prep-get:${req.ip}`, 120, 60_000)) throw new McpError(429, "rate_limited", "Too many requests");
      const p = await getPrepared(String(req.params.id));
      if (!p) throw new McpError(404, "not_found", "Nothing to confirm here. Ask your assistant to prepare it again.");
      res.json(preparedView(p));
    } catch (e) {
      send(res, e);
    }
  });

  app.post("/api/mcp/prepared/:id/result", async (req, res) => {
    try {
      if (!hit(`mcp-prep-res:${req.ip}`, 30, 60_000)) throw new McpError(429, "rate_limited", "Too many requests");
      const b = ResultBody.parse(req.body ?? {});
      const p = await getPrepared(String(req.params.id));
      if (!p) throw new McpError(404, "not_found", "Unknown or expired");
      if (p.status !== "pending") throw new McpError(409, "not_pending", `This is already ${p.status}.`);
      // Signing must start inside the 2 minutes (the page refuses after that); results may land a little later.
      const status = b.signatures.length ? "signed" : "failed";
      const row = await updatePrepared(p.id, { status, signatures: b.signatures, mint: b.mint ?? null, error: b.error ?? (b.signatures.length ? null : "Not signed"), touch: "signed" }, "pending");
      if (!row) throw new McpError(409, "expired", "The 2-minute window closed before this arrived.");
      audit({ actor: p.wallet, action: "mcp.prepared_result", target: p.id, ip: req.ip, detail: { kind: p.kind, status, n: b.signatures.length } });
      res.json({ status: row.status });
    } catch (e) {
      send(res, e);
    }
  });
}
