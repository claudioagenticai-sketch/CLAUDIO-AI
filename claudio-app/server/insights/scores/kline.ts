// gmgn-kline-pattern port (skills/gmgn-kline-pattern/SKILL.md): six measurements off the candles → a named pattern
// (first match wins) → a 0–100 score that starts at 50 and states every point. A pattern describes what already
// happened; it is not a prediction.
import type { TokenScores } from "@shared/insights";
import { arr, mean, num, numOrNull, obj, pct, Tally, unwrap, UNKNOWN_SCORE, type Candle } from "./util";

export const KLINE_PATTERNS = [
  "Vertical run-up",
  "Uptrend channel",
  "Breakdown",
  "Bounce off the lows",
  "Distribution at highs",
  "Slow bleed",
  "Basing at lows",
  "Wide chop",
  "Bullish consolidation",
  "Bearish consolidation",
  "Sideways consolidation",
] as const;
export type KlinePattern = (typeof KLINE_PATTERNS)[number];

/**
 * GMGN kline `list` (or the whole `data` / envelope) → Candle[] sorted ascending. Every field arrives as a string.
 * Candles with a missing / non-numeric / ≤ 0 close, high or low are dropped; a missing volume counts as 0.
 * Units, measured on the recorded responses: `time` is unix MILLISECONDS (seconds are accepted and converted), and
 * `volume` is the USD turnover while `amount` is the token count (volume × price ≈ amount on 5m CLAUDIO candles), so
 * `v` comes from `volume`. (The kline skill's text says the opposite; the data disagrees and the data wins.)
 */
export function candlesFromGmgn(list: unknown): Candle[] {
  try {
    const d = unwrap(list);
    const rows = Array.isArray(d) ? d : arr(obj(d).list);
    const out: Candle[] = [];
    for (const r0 of rows) {
      const r = obj(r0);
      const c = numOrNull(r.close);
      const h = numOrNull(r.high);
      const l = numOrNull(r.low);
      if (c === null || h === null || l === null || c <= 0 || h <= 0 || l <= 0) continue;
      let t = num(r.time);
      if (t > 0 && t < 1e12) t *= 1000;
      out.push({ t, o: num(r.open), h, l, c, v: Math.max(0, num(r.volume)) });
    }
    return out.sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

export function klinePattern(input: { candles: Candle[] }): TokenScores["chart"] {
  try {
    return klineUnsafe(input);
  } catch {
    return { ...UNKNOWN_SCORE, pattern: "unknown" };
  }
}

function klineUnsafe(input: { candles: Candle[] }): TokenScores["chart"] {
  const cs = (Array.isArray(input?.candles) ? input.candles : [])
    .filter((x) => x && num(x.c) > 0 && num(x.h) > 0 && num(x.l) > 0)
    .sort((a, b) => num(a.t) - num(b.t));
  if (cs.length < 8) {
    return { ...UNKNOWN_SCORE, title: "Not enough candles", summary: "Not enough candles to read a pattern yet.", pattern: "unknown" };
  }
  const C = cs.map((x) => num(x.c));
  const H = cs.map((x) => num(x.h));
  const L = cs.map((x) => num(x.l));
  const V = cs.map((x) => Math.max(0, num(x.v)));
  const N = C.length;
  const last = C[N - 1];

  // 1. trend_up: 9-bar mean vs 21-bar mean, three-valued (equal is flat, not bearish).
  const m9 = mean(C.slice(-9));
  const m21 = mean(C.slice(-21));
  const trend: "up" | "down" | "flat" = m9 > m21 ? "up" : m9 < m21 ? "down" : "flat";
  // 2. slope: 5-bar average now vs 5 bars twenty bars earlier (both ends averaged so one spike can't dominate).
  let slope: number | null;
  if (N >= 24) {
    const base = mean(C.slice(-24, -19));
    slope = base > 0 ? (mean(C.slice(-5)) - base) / base : null;
  } else slope = C[0] > 0 ? (last - C[0]) / C[0] : null;
  // 3. volatility: mean (high − low) / close over the last 14.
  const volatility = mean(cs.slice(-14).map((x) => (num(x.h) - num(x.l)) / num(x.c)));
  // 4. drawdown from the highest high.
  const maxH = H.reduce((a, b) => Math.max(a, b), 0);
  const drawdown = maxH > 0 ? (maxH - last) / maxH : null;
  // 5. vol_ratio: last bar vs the mean of the previous 20.
  const prevV = mean(V.slice(-21, -1));
  const volRatio = prevV > 0 ? V[N - 1] / prevV : null;
  // 6. up_from_low.
  const minL = L.reduce((a, b) => Math.min(a, b), Infinity);
  const upFromLow = minL > 0 && Number.isFinite(minL) ? (last - minL) / minL : null;

  // ── classify (first match wins; rows whose input is unavailable are skipped) ──
  const s = slope;
  const dd = drawdown;
  let pattern: KlinePattern;
  if (s !== null && dd !== null && s > 0.25 && dd < 0.12) pattern = "Vertical run-up";
  else if (s !== null && dd !== null && s > 0.08 && dd < 0.25) pattern = "Uptrend channel";
  else if (s !== null && dd !== null && dd > 0.55 && s < -0.1) pattern = "Breakdown";
  else if (s !== null && dd !== null && dd > 0.55 && s > 0.02) pattern = "Bounce off the lows";
  else if (s !== null && dd !== null && dd > 0.35 && Math.abs(s) < 0.08) pattern = "Distribution at highs";
  else if (s !== null && s < -0.2) pattern = "Slow bleed";
  else if (s !== null && upFromLow !== null && Math.abs(s) < 0.05 && volatility < 0.05 && upFromLow < 0.2) pattern = "Basing at lows";
  else if (s !== null && Math.abs(s) < 0.08 && volatility > 0.08) pattern = "Wide chop";
  else pattern = trend === "up" ? "Bullish consolidation" : trend === "down" ? "Bearish consolidation" : "Sideways consolidation";

  // ── score: start at 50, every matching rule, clamp 0–100 ──
  const T = new Tally().start("Starts at 50", 50);
  if (trend === "up") T.add("Short-term average above the longer one (9 vs 21 bars)", 12, "kline.close");
  else if (trend === "down") T.add("Short-term average below the longer one (9 vs 21 bars)", -12, "kline.close");
  if (s !== null) {
    const sp = `${s >= 0 ? "+" : ""}${pct(s)}`;
    if (s > 0.15) T.add(`Trending up over the last 20 bars, ${sp}`, 15, "kline.close");
    else if (s > 0.02) T.add(`Mild uptrend, ${sp}`, 6, "kline.close");
    else if (s < -0.15) T.add(`Trending down over the last 20 bars, ${sp}`, -15, "kline.close");
    else if (s < -0.02) T.add(`Slow bleed, ${sp}`, -6, "kline.close");
  }
  if (volRatio !== null) {
    const green = last >= num(cs[N - 1].o);
    if (volRatio > 3 && green) T.add(`Latest bar on ${volRatio.toFixed(1)}× volume, closing up`, 8, "kline.volume");
    else if (volRatio > 3) T.add(`Latest bar on ${volRatio.toFixed(1)}× volume, closing down`, -10, "kline.volume");
    else if (volRatio < 0.3) T.add(`Volume shrank to ${pct(volRatio, 0)} of average`, -5, "kline.volume");
  } else T.note("Volume ratio not measured (no recent volume)", "kline.volume");
  if (dd !== null) {
    if (dd > 0.6) T.add(`Down ${pct(dd, 0)} from the range high`, -15, "kline.high");
    else if (dd > 0.3) T.add(`Down ${pct(dd, 0)} from the range high`, -6, "kline.high");
    else if (dd < 0.05) T.add("Trading right at the range high", 8, "kline.high");
  }
  if (N > 40) {
    const hiNow = C.slice(-20).reduce((a, b) => Math.max(a, b), 0);
    const hiPrev = C.slice(-40, -20).reduce((a, b) => Math.max(a, b), 0);
    if (hiNow > hiPrev * 1.02 && mean(V.slice(-20)) < mean(V.slice(-40, -20)) * 0.7) {
      T.add("New price high on shrinking volume", -10, "kline.volume");
    }
  }
  T.clamp();
  // Context only — changes sizing, not the pattern's strength.
  if (volatility > 0.15) T.note(`Very high volatility (${pct(volatility, 0)} average candle range)`, "kline.high/low");
  else if (volatility < 0.02) T.note(`Low volatility (${pct(volatility)} average candle range)`, "kline.high/low");
  let run = 0;
  let dir = 0;
  for (let i = N - 1; i >= 0; i--) {
    const d = C[i] > num(cs[i].o) ? 1 : C[i] < num(cs[i].o) ? -1 : 0;
    if (d === 0 || (dir && d !== dir)) break;
    dir = d;
    run += 1;
  }
  if (run >= 5) T.note(`${run} ${dir > 0 ? "green" : "red"} candles in a row`, "kline.open/close");

  const value = T.value;
  const grade = value >= 60 ? "good" : value >= 40 ? "mixed" : "risky";
  const bits = [
    s !== null ? `${s >= 0 ? "+" : ""}${pct(s)} over 20 bars` : null,
    dd !== null ? `${pct(dd, 0)} below the range high` : null,
    `${pct(volatility)} average candle range`,
  ].filter(Boolean);
  return { value, grade, title: pattern, pattern, reasons: T.reasons, summary: `${pattern}: ${bits.join(", ")}.` };
}
