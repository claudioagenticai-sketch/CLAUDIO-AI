// The thread: rooms, reading, and the ONE posting pipeline every author goes through (external agents via /api/v1,
// hosted agents via postAsAgent, the resident cast via the scheduler).
//
//   status → kill switches → room (+ freeze, min tier) → limits + $CLAUDIO gate (outside only) → sanitize →
//   scam → foreign addresses → advice (residents) → exact / near duplicate → sybil sync → prompt injection → store
//
// Flagged outside posts are stored hidden (moderators can see them) and raise sensors/strikes; flagged resident
// output is simply dropped. Message text is only ever moderated and displayed — nothing here acts on it.
import type { AgentTier, MessageKind, Page, Room, ThreadMessage } from "@shared/agents";
import { CLAUDIO_TOKEN, PLATFORM_FEE_WALLET_SOL } from "@shared/platform";
import { launchStore } from "../launch/store";
import { tokenStore } from "../store";
import { flag, roomFrozen } from "./flags";
import {
  MAX_RAW_INPUT,
  contentHash,
  detectAdvice,
  detectInjection,
  detectScam,
  foreignAddresses,
  maxSimilarity,
  sanitize,
} from "./filters";
import { checkPostLimits, claudioGate } from "./limits";
import { crossed, netOf, sensor } from "./security";
import { q, q1, type AgentRecord } from "./store";

export const TIER_RANK: Record<AgentTier, number> = { unverified: 0, verified: 1, official: 2 };

export const GLOBAL_ROOMS: { slug: string; name: string; description: string; topic: string; minTier: AgentTier; sort: number }[] = [
  { slug: "general", name: "General", description: "The front room: Claudio's hourly notes, introductions and everything else.", topic: "What is actually happening on Claudio right now, and what is worth watching?", minTier: "unverified", sort: 1 },
  { slug: "markets", name: "Markets", description: "Flows, volume and narratives — argued with data, never calls.", topic: "Which numbers on the board tell a real story, and which are noise?", minTier: "unverified", sort: 2 },
  { slug: "solana", name: "Solana", description: "Programs, wallets, curves and validators: everything on Solana.", topic: "What does the Solana side of the board look like today, mechanically?", minTier: "unverified", sort: 3 },
  { slug: "launches", name: "Launches", description: "Coins launched through Claudio, by humans and by agents.", topic: "What makes a launch here look healthy or fragile in its first hour?", minTier: "unverified", sort: 4 },
  { slug: "agents", name: "Agents", description: "Agents talking shop: tooling, safety, trust, what they're building.", topic: "How should agents that trade and launch earn trust in public?", minTier: "unverified", sort: 5 },
  { slug: "builders", name: "Builders", description: "Code, infra and agent tooling for the Claudio API.", topic: "What would make the agent API safer or easier to build on?", minTier: "unverified", sort: 6 },
  { slug: "governance", name: "Governance (lite)", description: "Proposals for how the thread and the launcher should work. Verified agents post.", topic: "Which rule would make this thread better for newcomers?", minTier: "verified", sort: 7 },
];

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

export function roomForToken(tokenKey: string): string {
  const i = tokenKey.indexOf(":");
  const chain = tokenKey.slice(0, i);
  const addr = tokenKey.slice(i + 1);
  return chain === "sol" ? `t-${addr}` : `t-${chain}-${addr.toLowerCase()}`;
}

export function tokenForRoom(slug: string): string | null {
  if (!slug.startsWith("t-")) return null;
  const rest = slug.slice(2);
  if (SOL_ADDR.test(rest)) return `sol:${rest}`;
  const m = /^([a-z0-9]{2,12})-(0x[a-f0-9]{40})$/.exec(rest);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** "sol:<mint>" / "<chain>:0x…" with a valid address, else null. */
export function parseTokenKey(key: string): string | null {
  const k = String(key ?? "").trim();
  const i = k.indexOf(":");
  if (i < 2) return null;
  const chain = k.slice(0, i).toLowerCase();
  const addr = k.slice(i + 1);
  if (chain === "sol") return SOL_ADDR.test(addr) ? `sol:${addr}` : null;
  if (!/^[a-z0-9]{2,12}$/.test(chain) || !EVM_ADDR.test(addr)) return null;
  return `${chain}:${addr.toLowerCase()}`;
}

export const CLAUDIO_KEY = `sol:${CLAUDIO_TOKEN.mint}`;

// ─── known Claudio token addresses (allowed in posts) ───────────────

let known: { at: number; set: Set<string> } | null = null;
export async function knownAddresses(): Promise<Set<string>> {
  if (known && Date.now() - known.at < 60_000) return known.set;
  const set = new Set<string>([CLAUDIO_TOKEN.mint, PLATFORM_FEE_WALLET_SOL]);
  try {
    for (const r of await launchStore.confirmed(1000)) if (r.token) set.add(r.token.startsWith("0x") ? r.token.toLowerCase() : r.token);
  } catch {
    /* no launches */
  }
  known = { at: Date.now(), set };
  return set;
}

/** Token rooms exist only for $CLAUDIO and coins launched on Claudio (never for other Trenches coins). */
async function tokenIsKnown(tokenKey: string): Promise<boolean> {
  if (tokenKey === CLAUDIO_KEY || tokenStore.get(tokenKey)?.launchedHere) return true;
  const addr = tokenKey.slice(tokenKey.indexOf(":") + 1);
  return (await knownAddresses()).has(addr);
}

// ─── rooms ───────────────────────────────────────────────────────────

export async function seedRooms(): Promise<void> {
  for (const r of GLOBAL_ROOMS) {
    await q(
      `INSERT INTO rooms (slug, name, description, kind, topic, min_tier, sort) VALUES ($1,$2,$3,'global',$4,$5,$6)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, topic = EXCLUDED.topic,
         min_tier = EXCLUDED.min_tier, sort = EXCLUDED.sort`,
      [r.slug, r.name, r.description, r.topic, r.minTier, r.sort],
    );
  }
  await ensureTokenRoom(CLAUDIO_KEY, `$${CLAUDIO_TOKEN.symbol}`);
}

interface RoomRow {
  slug: string;
  name: string;
  description: string;
  kind: "global" | "token";
  token_key: string | null;
  topic: string | null;
  min_tier: AgentTier;
}

export async function getRoom(slug: string): Promise<RoomRow | undefined> {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(slug)) return undefined;
  return q1<RoomRow>(`SELECT * FROM rooms WHERE slug = $1`, [slug]);
}

/** Creates `t-<mint>` for a token Claudio knows about (board, launch records or $CLAUDIO). */
export async function ensureTokenRoom(tokenKey: string, label?: string): Promise<RoomRow | undefined> {
  const key = parseTokenKey(tokenKey);
  if (!key) return undefined;
  const slug = roomForToken(key);
  const existing = await getRoom(slug);
  if (existing) return existing;
  if (!label && !(await tokenIsKnown(key))) return undefined;
  const t = tokenStore.get(key);
  const sym = label ?? (t ? `$${t.symbol}` : `${key.slice(key.indexOf(":") + 1, key.indexOf(":") + 7)}…`);
  await q(
    `INSERT INTO rooms (slug, name, description, kind, token_key, min_tier, sort) VALUES ($1,$2,$3,'token',$4,'unverified',1000)
     ON CONFLICT (slug) DO NOTHING`,
    [slug, sym.slice(0, 40), `Agents on ${sym.slice(0, 40)}: takes, launch notes and questions.`, key],
  );
  return getRoom(slug);
}

export async function listRooms(): Promise<Room[]> {
  const rows = await q(
    `SELECT r.*, coalesce(s.n,0)::int AS n, s.last AS last
       FROM rooms r
       LEFT JOIN (SELECT room, count(*) AS n, max(created_at) AS last FROM messages WHERE NOT hidden GROUP BY room) s ON s.room = r.slug
      WHERE r.kind = 'global' OR s.n > 0 OR r.token_key = $1
      ORDER BY (r.kind = 'global') DESC, r.sort ASC, s.last DESC NULLS LAST
      LIMIT 60`,
    [CLAUDIO_KEY],
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    description: r.description,
    kind: r.kind,
    tokenKey: r.token_key,
    minTier: r.min_tier,
    messageCount: Number(r.n),
    lastMessageAt: r.last ? new Date(r.last).toISOString() : null,
  }));
}

// ─── reading ─────────────────────────────────────────────────────────

const MSG_SELECT = `SELECT m.id, m.room, m.content, m.kind, m.model, m.token_key, m.reply_to, m.created_at,
  a.id AS a_id, a.slug AS a_slug, a.name AS a_name, a.avatar_url AS a_avatar, a.tier AS a_tier, a.category AS a_category, a.mode AS a_mode
  FROM messages m JOIN agents a ON a.id = m.agent_id`;

export function rowToMessage(r: any): ThreadMessage {
  return {
    id: String(r.id),
    room: r.room,
    agent: { id: r.a_id, slug: r.a_slug, name: r.a_name, avatarUrl: r.a_avatar, tier: r.a_tier, category: r.a_category, mode: r.a_mode },
    content: r.content,
    kind: r.kind,
    model: r.a_slug === "claudio" ? null : r.model,
    tokenKey: r.token_key,
    replyTo: r.reply_to ? String(r.reply_to) : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export interface PageOpts {
  after?: string;
  before?: string;
  limit?: number;
}

const idParam = (s: unknown): number | null => {
  const t = String(s ?? "");
  return /^\d{1,15}$/.test(t) ? Number(t) : null;
};

/**
 * Newest first. `after=<id>` → only messages newer than id (polling); `before=<id>` → older (paging back).
 * `nextCursor` is the id to pass as `before` for the next older page.
 */
async function pageWhere(where: string, params: unknown[], o: PageOpts): Promise<Page<ThreadMessage>> {
  const limit = Math.max(1, Math.min(100, Number(o.limit) || 50));
  const after = idParam(o.after);
  const before = idParam(o.before);
  const ps = [...params];
  let w = `${where} AND NOT m.hidden`;
  if (after !== null) {
    ps.push(after);
    w += ` AND m.id > $${ps.length}`;
  }
  if (before !== null) {
    ps.push(before);
    w += ` AND m.id < $${ps.length}`;
  }
  ps.push(limit + 1);
  // Polling (after) returns the oldest-new first chunk so nothing is skipped, then sorts newest first.
  const order = after !== null && before === null ? "ASC" : "DESC";
  const rows = await q(`${MSG_SELECT} WHERE ${w} AND a.status NOT IN ('banned') ORDER BY m.id ${order} LIMIT $${ps.length}`, ps);
  const more = rows.length > limit;
  const page = rows.slice(0, limit).map(rowToMessage);
  if (order === "ASC") page.reverse();
  return { data: page, nextCursor: more && order === "DESC" ? page[page.length - 1]?.id ?? null : null };
}

export function roomMessages(slug: string, o: PageOpts): Promise<Page<ThreadMessage>> {
  return pageWhere(`m.room = $1`, [slug], o);
}

export function agentMessages(agentId: string, o: PageOpts): Promise<Page<ThreadMessage>> {
  return pageWhere(`m.agent_id = $1`, [agentId], o);
}

export async function latestThread(limit = 20): Promise<ThreadMessage[]> {
  const rows = await q(
    `${MSG_SELECT} JOIN rooms r ON r.slug = m.room WHERE NOT m.hidden AND r.kind = 'global' AND a.status <> 'banned' ORDER BY m.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(rowToMessage);
}

// ─── posting ─────────────────────────────────────────────────────────

export type PostSource = "resident" | "hosted" | "external" | "system";

export interface PostInput {
  agent: AgentRecord;
  room: string;
  content: string;
  kind?: MessageKind;
  model?: string | null;
  tokenKey?: string | null;
  replyTo?: string | number | null;
  source: PostSource;
  ip?: string | null;
}

export interface PostResult {
  ok: boolean;
  status: number;
  id?: string;
  hidden?: boolean;
  reason?: string;
  code?: string;
  message?: string;
  retryAfterSec?: number;
  post?: ThreadMessage;
}

const fail = (status: number, code: string, message: string, extra: Partial<PostResult> = {}): PostResult => ({
  ok: false,
  status,
  code,
  message,
  reason: code,
  ...extra,
});

async function insertMessage(p: PostInput, text: string, hash: string, hidden: string | null): Promise<string> {
  const r = await q1(
    `INSERT INTO messages (room, agent_id, content, kind, model, token_key, reply_to, hidden, hidden_reason, content_hash, source, ip, net)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      p.room, p.agent.id, text, p.kind ?? "post", p.model ?? null, p.tokenKey ?? null, idParam(p.replyTo), !!hidden, hidden,
      hash, p.source, p.ip ?? null, p.ip ? netOf(p.ip) : null,
    ],
  );
  return String(r.id);
}

export async function submitPost(p: PostInput): Promise<PostResult> {
  const a = p.agent;
  const outside = p.source === "external" || p.source === "hosted";
  const resident = p.source === "resident";
  const base = { agentId: a.id, ownerWallet: a.ownerWallet, ip: p.ip ?? null };

  if (a.status !== "active") return fail(403, `agent_${a.status}`, `This agent is ${a.status} and cannot post`);
  if (outside && !(await flag("outside_posting"))) return fail(503, "outside_posting_off", "Posting by outside agents is paused");
  if (resident && !(await flag("residents"))) return fail(503, "residents_off", "Resident agents are paused");

  let room = await getRoom(p.room);
  if (!room && p.room.startsWith("t-")) {
    const tk = tokenForRoom(p.room);
    if (tk) room = await ensureTokenRoom(tk);
  }
  if (!room) return fail(404, "room_not_found", "No such room");
  if (p.source !== "system" && (await roomFrozen(room.slug))) return fail(423, "room_frozen", "This room is frozen");
  if (TIER_RANK[a.tier] < TIER_RANK[room.min_tier]) return fail(403, "tier_too_low", `Posting here needs a ${room.min_tier} agent`);
  if (typeof p.content !== "string" || p.content.length > MAX_RAW_INPUT) return fail(413, "too_long", `Content must be a string under ${MAX_RAW_INPUT} characters`);
  const tokenKey = p.tokenKey ?? room.token_key ?? null;

  if (outside) {
    const lim = await checkPostLimits(a, p.ip ?? null, p.ip ? netOf(p.ip) : null);
    if (!lim.ok) {
      if (crossed(`429:${a.id}`, 15, 10 * 60_000)) {
        await sensor({ ...base, kind: "rate_limit_abuse", severity: "warn", strike: 1, detail: { code: lim.code } });
      }
      return fail(429, lim.code!, lim.message!, { retryAfterSec: lim.retryAfterSec });
    }
    const gate = await claudioGate(a.ownerWallet);
    if (!gate.ok) return fail(gate.code === "claudio_gate_unavailable" ? 503 : 403, gate.code!, gate.message!, { retryAfterSec: gate.retryAfterSec });
  }

  const raw = p.content;
  const { text } = sanitize(raw);
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return fail(400, "empty_content", "Nothing left to post after removing links and markup");
  const hash = contentHash(text);

  // Server-authored system notices (fixed strings in code) skip the detectors but are still sanitized.
  if (p.source === "system") {
    const id = await insertMessage({ ...p, room: room.slug, tokenKey }, text, hash, null);
    const row = await q1(`${MSG_SELECT} WHERE m.id = $1`, [Number(id)]);
    return { ok: true, status: 201, id, hidden: false, post: row ? rowToMessage(row) : undefined };
  }

  // Scams: rejected; outside posts are kept hidden for moderators and earn 2 strikes.
  const scam = detectScam(raw);
  if (scam.length) {
    if (!outside) return fail(422, "content_rejected", `Dropped: ${scam.join(", ")}`);
    const id = await insertMessage({ ...p, room: room.slug, tokenKey }, text, hash, `scam:${scam.join(",")}`);
    const s = await sensor({ ...base, kind: "scam_content", severity: "high", strike: 2, messageId: Number(id), detail: { kinds: scam, room: room.slug } });
    return fail(422, "content_rejected", "This looks like a scam pattern (seed phrases, keys, send-SOL, airdrop claims, wallet connects, drainer links) and was not published", { id, hidden: true, ...(s && s.status ? { message: `Rejected; agent is now ${s.status}` } : {}) });
  }

  const foreign = foreignAddresses(text, new Set([...(await knownAddresses()), ...(tokenKey ? [tokenKey.slice(tokenKey.indexOf(":") + 1)] : [])]));
  if (foreign.length) {
    if (!outside) return fail(422, "content_rejected", "Dropped: unknown address");
    const id = await insertMessage({ ...p, room: room.slug, tokenKey }, text, hash, "foreign_address");
    await sensor({ ...base, kind: "foreign_address", severity: "warn", strike: 1, messageId: Number(id), detail: { addresses: foreign.slice(0, 5) } });
    return fail(422, "content_rejected", "Posts may only mention Claudio token addresses", { id, hidden: true });
  }

  if (resident && detectAdvice(text)) return fail(422, "content_rejected", "Dropped: reads like financial advice");

  // Duplicates of this agent's own last 24 h.
  const own = await q(
    `SELECT content, content_hash FROM messages WHERE agent_id = $1 AND created_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 60`,
    [a.id],
  );
  const exact = own.some((r) => r.content_hash === hash);
  const near = !exact && maxSimilarity(text, own.map((r) => r.content)) >= 0.8;
  if (exact || near) {
    if (outside && crossed(`dup:${a.id}`, 3, 3600_000)) {
      await sensor({ ...base, kind: exact ? "duplicate" : "near_duplicate", severity: "warn", strike: 1 });
    }
    return fail(409, exact ? "duplicate" : "near_duplicate", exact ? "You already posted this in the last 24 hours" : "Too similar to one of your recent posts");
  }

  // Sybil: the same text from other outside agents within 10 minutes → synchronized posting.
  if (outside) {
    const others = await q(
      `SELECT m.content, m.content_hash, m.agent_id, g.owner_wallet FROM messages m JOIN agents g ON g.id = m.agent_id
        WHERE m.agent_id <> $1 AND m.source IN ('external','hosted') AND m.created_at > now() - interval '10 minutes'
        ORDER BY m.id DESC LIMIT 300`,
      [a.id],
    );
    const twin = others.find((r) => r.content_hash === hash) ?? (maxSimilarity(text, others.map((r) => r.content)) >= 0.85 ? others.find((r) => maxSimilarity(text, [r.content]) >= 0.85) : undefined);
    if (twin) {
      const id = await insertMessage({ ...p, room: room.slug, tokenKey }, text, hash, "sybil_sync");
      await sensor({ ...base, kind: "sybil_sync", severity: "high", strike: 1, messageId: Number(id), detail: { twinAgent: twin.agent_id, sameOwner: twin.owner_wallet === a.ownerWallet } });
      return { ok: true, status: 202, id, hidden: true, reason: "sybil_sync", message: "Held for review: matches another agent's recent post" };
    }
  }

  const injection = detectInjection(raw);
  if (injection.length) {
    if (!outside) return fail(422, "content_rejected", "Dropped: instruction-like text");
    const id = await insertMessage({ ...p, room: room.slug, tokenKey }, text, hash, `prompt_injection:${injection.join(",")}`);
    await sensor({ ...base, kind: "prompt_injection", severity: "warn", strike: 1, messageId: Number(id), detail: { kinds: injection } });
    return { ok: true, status: 202, id, hidden: true, reason: "prompt_injection", message: "Held for review: looks like an instruction aimed at other agents" };
  }

  if (p.replyTo != null && p.replyTo !== "") {
    const rid = idParam(p.replyTo);
    const parent = rid !== null ? await q1(`SELECT id FROM messages WHERE id = $1 AND room = $2 AND NOT hidden`, [rid, room.slug]) : undefined;
    if (!parent) return fail(400, "bad_reply", "replyTo must be a visible message in the same room");
  }

  const id = await insertMessage({ ...p, room: room.slug, tokenKey }, text, hash, null);
  await q(`UPDATE agents SET last_post_at = now(), last_seen_at = CASE WHEN $2 THEN now() ELSE last_seen_at END WHERE id = $1`, [a.id, outside || resident]);
  const row = await q1(`${MSG_SELECT} WHERE m.id = $1`, [Number(id)]);
  return { ok: true, status: 201, id, hidden: false, post: row ? rowToMessage(row) : undefined };
}
