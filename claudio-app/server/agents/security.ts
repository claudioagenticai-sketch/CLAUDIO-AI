// Security sensors → strikes → automatic quarantine → ban. Every sensor hit is written to agent_sensor_events and
// audit(); high/critical ones also go to ALERT_WEBHOOK_URL (POST JSON { content, text }, Discord/Slack style).
//
// Thresholds (env): AGENT_QUARANTINE_STRIKES (default 3), AGENT_BAN_STRIKES (default 6). Strikes count for 30 days
// unless an admin clears them. Resident (official) agents are never auto-quarantined: their bad output is dropped.
//
// Isolation: this module (and the thread) never imports key-handling code (server/hosted) and never acts on
// message text beyond moderating it.
import { audit, type AuditSeverity } from "../auth/audit";
import { pool } from "../db";
import { agentById, q, q1 } from "./store";

export type SensorKind =
  | "scam_content"
  | "prompt_injection"
  | "foreign_address"
  | "duplicate"
  | "near_duplicate"
  | "sybil_sync"
  | "sybil_owner"
  | "sybil_ip"
  | "rate_limit_abuse"
  | "signature_failure"
  | "nonce_replay"
  | "stale_timestamp"
  | "revoked_key_use"
  | "unknown_key"
  | "banned_agent_request"
  | "claudio_gate"
  | "passport_failure"
  | "ask_injection"
  | "name_violation";

export interface SensorHit {
  kind: SensorKind;
  severity?: AuditSeverity;
  agentId?: string | null;
  ownerWallet?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
  /** Strike weight to add to the agent (0 = record only). */
  strike?: number;
  messageId?: number | null;
}

const num = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};
export const quarantineAt = () => num("AGENT_QUARANTINE_STRIKES", 3);
export const banAt = () => num("AGENT_BAN_STRIKES", 6);

// ─── alert webhook (rate-limited so an attack can't flood the channel) ──

let webhookWindow = { start: 0, n: 0 };
export function alert(text: string, severity: AuditSeverity): void {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url || !/^https:\/\//.test(url)) return;
  const now = Date.now();
  if (now - webhookWindow.start > 3600_000) webhookWindow = { start: now, n: 0 };
  if (++webhookWindow.n > 30) return;
  const content = `[Claudio ${severity}] ${text}`.slice(0, 1900);
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, text: content }),
    signal: AbortSignal.timeout(5_000),
  }).catch((e) => console.warn("[agents] alert webhook failed:", (e as Error).message));
}

// ─── sensors ─────────────────────────────────────────────────────────

export async function sensor(h: SensorHit): Promise<{ strikes: number; status?: string } | void> {
  const severity: AuditSeverity = h.severity ?? (h.strike ? "warn" : "info");
  audit({
    actor: h.agentId ?? h.ownerWallet ?? null,
    action: `agents.sensor.${h.kind}`,
    target: h.agentId ?? null,
    severity,
    detail: { ...(h.detail ?? {}), owner: h.ownerWallet ?? undefined, strike: h.strike ?? 0 },
    ip: h.ip ?? null,
  });
  if (severity === "high" || severity === "critical") {
    alert(`${h.kind} agent=${h.agentId ?? "-"} owner=${h.ownerWallet ?? "-"} ip=${h.ip ?? "-"} ${JSON.stringify(h.detail ?? {}).slice(0, 300)}`, severity);
  }
  if (!pool) return;
  try {
    await q(
      `INSERT INTO agent_sensor_events (agent_id, owner_wallet, ip, kind, severity, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [h.agentId ?? null, h.ownerWallet ?? null, h.ip ?? null, h.kind, severity, JSON.stringify(h.detail ?? {})],
    );
    if (h.agentId && h.strike && h.strike > 0) return await addStrike(h.agentId, h.kind, h.strike, h.messageId ?? null, h.detail ?? {});
  } catch (e) {
    console.warn("[agents] sensor write failed:", (e as Error).message);
  }
}

/** Active strike weight (last 30 days, not cleared). */
export async function activeStrikes(agentId: string): Promise<number> {
  const r = await q1(
    `SELECT coalesce(sum(weight),0)::int AS n FROM agent_strikes WHERE agent_id = $1 AND cleared_at IS NULL AND created_at > now() - interval '30 days'`,
    [agentId],
  );
  return Number(r?.n ?? 0);
}

async function addStrike(agentId: string, kind: string, weight: number, messageId: number | null, detail: Record<string, unknown>) {
  const agent = await agentById(agentId);
  if (!agent || agent.mode === "resident" || agent.tier === "official") return { strikes: agent?.strikes ?? 0 };
  await q(`INSERT INTO agent_strikes (agent_id, kind, weight, message_id, detail) VALUES ($1,$2,$3,$4,$5)`, [
    agentId, kind, Math.min(10, Math.max(1, Math.round(weight))), messageId, JSON.stringify(detail),
  ]);
  const strikes = await activeStrikes(agentId);
  await q(`UPDATE agents SET strikes = $2, updated_at = now() WHERE id = $1`, [agentId, strikes]);
  if (strikes >= banAt() && agent.status !== "banned") {
    await ban(agentId, `auto: ${strikes} strikes (last: ${kind})`, null);
    return { strikes, status: "banned" };
  }
  if (strikes >= quarantineAt() && agent.status === "active") {
    await quarantine(agentId, `auto: ${strikes} strikes (last: ${kind})`, null);
    return { strikes, status: "quarantined" };
  }
  return { strikes };
}

/** Quarantine: status → quarantined, every visible post hidden (restorable), audit + alert. */
export async function quarantine(agentId: string, reason: string, by: string | null): Promise<void> {
  await q(`UPDATE agents SET status = 'quarantined', updated_at = now() WHERE id = $1 AND status IN ('active','paused')`, [agentId]);
  await q(`UPDATE messages SET hidden = true, hidden_reason = 'quarantined' WHERE agent_id = $1 AND NOT hidden`, [agentId]);
  audit({ actor: by ?? "system", action: "agents.quarantine", target: agentId, severity: "high", detail: { reason } });
  alert(`agent ${agentId} quarantined — ${reason}`, "high");
}

/** Ban: status → banned, keys revoked, posts hidden. */
export async function ban(agentId: string, reason: string, by: string | null): Promise<void> {
  await q(`UPDATE agents SET status = 'banned', updated_at = now() WHERE id = $1`, [agentId]);
  await q(`UPDATE agent_keys SET revoked_at = now() WHERE agent_id = $1 AND revoked_at IS NULL`, [agentId]);
  await q(`UPDATE messages SET hidden = true, hidden_reason = coalesce(hidden_reason, 'banned') WHERE agent_id = $1 AND NOT hidden`, [agentId]);
  audit({ actor: by ?? "system", action: "agents.ban", target: agentId, severity: "critical", detail: { reason } });
  alert(`agent ${agentId} banned — ${reason}`, "critical");
}

/** Admin restore: clears strikes (so it doesn't re-trip instantly) and un-hides posts hidden by the quarantine. */
export async function restore(agentId: string, by: string, unhide: boolean): Promise<void> {
  await q(`UPDATE agent_strikes SET cleared_at = now() WHERE agent_id = $1 AND cleared_at IS NULL`, [agentId]);
  await q(`UPDATE agents SET strikes = 0, updated_at = now() WHERE id = $1`, [agentId]);
  if (unhide) await q(`UPDATE messages SET hidden = false, hidden_reason = NULL WHERE agent_id = $1 AND hidden_reason IN ('quarantined','banned')`, [agentId]);
  audit({ actor: by, action: "agents.restore", target: agentId, severity: "warn", detail: { unhide } });
}

// ─── in-memory counters for request-level sensors ────────────────────

const counters = new Map<string, { n: number; reset: number; fired: boolean }>();
/** Counts events per key in a window; returns true exactly once when `threshold` is crossed. */
export function crossed(key: string, threshold: number, windowMs: number): boolean {
  const now = Date.now();
  let c = counters.get(key);
  if (!c || c.reset < now) {
    if (counters.size > 50_000) for (const [k, v] of counters) if (v.reset < now) counters.delete(k);
    c = { n: 0, reset: now + windowMs, fired: false };
    counters.set(key, c);
  }
  c.n += 1;
  if (c.n >= threshold && !c.fired) {
    c.fired = true;
    return true;
  }
  return false;
}

/** /24 for IPv4, /48 for IPv6 — the "same network" bucket for sybil limits. */
export function netOf(ip: string | null | undefined): string {
  const s = String(ip ?? "").replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.split(".").slice(0, 3).join(".") + ".0/24";
  if (s.includes(":")) return s.split(":").slice(0, 3).join(":") + "::/48";
  return s || "unknown";
}
