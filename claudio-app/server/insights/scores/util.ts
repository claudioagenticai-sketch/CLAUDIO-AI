// Shared helpers for the GMGN-skill ports. Everything here is pure and total: no input can make it throw.
// GMGN sends almost every number as a JSON string ("0.1783", "", null), so all reads go through num()/numOrNull().
import type { Score, ScoreReason } from "@shared/insights";

export const UNKNOWN_SCORE: Score = { value: 0, grade: "unknown", title: "Not enough data", reasons: [], summary: "Not enough data yet." };

export interface Candle {
  t: number; // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume USD
}

export type Dict = Record<string, unknown>;

/** A plain object, or {} — never throws on null / arrays / primitives. */
export function obj(v: unknown): Dict {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {};
}
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
export function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

/** Accepts either the `data` field or a whole `{code, message, data}` envelope. */
export function unwrap(v: unknown): unknown {
  const o = obj(v);
  if ("data" in o && ("code" in o || "message" in o)) return o.data;
  return v;
}

/** Python `_f`: float(v) or default. Booleans count as 1/0, "" and garbage fall back. */
export function num(v: unknown, d = 0): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : d;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return d;
    const n = Number(s);
    return Number.isFinite(n) ? n : d;
  }
  return d;
}

/** null when the field is absent / empty / non-numeric — "unavailable", never a silent 0. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && !v.trim()) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Python `_b`: real bools, 0/1, "true"/"1"/"yes". */
export function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["1", "true", "yes"].includes(v.trim().toLowerCase());
  return false;
}

export function clamp(x: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

/** One-decimal rounding, as the skills do at computation time so on-screen terms add up. */
export function r1(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** dev_score.py `med()`: xs[len//2] — the UPPER median (kept as the source has it). */
export function medUpper(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Python statistics.median — the true median (used by the wallet skills). */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** wallet-analysis `quantile()`: nearest-rank on the sorted sample. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.max(0, Math.min(s.length - 1, Math.round(q * (s.length - 1))));
  return s[k];
}

export function nowSeconds(now?: number): number {
  const n = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  // Accept seconds too: anything below 1e12 cannot be a unix-ms timestamp after 2001.
  return n < 1e12 ? n : n / 1000;
}

// ─── formatting (plain English, no advice) ──────────────────────────────

export function usd(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  if (a >= 10) return `${sign}$${a.toFixed(0)}`;
  return `${sign}$${a.toFixed(2)}`;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function dur(sec: number): string {
  if (!(sec > 0)) return "0s";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ─── score builder ──────────────────────────────────────────────────────
// Every Score we emit satisfies Σ reasons.points === value (to rounding): a start reason carries the base and
// every adjustment, shrink, cap and clamp is a signed reason of its own. That is what lets the UI explain any number.

export class Tally {
  value = 0;
  reasons: ScoreReason[] = [];

  start(label: string, points: number, field?: string): this {
    this.value = r1(points);
    this.reasons.push(field ? { label, points: this.value, field } : { label, points: this.value });
    return this;
  }

  /** Signed adjustment. Zero deltas are dropped unless `keepZero` (used for disclosed-not-scored facts). */
  add(label: string, delta: number, field?: string, keepZero = false): this {
    const d = r1(delta);
    if (d === 0 && !keepZero) return this;
    this.value = r1(this.value + d);
    this.reasons.push(field ? { label, points: d, field } : { label, points: d });
    return this;
  }

  /** Disclosed fact that does not move the number. */
  note(label: string, field?: string): this {
    return this.add(label, 0, field, true);
  }

  cap(limit: number, label: string, field?: string): this {
    if (this.value > limit) this.add(label, limit - this.value, field);
    return this;
  }

  floor(min: number, label: string, field?: string): this {
    if (this.value < min) this.add(label, min - this.value, field);
    return this;
  }

  clamp(label = "Kept within 0–100"): this {
    return this.floor(0, label).cap(100, label);
  }
}

export function sumPoints(reasons: ScoreReason[]): number {
  return r1(reasons.reduce((a, r) => a + r.points, 0));
}

/** Strip anything that is not a plain label character from third-party text (GMGN tags, symbols). */
export function safeText(v: unknown, max = 24): string {
  const s = str(v).replace(/[^\p{L}\p{N} _.$+\-]/gu, "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
