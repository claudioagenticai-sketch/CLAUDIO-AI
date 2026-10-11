// Trade REST API. The server only builds UNSIGNED transactions + quotes; signing happens in the browser.
//
//   GET  /api/trade/route/:key            → RouteInfo (is this token tradable here, and how)
//   GET  /api/trade/balance/:key?owner=…  → { balance: number } (human token units)
//   POST /api/trade/quote    { key, side, amount, trader?, slippageBps? }   → TradeQuoteEx
//        amount: buy = native (ETH/SOL/BNB); sell = percent (0–100] of `trader`'s balance.
//   POST /api/trade/prepare  { key, side, amountNative | pct, trader, slippageBps, priorityFee, jitoTip, approveMax? }
//        → { txs: PreparedTx[], quote: TradeQuoteEx }
//
// Errors: `{ error: code, message, site? }` — 501 route_unsupported carries the launchpad site to link to.

import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { tokenStore } from "../store";
import { tokenBalance } from "../trade/balance";
import { findRoute, routeInfo, unsupportedError } from "../trade/routes";
import { TradeError } from "../trade/types";
import type { TokenSnapshot } from "@shared/types";

const Key = z.string().min(3).max(160);
const Side = z.enum(["buy", "sell"]);
const Trader = z.string().min(20).max(64);

const QuoteBody = z.object({
  key: Key,
  side: Side,
  amount: z.number().finite().positive().max(1_000_000),
  trader: Trader.optional(),
  slippageBps: z.number().int().min(0).max(9_900).default(1_500),
});

const PrepareBody = z
  .object({
    key: Key,
    side: Side,
    amountNative: z.number().finite().positive().max(1_000_000).optional(),
    pct: z.number().finite().gt(0).max(100).optional(),
    trader: Trader,
    slippageBps: z.number().int().min(0).max(9_900),
    priorityFee: z.number().finite().min(0).max(1_000).default(0), // SOL (svm) or extra gwei (evm); routes clamp
    jitoTip: z.number().finite().min(0).max(1).default(0),
    approveMax: z.boolean().default(false),
  })
  .refine((b) => (b.side === "buy" ? b.amountNative !== undefined : b.pct !== undefined), {
    message: "buy needs amountNative; sell needs pct",
  });

// ─── tiny per-IP rate limit (protects public RPCs and PumpPortal) ───
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 40;
const hits = new Map<string, { n: number; reset: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
    if (hits.size > 5_000) {
      hits.forEach((v, k) => {
        if (v.reset < now) hits.delete(k);
      });
    }
    next();
    return;
  }
  h.n += 1;
  if (h.n > MAX_PER_WINDOW) {
    res.status(429).json({ error: "rate_limited", message: "Too many trade requests — slow down a moment." });
    return;
  }
  next();
}

function tokenOr404(key: string): TokenSnapshot {
  const token = tokenStore.get(key);
  if (!token) throw new TradeError(404, "token_not_found", "Token isn't indexed yet. Try again in a moment.");
  return token;
}

function sendError(res: Response, e: unknown): void {
  if (e instanceof TradeError) {
    res.status(e.status).json({ error: e.code, message: e.message, ...(e.site ? { site: e.site } : {}) });
    return;
  }
  if (e instanceof z.ZodError) {
    res.status(400).json({ error: "bad_request", message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  // viem errors are verbose; keep the first line.
  res.status(502).json({ error: "upstream", message: msg.split("\n")[0].slice(0, 300) });
}

export function registerTradeRoutes(app: Express): void {
  app.get("/api/trade/route/:key", (req, res) => {
    try {
      const token = tokenOr404(Key.parse(req.params.key));
      res.json(routeInfo(token));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/trade/balance/:key", rateLimit, async (req, res) => {
    try {
      const token = tokenOr404(Key.parse(req.params.key));
      const owner = Trader.parse(req.query.owner);
      const balance = await tokenBalance(token, owner);
      res.json({ balance });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/trade/quote", rateLimit, async (req, res) => {
    try {
      const body = QuoteBody.parse(req.body);
      const token = tokenOr404(body.key);
      const route = findRoute(token);
      if (!route) throw unsupportedError(token);
      const quote = await route.quote({
        token,
        side: body.side,
        amount: body.side === "sell" ? Math.min(100, body.amount) : body.amount,
        trader: body.trader,
        slippageBps: body.slippageBps,
      });
      res.json(quote);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/trade/prepare", rateLimit, async (req, res) => {
    try {
      const body = PrepareBody.parse(req.body);
      const token = tokenOr404(body.key);
      const route = findRoute(token);
      if (!route) throw unsupportedError(token);
      const prepared = await route.prepare({
        token,
        side: body.side,
        amountNative: body.amountNative,
        pct: body.pct,
        trader: body.trader,
        slippageBps: body.slippageBps,
        priorityFee: body.priorityFee,
        jitoTip: body.jitoTip,
        approveMax: body.approveMax,
      });
      res.json(prepared);
    } catch (e) {
      sendError(res, e);
    }
  });
}
