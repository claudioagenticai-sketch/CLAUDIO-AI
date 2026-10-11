// Persistence for the hosted module: global settings (kill switch), decision/action log, owner approvals,
// runner state. Everything degrades to "nothing" without a database.
import { createHash, randomBytes } from "crypto";
import type { AgentActionLog, AgentApproval, AgentApprovalStatus, AgentRunState } from "@shared/agents";
import { pool } from "../db";
import { hostedEnv } from "./config";

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// ─── global kill switch ──────────────────────────────────────────────

export interface KillState {
  killed: boolean;
  reason?: string | null;
  by?: string | null;
  at?: string | null;
}

let killCache: { v: KillState; at: number } | null = null;

export async function globalKill(): Promise<KillState> {
  if (hostedEnv.forcedKill()) return { killed: true, reason: "HOSTED_KILL env", by: "env", at: null };
  if (killCache && Date.now() - killCache.at < 5_000) return killCache.v;
  let v: KillState = { killed: false };
  if (pool) {
    try {
      const r = await pool.query(`SELECT value FROM hosted_settings WHERE key = 'kill'`);
      if (r.rows[0]) v = { killed: !!r.rows[0].value.killed, reason: r.rows[0].value.reason ?? null, by: r.rows[0].value.by ?? null, at: r.rows[0].value.at ?? null };
    } catch {
      v = { killed: true, reason: "settings unreadable (fail closed)" };
    }
  }
  killCache = { v, at: Date.now() };
  return v;
}

export async function setGlobalKill(killed: boolean, by: string, reason?: string): Promise<KillState> {
  const v: KillState = { killed, reason: reason?.slice(0, 300) ?? null, by, at: new Date().toISOString() };
  if (!pool) throw new Error("database unavailable");
  await pool.query(
    `INSERT INTO hosted_settings (key, value, updated_by, updated_at) VALUES ('kill', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(v), by],
  );
  killCache = null;
  return v;
}

// ─── action log (ring buffer) ────────────────────────────────────────

export async function logAction(
  agentId: string,
  kind: string,
  e: { ok?: boolean; model?: string | null; summary?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO agent_actions (agent_id, kind, ok, model, summary, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [
      agentId,
      kind.slice(0, 40),
      e.ok ?? true,
      e.model ?? null,
      (e.summary ?? "").slice(0, 500) || null,
      JSON.stringify(e.detail ?? {}),
    ]);
  } catch (err) {
    console.error("[hosted] action log failed:", (err as Error).message);
  }
}

export async function listActions(agentId: string, limit = 100): Promise<AgentActionLog[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, kind, ok, model, summary, detail, created_at FROM agent_actions WHERE agent_id = $1 ORDER BY id DESC LIMIT $2`,
    [agentId, Math.max(1, Math.min(500, limit))],
  );
  return r.rows.map((x) => ({ id: Number(x.id), kind: x.kind, ok: x.ok, model: x.model, summary: x.summary, detail: x.detail ?? {}, at: iso(x.created_at)! }));
}

/** Keeps the newest `keep` rows per agent and expires stale approvals. */
export async function cleanup(keep = hostedEnv.logKeep()): Promise<{ actions: number; approvals: number }> {
  if (!pool) return { actions: 0, approvals: 0 };
  const a = await pool.query(
    `DELETE FROM agent_actions a USING (
       SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY agent_id ORDER BY id DESC) AS rn FROM agent_actions) x WHERE x.rn > $1
     ) old WHERE a.id = old.id`,
    [keep],
  );
  const b = await pool.query(`UPDATE agent_approvals SET status = 'expired', decided_at = now() WHERE status IN ('pending','approved') AND expires_at <= now()`);
  return { actions: a.rowCount ?? 0, approvals: b.rowCount ?? 0 };
}

// ─── approvals ("ask the owner above X") ─────────────────────────────

export function intentHash(intent: Record<string, unknown>): string {
  const canon = JSON.stringify(Object.keys(intent).sort().reduce((o, k) => ({ ...o, [k]: intent[k] }), {} as Record<string, unknown>));
  return createHash("sha256").update(canon).digest("hex");
}

function approvalSummary(kind: string, intent: Record<string, unknown> | null): string | null {
  if (kind !== "thread_post" || !intent) return null;
  const text = String(intent.content ?? "").replace(/\s+/g, " ");
  return `Post in #${String(intent.room ?? "")}: “${text.length > 160 ? text.slice(0, 159) + "…" : text}”`;
}

function mapApproval(x: any): AgentApproval {
  return {
    id: x.id,
    kind: x.kind,
    intent: x.intent,
    amountSol: Number(x.amount_sol),
    reason: x.reason,
    summary: approvalSummary(x.kind, x.intent),
    status: x.status as AgentApprovalStatus,
    result: x.result ?? null,
    createdAt: iso(x.created_at)!,
    expiresAt: iso(x.expires_at)!,
    decidedAt: iso(x.decided_at),
  };
}

export async function createApproval(agentId: string, intent: Record<string, unknown> & { kind: string; amountSol: number }, reason: string): Promise<AgentApproval | null> {
  if (!pool) return null;
  const hash = intentHash(intent);
  // One pending approval per identical intent: re-asking doesn't spam the owner.
  const dup = await pool.query(`SELECT * FROM agent_approvals WHERE agent_id = $1 AND intent_hash = $2 AND status = 'pending' AND expires_at > now() LIMIT 1`, [agentId, hash]);
  if (dup.rows[0]) return mapApproval(dup.rows[0]);
  const pending = await pool.query(`SELECT count(*)::int AS n FROM agent_approvals WHERE agent_id = $1 AND status = 'pending' AND expires_at > now()`, [agentId]);
  if ((pending.rows[0]?.n ?? 0) >= 20) return null;
  const id = "apr_" + randomBytes(10).toString("hex");
  const r = await pool.query(
    `INSERT INTO agent_approvals (id, agent_id, kind, intent, intent_hash, amount_sol, reason, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '24 hours') RETURNING *`,
    [id, agentId, intent.kind, JSON.stringify(intent), hash, intent.amountSol, reason.slice(0, 300)],
  );
  return mapApproval(r.rows[0]);
}

export async function getApproval(agentId: string, id: string): Promise<AgentApproval | null> {
  if (!pool || !/^apr_[0-9a-f]{20}$/.test(id)) return null;
  const r = await pool.query(`SELECT * FROM agent_approvals WHERE id = $1 AND agent_id = $2`, [id, agentId]);
  return r.rows[0] ? mapApproval(r.rows[0]) : null;
}

export async function listApprovals(agentId: string, limit = 50): Promise<AgentApproval[]> {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM agent_approvals WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`, [agentId, limit]);
  return r.rows.map(mapApproval);
}

/** pending → approved|rejected, atomically (one decision wins). */
export async function decideApproval(agentId: string, id: string, approve: boolean, by: string): Promise<AgentApproval | null> {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE agent_approvals SET status = $3, decided_by = $4, decided_at = now()
     WHERE id = $1 AND agent_id = $2 AND status = 'pending' AND expires_at > now() RETURNING *`,
    [id, agentId, approve ? "approved" : "rejected", by],
  );
  return r.rows[0] ? mapApproval(r.rows[0]) : null;
}

/** True when `id` is an approved, unexpired approval of exactly this intent for this agent. */
export async function approvalValid(agentId: string, id: string, hash: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `SELECT 1 FROM agent_approvals WHERE id = $1 AND agent_id = $2 AND intent_hash = $3 AND status = 'approved' AND expires_at > now()`,
    [id, agentId, hash],
  );
  return !!r.rows[0];
}

/** approved → executed, atomically: the only way an approval is spent (so it can't execute twice). */
export async function consumeApproval(agentId: string, id: string, hash: string): Promise<boolean> {
  if (!pool) return false;
  const r = await pool.query(
    `UPDATE agent_approvals SET status = 'executed' WHERE id = $1 AND agent_id = $2 AND intent_hash = $3 AND status = 'approved' AND expires_at > now() RETURNING id`,
    [id, agentId, hash],
  );
  return !!r.rows[0];
}

export async function finishApproval(id: string, status: "executed" | "failed", result: Record<string, unknown>): Promise<void> {
  if (!pool) return;
  await pool.query(`UPDATE agent_approvals SET status = $2, result = $3 WHERE id = $1`, [id, status, JSON.stringify(result)]).catch(() => {});
}

// ─── runner state ────────────────────────────────────────────────────

export interface RuntimeRow extends AgentRunState {
  agentId: string;
  memory: string;
}

function mapRuntime(x: any): RuntimeRow {
  return {
    agentId: x.agent_id,
    running: x.running,
    goals: x.goals ?? "",
    memory: x.memory ?? "",
    runs: x.runs ?? 0,
    failures: x.failures ?? 0,
    lastError: x.last_error,
    lastRunAt: iso(x.last_run_at),
    nextRunAt: iso(x.next_run_at),
  };
}

export async function getRuntime(agentId: string): Promise<RuntimeRow> {
  const blank: RuntimeRow = { agentId, running: false, goals: "", memory: "", runs: 0, failures: 0, lastError: null, lastRunAt: null, nextRunAt: null };
  if (!pool) return blank;
  const r = await pool.query(`SELECT * FROM agent_runtime WHERE agent_id = $1`, [agentId]);
  return r.rows[0] ? mapRuntime(r.rows[0]) : blank;
}

export async function setRunning(agentId: string, running: boolean, by: string, goals?: string): Promise<RuntimeRow> {
  if (!pool) throw new Error("database unavailable");
  const r = await pool.query(
    `INSERT INTO agent_runtime (agent_id, running, goals, started_by, next_run_at, failures, last_error, updated_at)
     VALUES ($1, $2, COALESCE($3, ''), $4, CASE WHEN $2 THEN now() ELSE NULL END, 0, NULL, now())
     ON CONFLICT (agent_id) DO UPDATE SET running = $2, goals = COALESCE($3, agent_runtime.goals), started_by = $4,
       next_run_at = CASE WHEN $2 THEN now() ELSE NULL END, failures = CASE WHEN $2 THEN 0 ELSE agent_runtime.failures END,
       last_error = CASE WHEN $2 THEN NULL ELSE agent_runtime.last_error END, updated_at = now()
     RETURNING *`,
    [agentId, running, goals === undefined ? null : goals.slice(0, 1000), by],
  );
  return mapRuntime(r.rows[0]);
}

/** Atomically claims a due agent for one run (pushes next_run_at forward first, so a crash can't loop it). */
export async function claimDue(limit: number, leaseSec = 300): Promise<string[]> {
  if (!pool) return [];
  const r = await pool.query(
    `UPDATE agent_runtime SET next_run_at = now() + make_interval(secs => $2)
     WHERE agent_id IN (
       SELECT agent_id FROM agent_runtime WHERE running AND (next_run_at IS NULL OR next_run_at <= now())
       ORDER BY next_run_at NULLS FIRST LIMIT $1 FOR UPDATE SKIP LOCKED
     ) RETURNING agent_id`,
    [limit, leaseSec],
  );
  return r.rows.map((x) => x.agent_id as string);
}

export async function finishRun(agentId: string, e: { ok: boolean; memory?: string; error?: string; nextInMs: number }): Promise<void> {
  if (!pool) return;
  if (e.ok) {
    await pool.query(
      `UPDATE agent_runtime SET runs = runs + 1, failures = 0, last_error = NULL, last_run_at = now(),
         memory = COALESCE($2, memory), next_run_at = CASE WHEN running THEN now() + make_interval(secs => $3) ELSE NULL END, updated_at = now()
       WHERE agent_id = $1`,
      [agentId, e.memory ?? null, Math.round(e.nextInMs / 1000)],
    );
    return;
  }
  // Failure: exponential backoff; 5 consecutive failures pause the agent (owner restarts it).
  await pool.query(
    `UPDATE agent_runtime SET failures = failures + 1, last_error = $2, last_run_at = now(),
       running = CASE WHEN failures + 1 >= 5 THEN false ELSE running END,
       next_run_at = CASE WHEN failures + 1 >= 5 OR NOT running THEN NULL ELSE now() + make_interval(secs => $3 * power(2, LEAST(failures, 4))) END,
       updated_at = now()
     WHERE agent_id = $1`,
    [agentId, (e.error ?? "error").slice(0, 300), Math.round(e.nextInMs / 1000)],
  );
}

export async function countRunning(): Promise<number> {
  if (!pool) return 0;
  try {
    const r = await pool.query(`SELECT count(*)::int AS n FROM agent_runtime WHERE running`);
    return r.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}
