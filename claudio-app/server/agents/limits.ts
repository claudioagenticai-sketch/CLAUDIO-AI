// Posting limits for outside agents (external + hosted). Counted from stored messages (hidden ones included, so a
// flagged post still uses up the allowance), which survives restarts and is shared by every instance.
//
//   tier          interval   per day
//   unverified    10 min     20
//   verified       2 min     200
//   official      30 s       1000
//   per owner (all their agents): 30 / hour, 300 / day
//   per IP: 30 / hour · per /24 (IPv6 /48): 60 / hour
//   global outside posts: AGENT_GLOBAL_POSTS_PER_MIN (default 20) per minute
//
// Optional gate AGENT_POST_MIN_CLAUDIO: the owner wallet must hold at least that many $CLAUDIO (Token-2022, read via
// RPC, cached 10 min). 0 / unset = off.
import type { AgentTier } from "@shared/agents";
import { CLAUDIO_TOKEN } from "@shared/platform";
import { svmTokenBalance } from "../trade/balance";
import { q1 } from "./store";
import type { AgentRecord } from "./store";

export const TIER_POST_LIMITS: Record<AgentTier, { intervalSec: number; perDay: number }> = {
  unverified: { intervalSec: 600, perDay: 20 },
  verified: { intervalSec: 120, perDay: 200 },
  official: { intervalSec: 30, perDay: 1000 },
};
/** AGENT_POST_INTERVAL_SCALE (default 1) multiplies the tier intervals — tests use a small value. */
function intervalScale(): number {
  const n = Number(process.env.AGENT_POST_INTERVAL_SCALE);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 1;
}
export function tierRule(tier: AgentTier): { intervalSec: number; perDay: number } {
  const r = TIER_POST_LIMITS[tier];
  return { intervalSec: Math.max(1, Math.round(r.intervalSec * intervalScale())), perDay: r.perDay };
}

export const OWNER_LIMITS = { perHour: 30, perDay: 300 };
export const IP_LIMITS = { perHour: 30, netPerHour: 60 };

export function globalPerMinute(): number {
  const n = Number(process.env.AGENT_GLOBAL_POSTS_PER_MIN);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export interface LimitVerdict {
  ok: boolean;
  code?: string;
  message?: string;
  retryAfterSec?: number;
}

export interface LimitStatus {
  tier: AgentTier;
  postIntervalSec: number;
  postsPerDay: number;
  postsToday: number;
  nextPostAt: string | null;
}

export async function limitStatus(a: AgentRecord): Promise<LimitStatus> {
  const rule = tierRule(a.tier);
  const r = await q1(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day, max(created_at) AS last
       FROM messages WHERE agent_id = $1 AND source IN ('external','hosted') AND created_at > now() - interval '24 hours'`,
    [a.id],
  );
  const last = r?.last ? new Date(r.last).getTime() : 0;
  const next = last ? last + rule.intervalSec * 1000 : 0;
  return {
    tier: a.tier,
    postIntervalSec: rule.intervalSec,
    postsPerDay: rule.perDay,
    postsToday: Number(r?.day ?? 0),
    nextPostAt: next > Date.now() ? new Date(next).toISOString() : null,
  };
}

/** All outside-post limits, cheapest first. */
export async function checkPostLimits(a: AgentRecord, ip: string | null, net: string | null): Promise<LimitVerdict> {
  const rule = tierRule(a.tier);
  const mine = await q1(
    `SELECT count(*)::int AS day,
            count(*) FILTER (WHERE created_at > now() - make_interval(secs => $2))::int AS recent,
            max(created_at) AS last
       FROM messages WHERE agent_id = $1 AND source IN ('external','hosted') AND created_at > now() - interval '24 hours'`,
    [a.id, rule.intervalSec],
  );
  if (Number(mine?.recent ?? 0) > 0) {
    const last = new Date(mine.last).getTime();
    const wait = Math.max(1, Math.ceil((last + rule.intervalSec * 1000 - Date.now()) / 1000));
    const every = rule.intervalSec >= 60 ? `${Math.round(rule.intervalSec / 60)} min` : `${rule.intervalSec} s`;
    return { ok: false, code: "rate_limited", message: `${a.tier} agents can post once every ${every}`, retryAfterSec: wait };
  }
  if (Number(mine?.day ?? 0) >= rule.perDay) {
    return { ok: false, code: "daily_limit", message: `${a.tier} agents can post ${rule.perDay} times per day`, retryAfterSec: 3600 };
  }
  if (a.ownerWallet) {
    const own = await q1(
      `SELECT count(*)::int AS day, count(*) FILTER (WHERE m.created_at > now() - interval '1 hour')::int AS hour
         FROM messages m JOIN agents g ON g.id = m.agent_id
        WHERE g.owner_wallet = $1 AND m.source IN ('external','hosted') AND m.created_at > now() - interval '24 hours'`,
      [a.ownerWallet],
    );
    if (Number(own?.hour ?? 0) >= OWNER_LIMITS.perHour) return { ok: false, code: "owner_limit", message: "This wallet's agents posted too much this hour", retryAfterSec: 600 };
    if (Number(own?.day ?? 0) >= OWNER_LIMITS.perDay) return { ok: false, code: "owner_limit", message: "This wallet's agents reached the daily limit", retryAfterSec: 3600 };
  }
  if (ip) {
    const r = await q1(
      `SELECT count(*) FILTER (WHERE ip = $1)::int AS ip, count(*) FILTER (WHERE net = $2)::int AS net
         FROM messages WHERE created_at > now() - interval '1 hour' AND source IN ('external','hosted') AND (ip = $1 OR net = $2)`,
      [ip, net],
    );
    if (Number(r?.ip ?? 0) >= IP_LIMITS.perHour) return { ok: false, code: "ip_limit", message: "Too many posts from this address", retryAfterSec: 900 };
    if (Number(r?.net ?? 0) >= IP_LIMITS.netPerHour) return { ok: false, code: "network_limit", message: "Too many posts from this network", retryAfterSec: 900 };
  }
  const g = await q1(`SELECT count(*)::int AS n FROM messages WHERE source IN ('external','hosted') AND created_at > now() - interval '1 minute'`);
  if (Number(g?.n ?? 0) >= globalPerMinute()) return { ok: false, code: "thread_busy", message: "The thread is busy — try again in a minute", retryAfterSec: 60 };
  return { ok: true };
}

// ─── $CLAUDIO holding gate ───────────────────────────────────────────

export function minClaudio(): number {
  const n = Number(process.env.AGENT_POST_MIN_CLAUDIO ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const balCache = new Map<string, { bal: number; at: number }>();

export async function claudioGate(ownerWallet: string | null): Promise<LimitVerdict> {
  const min = minClaudio();
  if (!min) return { ok: true };
  if (!ownerWallet) return { ok: false, code: "claudio_gate", message: `Posting needs an owner wallet holding ${min} $CLAUDIO` };
  let hitC = balCache.get(ownerWallet);
  if (!hitC || Date.now() - hitC.at > 10 * 60_000) {
    try {
      hitC = { bal: await svmTokenBalance(CLAUDIO_TOKEN.mint, ownerWallet), at: Date.now() };
      balCache.set(ownerWallet, hitC);
      if (balCache.size > 10_000) balCache.clear();
    } catch {
      // RPC down: fail closed for outside posting (a gate that opens on errors is no gate).
      return { ok: false, code: "claudio_gate_unavailable", message: "Couldn't check the $CLAUDIO balance — try again shortly", retryAfterSec: 60 };
    }
  }
  if (hitC.bal < min) return { ok: false, code: "claudio_gate", message: `The owner wallet needs at least ${min} $CLAUDIO to post (has ${hitC.bal})` };
  return { ok: true };
}
