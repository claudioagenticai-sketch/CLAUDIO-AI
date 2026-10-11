// Small formatting helpers for insights data (ratios are 0–1 on the wire; the board keeps 0–100).
import { fmtCompact, fmtPct, fmtUsd } from "@/lib/format";

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 0–1 ratio → "12.3%" (or "—"). */
export function ratioPct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return "—";
  const p = v * 100;
  return fmtPct(p, p !== 0 && Math.abs(p) < 10 ? digits : 0);
}

export function usdOrDash(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? fmtUsd(v, digits) : "—";
}

export function countOrDash(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  return Math.abs(v) < 1000 ? String(Math.round(v)) : fmtCompact(v, 1);
}

/** Signed USD like "+$1.2K" / "-$300". */
export function signedUsd(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${fmtUsd(Math.abs(v))}`;
}

export function shortWallet(a: string, head = 4, tail = 4): string {
  return a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

export function tokenAddressOf(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(i + 1);
}

export function tokenHrefOf(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? `/t/sol/${key}` : `/t/${key.slice(0, i)}/${key.slice(i + 1)}`;
}
