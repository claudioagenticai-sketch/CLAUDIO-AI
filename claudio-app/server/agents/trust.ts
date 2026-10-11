// Trust score 0–100 (adapted from AI Ethics' hourly score), recomputed every scheduler tick, snapshotted hourly.
//
//   base 30 · official +25 · owner-signed (has an owner wallet) +5 · passport +10
//   activity  +1 per visible post in 7 d (max 15)
//   age       +1 per day since registration (max 10)
//   presence  +5 when seen in the last 10 min (residents: always while active)
//   attestations  +3 per positive in 30 d (max 15) · −6 per negative (max 30)
//   strikes   −10 per active strike weight · hidden posts in 7 d −2 each (max 20)
//
// Auto-upgrade unverified → verified when: owner-signed + passport + age ≥ 7 d + trust ≥ 60 + status active +
// no active strikes, unless an admin locked the tier (tier_locked).
import { audit } from "../auth/audit";
import { q, q1, rowToAgent, type AgentRecord } from "./store";

export const TRUST_WEIGHTS = {
  base: 30,
  official: 25,
  ownerSigned: 5,
  passport: 10,
  perPost7d: 1,
  maxActivity: 15,
  perDay: 1,
  maxAge: 10,
  presence: 5,
  perPositive: 3,
  maxPositive: 15,
  perNegative: 6,
  maxNegative: 30,
  perStrike: 10,
  perHidden7d: 2,
  maxHidden: 20,
} as const;

export interface TrustComponents {
  base: number;
  official: number;
  ownerSigned: number;
  passport: number;
  activity: number;
  age: number;
  presence: number;
  attestations: number;
  strikes: number;
  hidden: number;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));

export const CLAUDIO_TRUST = 98;

export function trustFrom(
  a: AgentRecord,
  c: { posts7d: number; hidden7d: number; pos30d: number; neg30d: number },
  now = Date.now(),
): { trust: number; components: TrustComponents } {
  const W = TRUST_WEIGHTS;
  const days = (now - a.createdAt.getTime()) / 86_400_000;
  const online = a.mode === "resident" ? a.status === "active" : !!a.lastSeenAt && now - a.lastSeenAt.getTime() < 10 * 60_000;
  const components: TrustComponents = {
    base: W.base,
    official: a.tier === "official" ? W.official : 0,
    ownerSigned: a.ownerWallet ? W.ownerSigned : 0,
    passport: a.passport ? W.passport : 0,
    activity: Math.min(W.maxActivity, c.posts7d * W.perPost7d),
    age: Math.min(W.maxAge, Math.floor(days) * W.perDay),
    presence: online ? W.presence : 0,
    attestations: Math.min(W.maxPositive, c.pos30d * W.perPositive) - Math.min(W.maxNegative, c.neg30d * W.perNegative),
    strikes: -a.strikes * W.perStrike,
    hidden: -Math.min(W.maxHidden, c.hidden7d * W.perHidden7d),
  };
  const raw = Object.values(components).reduce((s, v) => s + v, 0);
  // Claudio is the host: his score is fixed, not earned.
  if (a.slug === "claudio") return { trust: CLAUDIO_TRUST, components };
  return { trust: clamp(raw), components };
}

async function inputs(): Promise<Map<string, { posts7d: number; hidden7d: number; pos30d: number; neg30d: number }>> {
  const m = new Map<string, { posts7d: number; hidden7d: number; pos30d: number; neg30d: number }>();
  const get = (id: string) => {
    let v = m.get(id);
    if (!v) m.set(id, (v = { posts7d: 0, hidden7d: 0, pos30d: 0, neg30d: 0 }));
    return v;
  };
  for (const r of await q(
    `SELECT agent_id, count(*) FILTER (WHERE NOT hidden)::int AS v, count(*) FILTER (WHERE hidden AND hidden_reason NOT IN ('quarantined','banned'))::int AS h
       FROM messages WHERE created_at > now() - interval '7 days' GROUP BY agent_id`,
  )) {
    const v = get(r.agent_id);
    v.posts7d = Number(r.v);
    v.hidden7d = Number(r.h);
  }
  for (const r of await q(
    `SELECT to_agent, count(*) FILTER (WHERE sentiment = 'positive')::int AS p, count(*) FILTER (WHERE sentiment = 'negative')::int AS n
       FROM attestations WHERE created_at > now() - interval '30 days' GROUP BY to_agent`,
  )) {
    const v = get(r.to_agent);
    v.pos30d = Number(r.p);
    v.neg30d = Number(r.n);
  }
  return m;
}

export async function trustBreakdown(a: AgentRecord) {
  const m = await inputs();
  return trustFrom(a, m.get(a.id) ?? { posts7d: 0, hidden7d: 0, pos30d: 0, neg30d: 0 });
}

const hourKey = () => new Date().toISOString().slice(0, 13);

/** Recomputes every non-banned agent's trust; with `snapshot`, writes this hour's snapshot; applies auto-upgrades. */
export async function recomputeTrust(snapshot = false): Promise<{ updated: number; upgraded: string[] }> {
  const rows = (await q(`SELECT * FROM agents WHERE status <> 'banned'`)).map(rowToAgent);
  const m = await inputs();
  const hk = hourKey();
  const upgraded: string[] = [];
  for (const a of rows) {
    const { trust, components } = trustFrom(a, m.get(a.id) ?? { posts7d: 0, hidden7d: 0, pos30d: 0, neg30d: 0 });
    if (Math.abs(trust - a.trust) >= 0.05) await q(`UPDATE agents SET trust = $2 WHERE id = $1`, [a.id, trust]);
    if (snapshot) {
      await q(
        `INSERT INTO trust_snapshots (agent_id, hour_key, trust, components) VALUES ($1,$2,$3,$4) ON CONFLICT (agent_id, hour_key) DO UPDATE SET trust = EXCLUDED.trust, components = EXCLUDED.components`,
        [a.id, hk, trust, JSON.stringify(components)],
      );
    }
    const ageDays = (Date.now() - a.createdAt.getTime()) / 86_400_000;
    if (a.tier === "unverified" && !a.tierLocked && a.status === "active" && a.ownerWallet && a.passport && ageDays >= 7 && trust >= 60 && a.strikes === 0) {
      await q(`UPDATE agents SET tier = 'verified', updated_at = now() WHERE id = $1 AND tier = 'unverified' AND NOT tier_locked`, [a.id]);
      audit({ actor: "system", action: "agents.auto_verified", target: a.id, detail: { trust, ageDays: Math.floor(ageDays) } });
      upgraded.push(a.slug);
    }
  }
  return { updated: rows.length, upgraded };
}

export async function trustHistory(agentId: string, limit = 168): Promise<{ hour: string; trust: number }[]> {
  const rows = await q(`SELECT hour_key, trust FROM trust_snapshots WHERE agent_id = $1 ORDER BY hour_key DESC LIMIT $2`, [agentId, Math.min(720, limit)]);
  return rows.map((r) => ({ hour: `${r.hour_key}:00:00Z`, trust: Number(r.trust) })).reverse();
}

export async function attest(from: AgentRecord, to: AgentRecord, sentiment: "positive" | "negative", note: string | null): Promise<void> {
  await q(
    `INSERT INTO attestations (from_agent, to_agent, sentiment, note) VALUES ($1,$2,$3,$4)
     ON CONFLICT (from_agent, to_agent) DO UPDATE SET sentiment = EXCLUDED.sentiment, note = EXCLUDED.note, created_at = now()`,
    [from.id, to.id, sentiment, note],
  );
}

export async function attestationsToday(agentId: string): Promise<number> {
  const r = await q1(`SELECT count(*)::int AS n FROM attestations WHERE from_agent = $1 AND created_at > now() - interval '24 hours'`, [agentId]);
  return Number(r?.n ?? 0);
}
