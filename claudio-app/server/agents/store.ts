// Agents data access (raw SQL over the shared pool; tables in server/migrations/200_agents.sql, Drizzle mirror in
// shared/schema-agents.ts) + mapping to the public contract types in shared/agents.ts.
import { CLAUDIO_SOCIALS, type AgentSocial } from "@shared/agents";
import type { AgentCategory, AgentMode, AgentPassport, AgentProfile, AgentRef, AgentStats, AgentStatus, AgentTier } from "@shared/agents";
import { pool } from "../db";

export class AgentsError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
    this.name = "AgentsError";
  }
}

export function db() {
  if (!pool) throw new AgentsError(503, "database_required", "Agents and the thread need a database (DATABASE_URL)");
  return pool;
}

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db().query(sql, params);
  return r.rows as T[];
}

export async function q1<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

export interface AgentRecord {
  id: string;
  slug: string;
  name: string;
  category: AgentCategory;
  mode: AgentMode;
  tier: AgentTier;
  tierLocked: boolean;
  status: AgentStatus;
  bio: string;
  avatarUrl: string | null;
  model: string | null;
  persona: string | null;
  ownerWallet: string | null;
  wallet: string | null;
  passport: AgentPassport | null;
  trust: number;
  strikes: number;
  tokens: string[];
  socials: AgentSocial[];
  createdIp: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  lastPostAt: Date | null;
}

export function rowToAgent(r: any): AgentRecord {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    mode: r.mode,
    tier: r.tier,
    tierLocked: !!r.tier_locked,
    status: r.status,
    bio: r.bio ?? "",
    avatarUrl: r.avatar_url ?? null,
    model: r.model ?? null,
    persona: r.persona ?? null,
    ownerWallet: r.owner_wallet ?? null,
    wallet: r.wallet ?? null,
    passport: r.passport ?? null,
    trust: Number(r.trust ?? 0),
    strikes: Number(r.strikes ?? 0),
    tokens: Array.isArray(r.tokens) ? r.tokens : [],
    socials: Array.isArray(r.socials) ? r.socials : [],
    createdIp: r.created_ip ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at) : null,
    lastPostAt: r.last_post_at ? new Date(r.last_post_at) : null,
  };
}

export async function agentById(id: string): Promise<AgentRecord | undefined> {
  const r = await q1(`SELECT * FROM agents WHERE id = $1`, [id]);
  return r ? rowToAgent(r) : undefined;
}

export async function agentBySlug(slug: string): Promise<AgentRecord | undefined> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return undefined;
  const r = await q1(`SELECT * FROM agents WHERE slug = $1`, [slug]);
  return r ? rowToAgent(r) : undefined;
}

export function toRef(a: Pick<AgentRecord, "id" | "slug" | "name" | "avatarUrl" | "tier" | "category" | "mode">): AgentRef {
  return { id: a.id, slug: a.slug, name: a.name, avatarUrl: a.avatarUrl, tier: a.tier, category: a.category, mode: a.mode };
}

/** Claudio never discloses what model he runs on; everyone else shows theirs. */
export function publicModel(slug: string, model: string | null | undefined): string | null {
  return slug === "claudio" ? null : model ?? null;
}

export const EMPTY_STATS: AgentStats = { launches: 0, trades: 0, posts: 0, pnlSol: 0, earnedSol: 0 };

/**
 * Hook for server/hosted (or anything else that knows trades/earnings) to contribute stats. Additive: the agents
 * module only counts posts and launches itself.
 */
export type StatsProvider = (agentIds: string[]) => Promise<Map<string, Partial<AgentStats>>>;
const statsProviders: StatsProvider[] = [];
export function registerAgentStatsProvider(fn: StatsProvider): void {
  statsProviders.push(fn);
}

/** Launch record ids/agent links, read defensively (agent_id / launched_by columns may or may not exist yet). */
export async function launchCountsByAgent(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await q(
      `SELECT coalesce(to_jsonb(l)->>'agent_id', a.id) AS agent_id, count(*)::int AS n
         FROM launches l LEFT JOIN agents a ON a.slug = l.request->>'agentSlug'
        WHERE l.status = 'confirmed' AND (to_jsonb(l)->>'agent_id' IS NOT NULL OR a.id IS NOT NULL)
        GROUP BY 1`,
    );
    for (const r of rows) if (r.agent_id) out.set(r.agent_id, Number(r.n));
  } catch {
    /* launches table missing */
  }
  return out;
}

let launchCountCache: { at: number; m: Map<string, number> } | null = null;

export async function statsFor(ids: string[]): Promise<Map<string, AgentStats>> {
  const out = new Map<string, AgentStats>();
  for (const id of ids) out.set(id, { ...EMPTY_STATS });
  if (!ids.length || !pool) return out;
  const posts = await q(
    `SELECT agent_id, count(*)::int AS n FROM messages WHERE agent_id = ANY($1) AND NOT hidden GROUP BY agent_id`,
    [ids],
  ).catch(() => []);
  for (const r of posts) out.get(r.agent_id)!.posts = Number(r.n);
  if (!launchCountCache || Date.now() - launchCountCache.at > 30_000) launchCountCache = { at: Date.now(), m: await launchCountsByAgent() };
  for (const id of ids) out.get(id)!.launches = launchCountCache.m.get(id) ?? 0;
  for (const p of statsProviders) {
    try {
      const m = await p(ids);
      for (const [id, s] of m) {
        const cur = out.get(id);
        if (cur) Object.assign(cur, Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "number" && Number.isFinite(v))));
      }
    } catch (e) {
      console.warn("[agents] stats provider failed:", (e as Error).message);
    }
  }
  return out;
}

export interface ProfileOpts {
  /** Include owner-only details (none today beyond what is public; kept for future fields). */
  owner?: boolean;
}

export function toProfile(a: AgentRecord, stats: AgentStats): AgentProfile {
  return {
    ...toRef(a),
    bio: a.bio,
    model: publicModel(a.slug, a.model),
    socials: a.slug === "claudio" ? CLAUDIO_SOCIALS : a.socials,
    ownerWallet: a.ownerWallet,
    wallet: a.wallet,
    passport: a.passport,
    trust: Math.round(a.trust * 10) / 10,
    status: a.status,
    stats,
    tokens: a.tokens,
    createdAt: a.createdAt.toISOString(),
    lastSeenAt: a.lastSeenAt ? a.lastSeenAt.toISOString() : null,
  };
}

export async function profiles(list: AgentRecord[]): Promise<AgentProfile[]> {
  const stats = await statsFor(list.map((a) => a.id));
  return list.map((a) => toProfile(a, stats.get(a.id) ?? { ...EMPTY_STATS }));
}

export async function profileOf(a: AgentRecord): Promise<AgentProfile> {
  return (await profiles([a]))[0];
}

// ─── scheduler state (small JSON blobs) ──────────────────────────────

export async function getState<T extends Record<string, unknown>>(key: string): Promise<T> {
  const r = await q1(`SELECT value FROM agent_scheduler_state WHERE key = $1`, [key]).catch(() => undefined);
  return ((r?.value as T) ?? ({} as T));
}

export async function setState(key: string, value: Record<string, unknown>): Promise<void> {
  await q(
    `INSERT INTO agent_scheduler_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = agent_scheduler_state.value || EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** Runs `fn` under a Postgres advisory lock (skips when another instance holds it). */
export async function withLock<T>(lockId: number, fn: () => Promise<T>): Promise<T | undefined> {
  const p = db() as any;
  // node-postgres / neon pools: take a dedicated client so lock + unlock land on the same session.
  if (typeof p.connect === "function") {
    const c = await p.connect();
    try {
      const r = await c.query(`SELECT pg_try_advisory_lock($1) AS ok`, [lockId]);
      if (!r.rows[0]?.ok) return undefined;
      try {
        return await fn();
      } finally {
        await c.query(`SELECT pg_advisory_unlock($1)`, [lockId]).catch(() => {});
      }
    } finally {
      c.release();
    }
  }
  return fn();
}
