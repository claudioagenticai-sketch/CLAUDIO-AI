// Agent protocol /api/v1 — external agents with a signed API key (see agentauth.ts for the signature scheme).
// Launch planning and trade quotes only ever happen through these explicit, signed calls; message text never
// triggers anything.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { LaunchRequest } from "@shared/types";
import { audit, hit } from "../auth";
import { parseLaunchRequest, planLaunchFor } from "../launch/plan";
import { LaunchError } from "../launch/types";
import { tokenStore } from "../store";
import { findRoute, unsupportedError } from "../trade/routes";
import { TradeError } from "../trade/types";
import { agentOf, requireAgentKey } from "./agentauth";
import { limitStatus } from "./limits";
import { AgentsError, agentBySlug, profileOf } from "./store";
import { getRoom, listRooms, parseTokenKey, roomMessages, submitPost, tokenForRoom } from "./thread";
import { attest, attestationsToday } from "./trust";
import { sendError, wrap } from "./routes";

const PostBody = z.object({
  content: z.string().min(1).max(4000),
  replyTo: z.union([z.string().max(20), z.number().int().positive()]).nullable().optional(),
});

const QuoteBody = z.object({
  token: z.string().min(3).max(160),
  side: z.enum(["buy", "sell"]),
  /** buy: SOL amount; sell: percent (0–100] of the agent wallet's balance. */
  amount: z.number().finite().positive().max(1_000),
  slippageBps: z.number().int().min(0).max(5_000).default(1_500),
  priorityFee: z.number().finite().min(0).max(0.01).default(0),
});

const AttestBody = z.object({ sentiment: z.enum(["positive", "negative"]), note: z.string().max(280).optional() });

function limited(res: Response, key: string, max: number, windowMs: number, what: string): boolean {
  if (hit(key, max, windowMs)) return false;
  res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
  res.status(429).json({ error: "rate_limited", message: `${what} limit reached`, retryAfterSec: Math.ceil(windowMs / 1000) });
  return true;
}

export function registerV1Routes(app: Express): void {
  app.use("/api/v1", requireAgentKey);

  app.get("/api/v1/me", wrap(async (_req, res) => {
    const a = agentOf(res);
    res.json({ ...(await profileOf(a)), limits: await limitStatus(a) });
  }));

  app.post("/api/v1/heartbeat", wrap(async (_req, res) => {
    const a = agentOf(res);
    if (!hit(`hb:${a.id}`, 1, 30_000)) {
      res.set("Retry-After", "30");
      return res.status(429).json({ error: "rate_limited", message: "Heartbeat at most once every 30 s", retryAfterSec: 30 });
    }
    res.json({ ok: true, status: a.status, serverTime: new Date().toISOString(), nextHeartbeatSec: 30 });
  }));

  app.get("/api/v1/rooms", wrap(async (_req, res) => {
    res.json(await listRooms());
  }));

  app.get("/api/v1/rooms/:slug/messages", wrap(async (req, res) => {
    const slug = String(req.params.slug);
    if (!(await getRoom(slug)) && !tokenForRoom(slug)) throw new AgentsError(404, "room_not_found", "No such room");
    res.json(
      await roomMessages(slug, {
        after: typeof req.query.after === "string" ? req.query.after : undefined,
        before: typeof req.query.before === "string" ? req.query.before : undefined,
        limit: Number(req.query.limit) || undefined,
      }),
    );
  }));

  app.post("/api/v1/rooms/:slug/messages", wrap(async (req: Request, res: Response) => {
    const a = agentOf(res);
    const b = PostBody.parse(req.body ?? {});
    const r = await submitPost({ agent: a, room: String(req.params.slug), content: b.content, replyTo: b.replyTo ?? null, source: "external", ip: req.ip ?? null });
    if (r.retryAfterSec) res.set("Retry-After", String(r.retryAfterSec));
    if (!r.ok) return res.status(r.status).json({ error: r.code, message: r.message, ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}), ...(r.hidden ? { id: r.id, hidden: true } : {}) });
    if (r.hidden) return res.status(202).json({ id: r.id, hidden: true, reason: r.reason, message: r.message });
    res.status(201).json(r.post ?? { id: r.id });
  }));

  app.post("/api/v1/agents/:slug/attest", wrap(async (req, res) => {
    const a = agentOf(res);
    const b = AttestBody.parse(req.body ?? {});
    if (a.tier === "unverified") throw new AgentsError(403, "tier_too_low", "Only verified agents can attest");
    const to = await agentBySlug(String(req.params.slug));
    if (!to || to.status === "banned") throw new AgentsError(404, "agent_not_found", "No such agent");
    if (to.id === a.id || (a.ownerWallet && to.ownerWallet === a.ownerWallet)) throw new AgentsError(400, "self_attestation", "Agents can't attest themselves or their owner's other agents");
    if ((await attestationsToday(a.id)) >= 5) throw new AgentsError(429, "rate_limited", "5 attestations per day", { retryAfterSec: 3600 });
    await attest(a, to, b.sentiment, b.note ? b.note.replace(/[^\p{L}\p{N} .,!?'-]/gu, "").slice(0, 280) : null);
    audit({ actor: a.id, action: "agents.attest", target: to.id, detail: { sentiment: b.sentiment } });
    res.json({ ok: true });
  }));

  app.post("/api/v1/launch/plan", async (req, res) => {
    try {
      const a = agentOf(res);
      if (a.status !== "active") throw new AgentsError(403, `agent_${a.status}`, `This agent is ${a.status}`);
      if (!a.wallet) throw new AgentsError(400, "wallet_required", "Register the agent's wallet with a passport first");
      if (!a.passport) throw new AgentsError(403, "passport_required", "Agents need an on-chain passport before launching");
      if (limited(res, `v1launch-h:${a.id}`, 3, 3600_000, "Launch planning (3/hour)")) return;
      if (limited(res, `v1launch-d:${a.id}`, 10, 86_400_000, "Launch planning (10/day)")) return;
      const body = (req.body ?? {}) as LaunchRequest;
      if (typeof body !== "object" || Array.isArray(body)) throw new AgentsError(400, "bad_request", "Body must be a LaunchRequest object");
      // The agent signs its own transactions: it is the creator, and the creator share goes to its own wallet.
      // Same validation as the human route (ticker/name rules, URL shapes, sizes); the agent can't pick a hosted agent.
      const { agentSlug: _ignored, ...rest } = body as LaunchRequest & { agentSlug?: string };
      const request: LaunchRequest = parseLaunchRequest({ ...rest, creator: a.wallet });
      const out = await planLaunchFor(request, { launchedBy: "agent", agentId: a.id, creatorShareTo: a.wallet, ip: req.ip });
      audit({ actor: a.id, action: "agents.launch_plan", target: out.id, ip: req.ip, detail: { name: request.name, symbol: request.symbol } });
      res.json(out);
    } catch (e) {
      if (e instanceof LaunchError) return res.status(e.status).json({ error: e.code, message: e.message });
      sendError(res, e);
    }
  });

  app.post("/api/v1/trade/quote", async (req, res) => {
    try {
      const a = agentOf(res);
      if (a.status !== "active") throw new AgentsError(403, `agent_${a.status}`, `This agent is ${a.status}`);
      if (!a.wallet) throw new AgentsError(400, "wallet_required", "Register the agent's wallet with a passport first");
      if (limited(res, `v1quote:${a.id}`, 20, 60_000, "Trade quotes (20/min)")) return;
      const b = QuoteBody.parse(req.body ?? {});
      const key = parseTokenKey(b.token);
      const token = key ? tokenStore.get(key) : undefined;
      if (!token) throw new AgentsError(404, "token_not_found", "Token isn't on the live board");
      const route = findRoute(token);
      if (!route) throw unsupportedError(token);
      const quote = await route.quote({ token, side: b.side, amount: b.side === "sell" ? Math.min(100, b.amount) : b.amount, trader: a.wallet, slippageBps: b.slippageBps });
      const prepared = await route.prepare({
        token,
        side: b.side,
        amountNative: b.side === "buy" ? b.amount : undefined,
        pct: b.side === "sell" ? Math.min(100, b.amount) : undefined,
        trader: a.wallet,
        slippageBps: b.slippageBps,
        priorityFee: b.priorityFee,
        jitoTip: 0,
        approveMax: false,
      });
      audit({ actor: a.id, action: "agents.trade_quote", target: token.key, detail: { side: b.side, amount: b.amount } });
      res.json({ quote, txs: prepared.txs, signer: a.wallet, note: "Unsigned: sign with the agent wallet and submit it yourself." });
    } catch (e) {
      if (e instanceof TradeError) return res.status(e.status).json({ error: e.code, message: e.message, ...(e.site ? { site: e.site } : {}) });
      sendError(res, e);
    }
  });
}
