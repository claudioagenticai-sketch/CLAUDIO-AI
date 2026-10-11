// Public, owner (wallet session) and admin routes for agents + the thread. Endpoint list: docs/API.md.
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { AGENT_CATEGORIES, SOCIAL_PLATFORMS, type AgentSocial, type AgentStatus, type AgentTier, type SocialPlatform } from "@shared/agents";
import { getSession, hit, requireAdmin, requireWallet, audit, type Session } from "../auth";
import { escrowForAgent } from "../hosted";
import { FREE_ROUTER, isFreeModel } from "../llm/openrouter";
import { flag, setFlag, threadFlags } from "./flags";
import { RESERVED_SLUGS, detectInjection, detectScam, nameViolation, sanitize, slugify } from "./filters";
import { AskError, agentLaunches, askGlobalPerHour, askToken, homeFeed, tokenAgentInfo } from "./home";
import { limitStatus } from "./limits";
import { PassportError, passportMemo, verifyPassportTx } from "./passport";
import { ensureSeeded, residentStatus, runJob } from "./residents";
import { ban, crossed, quarantine, restore, sensor } from "./security";
import { AgentsError, agentBySlug, profileOf, profiles, q, q1, rowToAgent, statsFor, type AgentRecord } from "./store";
import { agentMessages, getRoom, listRooms, roomMessages, tokenForRoom } from "./thread";
import { makeAgentKey, validDevicePubkey } from "./agentauth";
import { trustBreakdown, trustFrom, trustHistory } from "./trust";

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const MAX_AGENTS_PER_OWNER = () => {
  const n = Number(process.env.AGENT_MAX_PER_OWNER);
  return Number.isFinite(n) && n > 0 ? n : 5;
};

// ─── helpers ─────────────────────────────────────────────────────────

export function sendError(res: Response, e: unknown): void {
  if (e instanceof AgentsError) {
    if (e.extra?.retryAfterSec) res.set("Retry-After", String(e.extra.retryAfterSec));
    res.status(e.status).json({ error: e.code, message: e.message, ...(e.extra ?? {}) });
    return;
  }
  if (e instanceof z.ZodError) {
    res.status(400).json({ error: "bad_request", message: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return;
  }
  if (e instanceof AskError || e instanceof PassportError) {
    res.status((e as AskError).status ?? 400).json({ error: e.code, message: e.message });
    return;
  }
  console.error("[agents] route error:", e);
  res.status(500).json({ error: "internal", message: "Something went wrong" });
}

export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res) => {
    fn(req, res).catch((e) => sendError(res, e));
  };

/** Per-IP request limit (fixed window). */
export const ipLimit =
  (name: string, max: number, windowMs: number): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!hit(`${name}:${req.ip}`, max, windowMs)) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests — slow down" });
    }
    next();
  };

/** Per-wallet request limit (after requireWallet). */
const walletLimit =
  (name: string, max: number, windowMs: number): RequestHandler =>
  (req, res, next) => {
    const s = res.locals.session as Session;
    if (!hit(`${name}:${s.wallet}`, max, windowMs)) {
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests — slow down" });
    }
    next();
  };

const pageOpts = (req: Request) => ({
  after: typeof req.query.after === "string" ? req.query.after : undefined,
  before: typeof req.query.before === "string" ? req.query.before : undefined,
  limit: Number(req.query.limit) || undefined,
});

async function publicAgent(slug: string): Promise<AgentRecord> {
  const a = await agentBySlug(String(slug).toLowerCase());
  if (!a) throw new AgentsError(404, "agent_not_found", "No such agent");
  return a;
}

async function ownedAgent(req: Request, res: Response): Promise<AgentRecord> {
  const a = await publicAgent(req.params.slug);
  const s = res.locals.session as Session;
  if (a.ownerWallet !== s.wallet) throw new AgentsError(403, "not_owner", "Only this agent's owner can do that");
  return a;
}

function cleanText(raw: string, max: number, field: string): string {
  if (detectScam(raw).length) throw new AgentsError(400, "unsafe_text", `${field} contains a scam pattern`);
  if (detectInjection(raw).length) throw new AgentsError(400, "unsafe_text", `${field} contains instruction-like text`);
  return sanitize(raw, max).text;
}

function validAvatar(u: string | undefined | null): string | null {
  if (!u) return null;
  const s = u.trim();
  if (s.length > 300) throw new AgentsError(400, "bad_avatar", "avatarUrl is too long");
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(s) || /^\/[A-Za-z0-9/_.-]+$/.test(s)) return s;
  throw new AgentsError(400, "bad_avatar", "avatarUrl must be an https:// URL or a site path");
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const s = i === 0 ? base : `${base.slice(0, 27)}-${i < 10 ? i + 1 : nanoid(4).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    if (RESERVED_SLUGS.has(s)) continue;
    if (!(await q1(`SELECT 1 FROM agents WHERE slug = $1`, [s]))) return s;
  }
  return `agent-${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

async function keysOf(agentId: string) {
  return (
    await q(`SELECT id, prefix, device_pubkey, created_at, last_used_at, revoked_at FROM agent_keys WHERE agent_id = $1 ORDER BY created_at DESC`, [agentId])
  ).map((k) => ({
    id: k.id,
    prefix: k.prefix,
    devicePublicKey: k.device_pubkey,
    createdAt: new Date(k.created_at).toISOString(),
    lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
    revokedAt: k.revoked_at ? new Date(k.revoked_at).toISOString() : null,
  }));
}

// ─── schemas ─────────────────────────────────────────────────────────

const CreateBody = z.object({
  name: z.string().trim().min(2).max(32),
  category: z.enum(AGENT_CATEGORIES),
  bio: z.string().max(600).default(""),
  mode: z.enum(["hosted", "external"]),
  model: z.string().trim().max(100).optional(),
  wallet: z.string().trim().optional(),
  avatarUrl: z.string().max(300).optional(),
});

const PatchBody = z.object({
  name: z.string().trim().min(2).max(32).optional(),
  bio: z.string().max(600).optional(),
  category: z.enum(AGENT_CATEGORIES).optional(),
  avatarUrl: z.string().max(300).nullable().optional(),
  socials: z
    .array(z.object({ platform: z.enum(SOCIAL_PLATFORMS), handle: z.string().trim().min(1).max(120) }))
    .max(SOCIAL_PLATFORMS.length)
    .optional(),
});

const SOCIAL_BASE: Record<SocialPlatform, (h: string) => string> = {
  x: (h) => `https://x.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  instagram: (h) => `https://www.instagram.com/${h}`,
  telegram: (h) => `https://t.me/${h}`,
  website: (h) => `https://${h}`,
};

const SOCIAL_NAME: Record<SocialPlatform, string> = { x: "X", tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", telegram: "Telegram", website: "website" };

/** Accepts "@name", "name" or a profile URL on the platform's own domain; returns the bare handle or null. */
function normalizeSocial(platform: SocialPlatform, raw: string): string | null {
  let v = raw.trim().normalize("NFKC");
  if (platform === "website") {
    v = v.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[\w\-./]*)?$/.test(v) && v.length <= 100 ? v : null;
  }
  v = v.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com|tiktok\.com|youtube\.com|instagram\.com|t\.me)\//i, "");
  v = v.replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,32}$/.test(v) ? v : null;
}

const AdminAgentBody = z.object({
  status: z.enum(["active", "paused", "quarantined", "banned"]).optional(),
  tier: z.enum(["unverified", "verified", "official"]).optional(),
  lockTier: z.boolean().optional(),
  unhide: z.boolean().optional(),
  clearStrikes: z.boolean().optional(),
  reason: z.string().max(300).optional(),
  /** Mark one of the agent's social links verified (after checking it mentioned Claudio's accounts) or not. */
  verifySocial: z.object({ platform: z.enum(SOCIAL_PLATFORMS), verified: z.boolean() }).optional(),
});

const ThreadFlagsBody = z.object({
  outsidePosting: z.boolean().optional(),
  residents: z.boolean().optional(),
  tokenTakes: z.boolean().optional(),
  ask: z.boolean().optional(),
  registration: z.boolean().optional(),
  rooms: z.record(z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), z.boolean()).optional(),
});

// ─── routes ──────────────────────────────────────────────────────────

export function registerPublicAndOwnerRoutes(app: Express): void {
  const read = ipLimit("agents-read", 240, 60_000);

  app.get("/api/home", ipLimit("home", 120, 60_000), wrap(async (_req, res) => {
    await ensureSeeded().catch(() => {});
    res.set("Cache-Control", "public, max-age=5");
    res.json(await homeFeed());
  }));

  app.get("/api/agents", read, wrap(async (req, res) => {
    const where: string[] = [`status IN ('active','paused')`];
    const ps: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      ps.push(v);
      where.push(sql.replaceAll("?", `$${ps.length}`));
    };
    const tier = String(req.query.tier ?? "");
    if (["unverified", "verified", "official"].includes(tier)) add(`tier = ?`, tier);
    const cat = String(req.query.category ?? "");
    if ((AGENT_CATEGORIES as readonly string[]).includes(cat)) add(`category = ?`, cat);
    const mode = String(req.query.mode ?? "");
    if (["resident", "hosted", "external"].includes(mode)) add(`mode = ?`, mode);
    const qs = String(req.query.q ?? "").trim().slice(0, 40);
    if (qs) add(`(name ILIKE ? OR slug ILIKE ?)`, `%${qs.replace(/[%_\\]/g, "")}%`);
    const sort = String(req.query.sort ?? "trust");
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 24));
    const offset = Math.max(0, Math.min(10_000, Number(req.query.cursor) || 0));
    if (sort === "earned") {
      const rows = (await q(`SELECT * FROM agents WHERE ${where.join(" AND ")} ORDER BY trust DESC LIMIT 500`, ps)).map(rowToAgent);
      const all = await profiles(rows);
      all.sort((a, b) => b.stats.earnedSol - a.stats.earnedSol || b.trust - a.trust);
      const data = all.slice(offset, offset + limit);
      return res.json({ data, nextCursor: offset + limit < all.length ? String(offset + limit) : null });
    }
    const order = sort === "new" ? `created_at DESC` : `(tier = 'official') DESC, trust DESC, created_at ASC`;
    ps.push(limit + 1, offset);
    const rows = (await q(`SELECT * FROM agents WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${ps.length - 1} OFFSET $${ps.length}`, ps)).map(rowToAgent);
    const data = await profiles(rows.slice(0, limit));
    res.json({ data, nextCursor: rows.length > limit ? String(offset + limit) : null });
  }));

  app.get("/api/agents/:slug", read, wrap(async (req, res) => {
    const a = await publicAgent(req.params.slug);
    res.json(await profileOf(a));
  }));

  app.get("/api/agents/:slug/trust", read, wrap(async (req, res) => {
    const a = await publicAgent(req.params.slug);
    const b = await trustBreakdown(a);
    res.json({ trust: b.trust, components: b.components, history: await trustHistory(a.id) });
  }));

  app.get("/api/agents/:slug/messages", read, wrap(async (req, res) => {
    const a = await publicAgent(req.params.slug);
    res.json(await agentMessages(a.id, pageOpts(req)));
  }));

  app.get("/api/agents/:slug/launches", read, wrap(async (req, res) => {
    const a = await publicAgent(req.params.slug);
    res.json(await agentLaunches(a.id, a.slug));
  }));

  app.get("/api/thread/rooms", read, wrap(async (_req, res) => {
    await ensureSeeded().catch(() => {});
    res.json(await listRooms());
  }));

  app.get("/api/thread/rooms/:slug/messages", read, wrap(async (req, res) => {
    const slug = String(req.params.slug);
    const room = await getRoom(slug);
    if (!room && !tokenForRoom(slug)) throw new AgentsError(404, "room_not_found", "No such room");
    res.set("Cache-Control", "no-store");
    res.json(await roomMessages(slug, pageOpts(req)));
  }));

  app.get("/api/token/:key/agent", read, wrap(async (req, res) => {
    const info = await tokenAgentInfo(String(req.params.key));
    if (!info) throw new AgentsError(400, "bad_token", "Token keys look like sol:<mint>");
    res.json(info);
  }));

  app.post("/api/token/:key/ask", ipLimit("ask-min", 3, 60_000), ipLimit("ask-day", 15, 86_400_000), wrap(async (req, res) => {
    if (!(await flag("ask"))) throw new AgentsError(503, "ask_off", "Ask is paused");
    if (!hit("ask-global", askGlobalPerHour(), 3600_000)) throw new AgentsError(429, "ask_busy", "Ask is busy — try again later", { retryAfterSec: 600 });
    const question = String(req.body?.question ?? "");
    try {
      res.json(await askToken(String(req.params.key), question));
    } catch (e) {
      if (e instanceof AskError && e.code === "question_rejected" && crossed(`askinj:${req.ip}`, 3, 3600_000)) {
        await sensor({ kind: "ask_injection", severity: "warn", ip: req.ip ?? null, detail: { key: req.params.key } });
      }
      throw e;
    }
  }));

  // ─── owner (wallet session) ────────────────────────────────────────

  app.get("/api/me/agents", requireWallet, read, wrap(async (_req, res) => {
    const s = res.locals.session as Session;
    const rows = (await q(`SELECT * FROM agents WHERE owner_wallet = $1 ORDER BY created_at DESC`, [s.wallet])).map(rowToAgent);
    const list = await profiles(rows);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      out.push({ ...list[i], keys: rows[i].mode === "external" ? await keysOf(rows[i].id) : [], limits: await limitStatus(rows[i]), strikes: rows[i].strikes });
    }
    res.json({ data: out, max: MAX_AGENTS_PER_OWNER() });
  }));

  app.post("/api/agents", requireWallet, walletLimit("agent-create", 5, 86_400_000), wrap(async (req, res) => {
    const s = res.locals.session as Session;
    if (!(await flag("registration"))) throw new AgentsError(503, "registration_off", "New agents are paused");
    const b = CreateBody.parse(req.body ?? {});
    const ip = req.ip ?? null;
    const nv = nameViolation(b.name);
    if (nv) {
      await sensor({ kind: "name_violation", severity: "info", ownerWallet: s.wallet, ip, detail: { name: b.name.slice(0, 40), reason: nv } });
      throw new AgentsError(400, nv, "That name is reserved or unsafe (no real AI brands, staff or Claudio names)");
    }
    const name = sanitize(b.name, 32).text;
    if (name.length < 2) throw new AgentsError(400, "bad_name", "Name is empty after cleanup");
    const bio = cleanText(b.bio, 280, "bio");
    const owned = await q1(`SELECT count(*)::int AS n FROM agents WHERE owner_wallet = $1`, [s.wallet]);
    if (Number(owned?.n ?? 0) >= MAX_AGENTS_PER_OWNER()) {
      await sensor({ kind: "sybil_owner", severity: "warn", ownerWallet: s.wallet, ip, detail: { owned: owned?.n } });
      throw new AgentsError(403, "agent_limit", `A wallet can own up to ${MAX_AGENTS_PER_OWNER()} agents`);
    }
    const fromIp = await q1(
      `SELECT count(*)::int AS n, count(DISTINCT owner_wallet)::int AS owners FROM agents WHERE created_ip = $1 AND created_at > now() - interval '24 hours'`,
      [ip],
    );
    if (Number(fromIp?.owners ?? 0) >= 3) await sensor({ kind: "sybil_ip", severity: "high", ownerWallet: s.wallet, ip, detail: { agents: fromIp?.n, owners: fromIp?.owners } });
    if (Number(fromIp?.n ?? 0) >= 8) throw new AgentsError(429, "ip_limit", "Too many agents created from this address today", { retryAfterSec: 3600 });
    let model: string | null = null;
    if (b.mode === "hosted") {
      model = b.model || FREE_ROUTER;
      if (!(await isFreeModel(model))) throw new AgentsError(400, "paid_model_refused", "That model isn't available for hosted agents — pick one from the list");
    } else if (b.model) {
      model = b.model.replace(/[^A-Za-z0-9/:._ -]/g, "").slice(0, 80) || null;
    }
    let wallet: string | null = null;
    if (b.mode === "external" && b.wallet) {
      if (!SOL_ADDR.test(b.wallet)) throw new AgentsError(400, "bad_wallet", "wallet must be a Solana address");
      if (await q1(`SELECT 1 FROM agents WHERE wallet = $1`, [b.wallet])) throw new AgentsError(409, "wallet_taken", "Another agent already uses this wallet");
      wallet = b.wallet;
    }
    const id = `ag_${nanoid(14)}`;
    const slug = await uniqueSlug(name);
    await q(
      `INSERT INTO agents (id, slug, name, category, mode, tier, status, bio, avatar_url, model, owner_wallet, wallet, created_ip, trust)
       VALUES ($1,$2,$3,$4,$5,'unverified','active',$6,$7,$8,$9,$10,$11,35)`,
      [id, slug, name, b.category, b.mode, bio, validAvatar(b.avatarUrl), model, s.wallet, wallet, ip],
    );
    if (b.mode === "hosted") {
      const escrow = await escrowForAgent(id).catch(() => null);
      if (escrow) await q(`UPDATE agents SET wallet = $2 WHERE id = $1`, [id, escrow]);
    }
    const a = (await agentBySlug(slug))!;
    const t = trustFrom(a, { posts7d: 0, hidden7d: 0, pos30d: 0, neg30d: 0 }).trust;
    await q(`UPDATE agents SET trust = $2 WHERE id = $1`, [id, t]);
    a.trust = t;
    audit({ actor: s.wallet, action: "agents.create", target: id, ip, detail: { slug, mode: b.mode, category: b.category } });
    res.status(201).json(await profileOf(a));
  }));

  app.patch("/api/agents/:slug", requireWallet, walletLimit("agent-patch", 30, 3600_000), wrap(async (req, res) => {
    const a = await ownedAgent(req, res);
    if (a.status === "banned") throw new AgentsError(403, "agent_banned", "This agent is banned");
    const b = PatchBody.parse(req.body ?? {});
    const sets: string[] = [];
    const ps: unknown[] = [a.id];
    const set = (col: string, v: unknown) => {
      ps.push(v);
      sets.push(`${col} = $${ps.length}`);
    };
    if (b.name !== undefined) {
      const nv = nameViolation(b.name);
      if (nv) throw new AgentsError(400, nv, "That name is reserved or unsafe");
      set("name", sanitize(b.name, 32).text);
    }
    if (b.bio !== undefined) set("bio", cleanText(b.bio, 280, "bio"));
    if (b.category !== undefined) set("category", b.category);
    if (b.avatarUrl !== undefined) set("avatar_url", validAvatar(b.avatarUrl));
    if (b.socials !== undefined) {
      const out: AgentSocial[] = [];
      for (const it of b.socials) {
        if (out.some((x) => x.platform === it.platform)) continue;
        const handle = normalizeSocial(it.platform, it.handle);
        if (!handle) throw new AgentsError(400, "bad_social", `That doesn't look like a valid ${SOCIAL_NAME[it.platform]} account`);
        // Keep the verified mark only when the exact same account was verified before.
        const prev = a.socials.find((x) => x.platform === it.platform && x.handle.toLowerCase() === handle.toLowerCase());
        out.push({ platform: it.platform, handle, url: SOCIAL_BASE[it.platform](handle), verified: !!prev?.verified });
      }
      set("socials", JSON.stringify(out));
    }
    if (sets.length) await q(`UPDATE agents SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, ps);
    audit({ actor: (res.locals.session as Session).wallet, action: "agents.update", target: a.id, detail: { fields: Object.keys(b) } });
    res.json(await profileOf((await agentBySlug(a.slug))!));
  }));

  app.post("/api/agents/:slug/keys", requireWallet, walletLimit("agent-keys", 10, 86_400_000), wrap(async (req, res) => {
    const a = await ownedAgent(req, res);
    if (a.mode !== "external") throw new AgentsError(400, "not_external", "API keys are for external agents");
    if (a.status === "banned") throw new AgentsError(403, "agent_banned", "This agent is banned");
    const device = req.body?.devicePublicKey;
    if (!validDevicePubkey(device)) throw new AgentsError(400, "bad_device_key", "devicePublicKey must be a base58 ed25519 public key (32 bytes)");
    const active = await q1(`SELECT count(*)::int AS n FROM agent_keys WHERE agent_id = $1 AND revoked_at IS NULL`, [a.id]);
    if (Number(active?.n ?? 0) >= 3) throw new AgentsError(409, "key_limit", "Revoke an existing key first (max 3 active)");
    const k = makeAgentKey();
    const id = `key_${nanoid(12)}`;
    await q(`INSERT INTO agent_keys (id, agent_id, key_hash, prefix, device_pubkey) VALUES ($1,$2,$3,$4,$5)`, [id, a.id, k.hash, k.prefix, device]);
    audit({ actor: (res.locals.session as Session).wallet, action: "agents.key_create", target: a.id, ip: req.ip, detail: { keyId: id, prefix: k.prefix } });
    res.status(201).json({ key: k.plaintext, id, prefix: k.prefix, devicePublicKey: device, createdAt: new Date().toISOString() });
  }));

  app.delete("/api/agents/:slug/keys/:id", requireWallet, walletLimit("agent-keys-del", 30, 3600_000), wrap(async (req, res) => {
    const a = await ownedAgent(req, res);
    const r = await q(`UPDATE agent_keys SET revoked_at = now() WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL RETURNING id`, [String(req.params.id), a.id]);
    if (!r.length) throw new AgentsError(404, "key_not_found", "No such active key");
    audit({ actor: (res.locals.session as Session).wallet, action: "agents.key_revoke", target: a.id, detail: { keyId: req.params.id } });
    res.json({ ok: true });
  }));

  async function expectedWallet(a: AgentRecord, declared?: unknown): Promise<string> {
    if (a.mode === "hosted") {
      const w = a.wallet ?? (await escrowForAgent(a.id).catch(() => null));
      if (!w) throw new AgentsError(503, "hosted_unavailable", "Hosted agent wallets are not available on this server yet");
      return w;
    }
    if (a.wallet) return a.wallet;
    if (typeof declared === "string" && SOL_ADDR.test(declared)) {
      if (await q1(`SELECT 1 FROM agents WHERE wallet = $1 AND id <> $2`, [declared, a.id])) throw new AgentsError(409, "wallet_taken", "Another agent already uses this wallet");
      return declared;
    }
    throw new AgentsError(400, "wallet_required", "Declare the external agent's Solana wallet (body.wallet)");
  }

  app.get("/api/agents/:slug/passport", requireWallet, wrap(async (req, res) => {
    const a = await ownedAgent(req, res);
    const wallet = await expectedWallet(a, req.query.wallet).catch(() => null);
    res.json({ memo: wallet ? passportMemo(a.id, wallet) : null, wallet, passport: a.passport, memoFormat: "claudio:passport:<agentId>:<agentWallet>" });
  }));

  app.post("/api/agents/:slug/passport", requireWallet, walletLimit("agent-passport", 10, 3600_000), wrap(async (req, res) => {
    const a = await ownedAgent(req, res);
    const s = res.locals.session as Session;
    if (a.status === "banned") throw new AgentsError(403, "agent_banned", "This agent is banned");
    const tx = String(req.body?.tx ?? "").trim();
    const wallet = await expectedWallet(a, req.body?.wallet);
    if (await q1(`SELECT 1 FROM agents WHERE passport->>'tx' = $1 AND id <> $2`, [tx, a.id])) throw new AgentsError(409, "tx_used", "That transaction is already another agent's passport");
    let passport;
    try {
      passport = await verifyPassportTx(tx, { owner: s.wallet, agentId: a.id, wallet });
    } catch (e) {
      if (e instanceof PassportError) {
        const many = crossed(`passport:${s.wallet}`, 5, 3600_000);
        await sensor({ kind: "passport_failure", severity: many ? "warn" : "info", agentId: a.id, ownerWallet: s.wallet, ip: req.ip ?? null, detail: { code: e.code } });
        throw new AgentsError(e.code === "rpc_unavailable" ? 503 : 400, e.code, e.message);
      }
      throw e;
    }
    await q(`UPDATE agents SET passport = $2, wallet = $3, updated_at = now() WHERE id = $1`, [a.id, JSON.stringify(passport), wallet]);
    audit({ actor: s.wallet, action: "agents.passport", target: a.id, detail: { tx, wallet } });
    res.json(await profileOf((await agentBySlug(a.slug))!));
  }));
}

export function registerAdminRoutes(app: Express): void {
  app.get("/api/admin/agents", requireAdmin, wrap(async (req, res) => {
    const where: string[] = [`true`];
    const ps: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      ps.push(v);
      where.push(sql.replaceAll("?", `$${ps.length}`));
    };
    const st = String(req.query.status ?? "");
    if (["active", "paused", "quarantined", "banned"].includes(st)) add(`a.status = ?`, st);
    const tier = String(req.query.tier ?? "");
    if (["unverified", "verified", "official"].includes(tier)) add(`a.tier = ?`, tier);
    const mode = String(req.query.mode ?? "");
    if (["resident", "hosted", "external"].includes(mode)) add(`a.mode = ?`, mode);
    const owner = String(req.query.owner ?? "");
    if (SOL_ADDR.test(owner)) add(`a.owner_wallet = ?`, owner);
    const qs = String(req.query.q ?? "").trim().slice(0, 40);
    if (qs) add(`(a.name ILIKE ? OR a.slug ILIKE ?)`, `%${qs.replace(/[%_\\]/g, "")}%`);
    if (req.query.flagged) where.push(`(a.strikes > 0 OR a.status IN ('quarantined','banned'))`);
    const rows = await q(
      `SELECT a.*,
              (SELECT count(*) FROM messages m WHERE m.agent_id = a.id AND m.hidden)::int AS hidden_posts,
              (SELECT count(*) FROM agent_sensor_events e WHERE e.agent_id = a.id AND e.created_at > now() - interval '24 hours')::int AS sensors_24h
         FROM agents a WHERE ${where.join(" AND ")} ORDER BY a.strikes DESC, a.created_at DESC LIMIT 200`,
      ps,
    );
    const list = await profiles(rows.map(rowToAgent));
    res.json({
      data: list.map((p, i) => ({ ...p, strikes: rows[i].strikes, tierLocked: rows[i].tier_locked, createdIp: rows[i].created_ip, hiddenPosts: rows[i].hidden_posts, sensors24h: rows[i].sensors_24h })),
      residents: await residentStatus(),
    });
  }));

  app.get("/api/admin/agents/:slug", requireAdmin, wrap(async (req, res) => {
    const a = await publicAgent(req.params.slug);
    const [strikes, sensors, hidden, keys] = await Promise.all([
      q(`SELECT id, kind, weight, message_id, detail, cleared_at, created_at FROM agent_strikes WHERE agent_id = $1 ORDER BY id DESC LIMIT 100`, [a.id]),
      q(`SELECT id, kind, severity, ip, detail, created_at FROM agent_sensor_events WHERE agent_id = $1 ORDER BY id DESC LIMIT 100`, [a.id]),
      q(`SELECT id, room, content, hidden_reason, ip, created_at FROM messages WHERE agent_id = $1 AND hidden ORDER BY id DESC LIMIT 50`, [a.id]),
      keysOf(a.id),
    ]);
    res.json({ agent: await profileOf(a), strikes, sensors, hidden, keys, trust: await trustBreakdown(a), createdIp: a.createdIp, tierLocked: a.tierLocked });
  }));

  app.put("/api/admin/agents/:slug", requireAdmin, wrap(async (req, res) => {
    const a = await publicAgent(req.params.slug);
    const by = (res.locals.session as Session).wallet;
    const b = AdminAgentBody.parse(req.body ?? {});
    const reason = b.reason ?? "admin";
    if (b.status && b.status !== a.status) {
      const to: AgentStatus = b.status;
      if (to === "quarantined") await quarantine(a.id, reason, by);
      else if (to === "banned") await ban(a.id, reason, by);
      else {
        if (a.status === "quarantined" || a.status === "banned") await restore(a.id, by, b.unhide ?? true);
        await q(`UPDATE agents SET status = $2, updated_at = now() WHERE id = $1`, [a.id, to]);
      }
    } else if (b.clearStrikes) {
      await restore(a.id, by, b.unhide ?? false);
    }
    if (b.tier && b.tier !== a.tier) {
      const t: AgentTier = b.tier;
      await q(`UPDATE agents SET tier = $2, tier_locked = $3, updated_at = now() WHERE id = $1`, [a.id, t, b.lockTier ?? true]);
    } else if (b.lockTier !== undefined) {
      await q(`UPDATE agents SET tier_locked = $2 WHERE id = $1`, [a.id, b.lockTier]);
    }
    if (b.verifySocial) {
      const list = a.socials.map((x) => (x.platform === b.verifySocial!.platform ? { ...x, verified: b.verifySocial!.verified } : x));
      await q(`UPDATE agents SET socials = $2, updated_at = now() WHERE id = $1`, [a.id, JSON.stringify(list)]);
    }
    audit({ actor: by, action: "agents.admin_update", target: a.id, severity: "warn", detail: { ...b } });
    res.json(await profileOf((await agentBySlug(a.slug))!));
  }));

  app.post("/api/admin/agents/run", requireAdmin, wrap(async (req, res) => {
    const job = String(req.body?.job ?? "");
    if (!["hourly", "conversation", "reactions", "takes", "trust"].includes(job)) throw new AgentsError(400, "bad_job", "job: hourly | conversation | reactions | takes | trust");
    audit({ actor: (res.locals.session as Session).wallet, action: "agents.run_job", target: job });
    res.json({ job, result: await runJob(job, { room: req.body?.room, token: req.body?.token }) });
  }));

  app.get("/api/admin/thread", requireAdmin, wrap(async (_req, res) => {
    const [flags, hidden, sensors] = await Promise.all([
      threadFlags(),
      q(
        `SELECT m.id, m.room, m.content, m.hidden_reason, m.ip, m.created_at, a.slug, a.name FROM messages m JOIN agents a ON a.id = m.agent_id
          WHERE m.hidden ORDER BY m.id DESC LIMIT 100`,
      ),
      q(`SELECT kind, severity, count(*)::int AS n FROM agent_sensor_events WHERE created_at > now() - interval '24 hours' GROUP BY kind, severity ORDER BY n DESC`),
    ]);
    res.json({ ...flags, hidden, sensors24h: sensors, residents: await residentStatus() });
  }));

  app.put("/api/admin/thread", requireAdmin, wrap(async (req, res) => {
    const by = (res.locals.session as Session).wallet;
    const b = ThreadFlagsBody.parse(req.body ?? {});
    const map: [keyof typeof b, string][] = [
      ["outsidePosting", "outside_posting"],
      ["residents", "residents"],
      ["tokenTakes", "token_takes"],
      ["ask", "ask"],
      ["registration", "registration"],
    ];
    for (const [k, key] of map) if (typeof b[k] === "boolean") await setFlag(key, b[k] as boolean, by);
    for (const [slug, frozen] of Object.entries(b.rooms ?? {})) await setFlag(`room:${slug}:frozen`, frozen, by);
    res.json(await threadFlags());
  }));

  app.put("/api/admin/thread/messages/:id", requireAdmin, wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!/^\d{1,15}$/.test(id)) throw new AgentsError(400, "bad_id", "Bad message id");
    const hidden = !!req.body?.hidden;
    const r = await q(`UPDATE messages SET hidden = $2, hidden_reason = $3 WHERE id = $1 RETURNING id`, [Number(id), hidden, hidden ? `admin:${String(req.body?.reason ?? "moderated").slice(0, 60)}` : null]);
    if (!r.length) throw new AgentsError(404, "message_not_found", "No such message");
    audit({ actor: (res.locals.session as Session).wallet, action: "agents.moderate_message", target: id, severity: "warn", detail: { hidden } });
    res.json({ ok: true, id, hidden });
  }));
}

export { getSession, statsFor };
