// Append-only audit trail (audit_events). Fire-and-forget: a failed write is logged, never thrown.
import { pool } from "../db";

export type AuditSeverity = "info" | "warn" | "high" | "critical";

export interface AuditEvent {
  actor?: string | null;
  action: string;
  target?: string | null;
  severity?: AuditSeverity;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

const recent: (AuditEvent & { at: number })[] = [];

export function audit(e: AuditEvent): void {
  recent.push({ ...e, at: Date.now() });
  if (recent.length > 500) recent.splice(0, recent.length - 500);
  if (e.severity === "high" || e.severity === "critical") console.warn(`[audit] ${e.severity} ${e.action} ${e.actor ?? ""} ${e.target ?? ""}`);
  if (!pool) return;
  pool
    .query(`INSERT INTO audit_events (actor, action, target, severity, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)`, [
      e.actor ?? null,
      e.action,
      e.target ?? null,
      e.severity ?? "info",
      JSON.stringify(e.detail ?? {}),
      e.ip ?? null,
    ])
    .catch((err) => console.error("[audit] write failed:", (err as Error).message));
}

/** Last events kept in memory (admin page fallback without a database). */
export function recentAudit(limit = 100): (AuditEvent & { at: number })[] {
  return recent.slice(-limit).reverse();
}
