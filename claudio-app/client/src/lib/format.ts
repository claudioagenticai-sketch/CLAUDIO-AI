// Number/time formatting tuned for a trading terminal: compact, tabular, subscript zeros for tiny prices.

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function subscriptNum(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join("");
}

/** 0.00000123 → "0.0₅123". Values ≥ 0.01 use normal precision. */
export function fmtPrice(v: number, sigDigits = 4): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1000) return sign + fmtCompact(abs, 2);
  if (abs >= 1) return sign + abs.toFixed(abs >= 100 ? 2 : 3);
  if (abs >= 0.01) return sign + abs.toFixed(4);
  const exp = Math.floor(Math.log10(abs)); // e.g. -6
  const zeros = -exp - 1;
  const digits = Math.round(abs * 10 ** (zeros + sigDigits)).toString().slice(0, sigDigits).replace(/0+$/, "");
  return `${sign}0.0${subscriptNum(zeros)}${digits || "0"}`;
}

/** 12345 → "12.3K", 1_234_567 → "1.23M". */
export function fmtCompact(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(abs >= 100 ? 0 : digits)}`;
  if (abs === 0) return "0";
  return `${sign}${abs.toFixed(2)}`;
}

export function fmtUsd(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "$—";
  if (Math.abs(v) < 1 && v !== 0) return `$${fmtPrice(v)}`;
  return `${v < 0 ? "-" : ""}$${fmtCompact(Math.abs(v), digits)}`;
}

/** Native amount, e.g. 0.0123 ETH → "0.0123". Keeps up to 4 significant decimals. */
export function fmtNative(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000) return fmtCompact(v, 2);
  if (abs >= 1) return v.toFixed(3).replace(/\.?0+$/, "");
  if (abs >= 0.0001) return v.toFixed(4).replace(/\.?0+$/, "");
  return fmtPrice(v, 3);
}

export function fmtPct(v: number, digits = 0, signed = false): string {
  if (!Number.isFinite(v)) return "—";
  const s = `${Math.abs(v) < 10 && digits === 0 && v !== 0 && Math.abs(v) < 1 ? v.toFixed(1) : v.toFixed(digits)}%`;
  return signed && v > 0 ? `+${s}` : s;
}

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Age like GMGN: 9s, 21s, 4m, 2h, 3d. */
export function fmtAge(fromMs: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head + (addr.startsWith("0x") ? 2 : 0))}…${addr.slice(-tail)}`;
}

export function toneOf(v: number): "up" | "down" | "flat" {
  return v > 0 ? "up" : v < 0 ? "down" : "flat";
}
