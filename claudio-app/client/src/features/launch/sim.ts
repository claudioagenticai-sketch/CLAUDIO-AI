// Instant client-side dev-buy simulator (runs on every keystroke). The server recomputes with exact integer math
// for minTokensOut; these are display numbers.
//
//  Pons V2 (docs/research/pons-v2.md §3, live config 0): supply 1e9, phantom 1.68 ETH, graduation 4.2 ETH.
//    reserved = S·P/(P+T) (285.7M) → sellable 714.3M. net = in·(1 − 1% − creatorTax). out = net·Rt/(Rq+net).
//    Dev buy via LaunchAndBuy is snipe-tax exempt. Snipe tax for others: 9900 >> (t·14/3) bps over 3 s.
//  pump.fun: virtual 30 SOL / 1.073e9 tokens, real 793.1M, fee 1.25% on top of net.
//  Clanker v4: 100B supply in one position [-230400, -120000], 1% LP fee; sniper fee 66.68% → 4.17% over 15 s
//    (parabolic), then 0.
//  Anything else: constant product calibrated from graduationQuote + curveSupplyShare — labelled "estimate".
import type { ChainId } from "@shared/chains";
import { deploymentOf, type LaunchpadId } from "@shared/launchpads";

export type SimModel = "pons" | "pump" | "clanker" | "estimate" | "none";

export interface SnipePoint {
  t: number; // seconds after launch
  pct: number; // tax/fee % a non-exempt buyer pays
}

export interface DevBuySim {
  model: SimModel;
  exact: boolean;
  tokensOut: number;
  supplyPct: number;
  priceImpactPct: number;
  /** Native per token. */
  priceBefore: number;
  priceAfter: number;
  mcapBeforeNative: number;
  mcapAfterNative: number;
  totalSupply: number;
  clamped: boolean;
  /** Share of the curve the dev buy consumes (0–100), curve models only. */
  curveProgressPct?: number;
  devExempt: boolean;
  snipe: SnipePoint[];
  snipeNote: string;
}

const EMPTY: Omit<DevBuySim, "model" | "exact" | "snipe" | "snipeNote" | "devExempt" | "totalSupply"> = {
  tokensOut: 0,
  supplyPct: 0,
  priceImpactPct: 0,
  priceBefore: 0,
  priceAfter: 0,
  mcapBeforeNative: 0,
  mcapAfterNative: 0,
  clamped: false,
};

export function ponsSnipeTimeline(taxBps = 0): SnipePoint[] {
  const cap = 10_000 - 100 - taxBps - 100;
  return [0, 1, 2, 3].map((t) => {
    const raw = 9900 >> Math.floor((t * 14) / 3);
    const bps = t >= 3 ? 0 : Math.min(raw, cap);
    return { t, pct: bps / 100 };
  });
}

export function clankerSnipeTimeline(): SnipePoint[] {
  const start = 666_777;
  const end = 41_673;
  const T = 15;
  return [0, 1, 3, 5, 8, 12, 15, 16].map((t) => {
    let fee: number;
    if (t === 0) fee = start;
    else if (t > T) fee = 0;
    else fee = end + (start - end) * Math.pow((T - t) / T, 2);
    return { t, pct: fee / 10_000 };
  });
}

function ponsSim(amount: number, taxBps: number): DevBuySim {
  const S = 1e9;
  const P = 1.68;
  const T = 4.2;
  const reserved = (S * P) / (P + T);
  const sellable = S - reserved;
  const priceBefore = P / S;
  const base = {
    model: "pons" as const,
    exact: true,
    totalSupply: S,
    devExempt: true,
    snipe: ponsSnipeTimeline(taxBps),
    snipeNote: "Other buyers in the first seconds pay 9900 >> (t·14/3) bps (capped so they net ≥ 1%). Your LaunchAndBuy dev buy is exempt.",
  };
  if (!(amount > 0)) return { ...base, ...EMPTY, priceBefore, priceAfter: priceBefore, mcapBeforeNative: priceBefore * S, mcapAfterNative: priceBefore * S };
  const net = amount * (1 - 0.01 - taxBps / 10_000);
  let out = (net * S) / (P + net);
  let clamped = false;
  if (out > sellable) {
    out = sellable;
    clamped = true;
  }
  const priceAfter = (P + net) / (S - out);
  return {
    ...base,
    tokensOut: out,
    supplyPct: (out / S) * 100,
    priceImpactPct: (priceAfter / priceBefore - 1) * 100,
    priceBefore,
    priceAfter,
    mcapBeforeNative: priceBefore * S,
    mcapAfterNative: priceAfter * S,
    clamped,
    curveProgressPct: (out / sellable) * 100,
  };
}

function pumpSim(amount: number): DevBuySim {
  const vT = 1.073e9;
  const vS = 30;
  const real = 793.1e6;
  const S = 1e9;
  const priceBefore = vS / vT;
  const base = {
    model: "pump" as const,
    exact: true,
    totalSupply: S,
    devExempt: true,
    snipe: [] as SnipePoint[],
    snipeNote: "pump.fun has no anti-snipe tax — anyone can buy in the same slot as your create.",
  };
  if (!(amount > 0)) return { ...base, ...EMPTY, priceBefore, priceAfter: priceBefore, mcapBeforeNative: priceBefore * S, mcapAfterNative: priceBefore * S };
  const net = amount / 1.0125;
  let out = (net * vT) / (vS + net);
  let clamped = false;
  if (out > real) {
    out = real;
    clamped = true;
  }
  const priceAfter = (vS + net) / (vT - out);
  return {
    ...base,
    tokensOut: out,
    supplyPct: (out / S) * 100,
    priceImpactPct: (priceAfter / priceBefore - 1) * 100,
    priceBefore,
    priceAfter,
    mcapBeforeNative: priceBefore * S,
    mcapAfterNative: priceAfter * S,
    clamped,
    curveProgressPct: (out / real) * 100,
  };
}

function clankerSim(amount: number): DevBuySim {
  const S = 100e9;
  const sa = Math.pow(1.0001, -230400 / 2);
  const sb = Math.pow(1.0001, -120000 / 2);
  const L = S / (1 / sa - 1 / sb);
  const priceBefore = sa * sa;
  const base = {
    model: "clanker" as const,
    exact: false, // concentrated-liquidity model of the single position; ignores hook protocol-fee rounding
    totalSupply: S,
    devExempt: true,
    snipe: clankerSnipeTimeline(),
    snipeNote: "Clanker's MEV module charges early buyers a sniper fee that decays over 15 s. Your dev buy runs inside the deploy, before it starts.",
  };
  if (!(amount > 0)) return { ...base, ...EMPTY, priceBefore, priceAfter: priceBefore, mcapBeforeNative: priceBefore * S, mcapAfterNative: priceBefore * S };
  const net = amount * 0.99;
  const s1 = Math.min(sa + net / L, sb);
  const out = L * (1 / sa - 1 / s1);
  const priceAfter = s1 * s1;
  return {
    ...base,
    tokensOut: out,
    supplyPct: (out / S) * 100,
    priceImpactPct: (priceAfter / priceBefore - 1) * 100,
    priceBefore,
    priceAfter,
    mcapBeforeNative: priceBefore * S,
    mcapAfterNative: priceAfter * S,
    clamped: s1 >= sb,
  };
}

function estimateSim(launchpad: LaunchpadId, chain: ChainId, amount: number): DevBuySim {
  const d = deploymentOf(launchpad, chain);
  const G = d?.graduationQuote;
  const share = d?.curveSupplyShare;
  const S = d?.totalSupply ?? 1e9;
  const snipe: SnipePoint[] = d?.snipeTax
    ? [0, d.snipeTax.windowSec / 2, d.snipeTax.windowSec].map((t, i) => ({ t, pct: i === 2 ? 0 : (d.snipeTax!.startBps / 100) * (1 - t / d.snipeTax!.windowSec) }))
    : [];
  if (!G || !share || share <= 0 || share >= 1) {
    return {
      model: "none",
      exact: false,
      ...EMPTY,
      totalSupply: S,
      devExempt: false,
      snipe,
      snipeNote: "No simulator for this launchpad yet.",
    };
  }
  // Virtual quote V such that selling share·S raises exactly G: G·S/(V+G) = share·S → V = G(1−share)/share.
  const V = (G * (1 - share)) / share;
  const fee = (d?.curveFeeBps ?? 100) / 10_000;
  const priceBefore = V / S;
  const net = Math.max(0, amount) * (1 - fee);
  let out = net > 0 ? (net * S) / (V + net) : 0;
  const sellable = share * S;
  const clamped = out > sellable;
  if (clamped) out = sellable;
  const priceAfter = (V + net) / (S - out);
  return {
    model: "estimate",
    exact: false,
    tokensOut: out,
    supplyPct: (out / S) * 100,
    priceImpactPct: (priceAfter / priceBefore - 1) * 100,
    priceBefore,
    priceAfter,
    mcapBeforeNative: priceBefore * S,
    mcapAfterNative: priceAfter * S,
    totalSupply: S,
    clamped,
    curveProgressPct: (out / sellable) * 100,
    devExempt: false,
    snipe,
    snipeNote: "Estimate from the registry's graduation target — the real curve may differ.",
  };
}

export function simulateDevBuy(launchpad: LaunchpadId, chain: ChainId, amount: number, taxBps = 0): DevBuySim {
  if (launchpad === "pons" && chain === "hood") return ponsSim(amount, taxBps);
  if (launchpad === "pump" && chain === "sol") return pumpSim(amount);
  if (launchpad === "clanker" && chain === "hood") return clankerSim(amount);
  return estimateSim(launchpad, chain, amount);
}
