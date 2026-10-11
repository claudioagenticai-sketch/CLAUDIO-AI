// Dev-buy math per launchpad. Mirrors the client simulator (client/src/features/launch/sim.ts); the server
// version is authoritative for minTokensOut because it runs on exact integers where the contract does.
import { B0, BPS } from "./env";

// ─── Pons V2 bonding curve (PonsV2BondingCurve.buy, Sourcify) ──────
// reserves: quote = phantom + trackedQuote − pending fees; token = trackedTokens (starts at full supply).
// sellable = supply − reserved, reserved = supply·phantom/(phantom+threshold).
// fee, creator tax and snipe tax are bps of GROSS input; the dev buy recipient is snipe-tax exempt.
export interface PonsConfig {
  supply: bigint; // 18-dec units
  curveFeeBps: bigint;
  phantomQuote: bigint; // wei
  graduationThreshold: bigint; // wei
}

export const PONS_DEFAULT_CONFIG: PonsConfig = {
  supply: BigInt("1000000000000000000000000000"), // 1e9 · 1e18
  curveFeeBps: BigInt(100),
  phantomQuote: BigInt("1680000000000000000"),
  graduationThreshold: BigInt("4200000000000000000"),
};

export interface CurveQuote {
  tokensOut: bigint;
  /** 0–100 */
  supplyPct: number;
  priceImpactPct: number;
  clamped: boolean;
}

export function ponsQuote(quoteIn: bigint, creatorTaxBps: number, cfg: PonsConfig = PONS_DEFAULT_CONFIG): CurveQuote {
  if (quoteIn <= B0) return { tokensOut: B0, supplyPct: 0, priceImpactPct: 0, clamped: false };
  const tax = BigInt(Math.max(0, Math.floor(creatorTaxBps)));
  const fee = (quoteIn * cfg.curveFeeBps) / BPS;
  const taxAmt = (quoteIn * tax) / BPS;
  const net = quoteIn - fee - taxAmt;
  const rq = cfg.phantomQuote;
  const rt = cfg.supply;
  let out = (net * rt) / (rq + net);
  const reserved = (cfg.supply * cfg.phantomQuote) / (cfg.phantomQuote + cfg.graduationThreshold);
  const sellable = cfg.supply - reserved;
  let clamped = false;
  if (out > sellable) {
    out = sellable;
    clamped = true;
  }
  const supplyPct = (Number(out) / Number(cfg.supply)) * 100;
  // spot price before = rq/rt; after = (rq+net)/(rt−out)
  const p0 = Number(rq) / Number(rt);
  const p1 = Number(rq + net) / Number(rt - out);
  return { tokensOut: out, supplyPct, priceImpactPct: (p1 / p0 - 1) * 100, clamped };
}

// ─── pump.fun bonding curve (buy_exact_quote_in_v2) ─────────────────
// Live Global 4wTV…jf (2026-09-27): initial virtual token reserves 1.073e15 (6 dec), virtual quote 30 SOL,
// real tokens 7.931e14, supply 1e15. Curve fee 1.25% (protocol 0.95% + creator 0.30%) on top of the net amount.
export interface PumpCurve {
  virtualToken: bigint;
  virtualQuote: bigint; // lamports
  realToken: bigint;
  supply: bigint;
  totalFeeBps: bigint;
}

export const PUMP_DEFAULT_CURVE: PumpCurve = {
  virtualToken: BigInt("1073000000000000"),
  virtualQuote: BigInt("30000000000"),
  realToken: BigInt("793100000000000"),
  supply: BigInt("1000000000000000"),
  totalFeeBps: BigInt(125),
};

export function pumpQuote(spendableLamports: bigint, c: PumpCurve = PUMP_DEFAULT_CURVE): CurveQuote {
  if (spendableLamports <= B0) return { tokensOut: B0, supplyPct: 0, priceImpactPct: 0, clamped: false };
  // net + fee(net) = spendable  →  net = spendable·10000/(10000+fee)
  const net = (spendableLamports * BPS) / (BPS + c.totalFeeBps);
  let out = (net * c.virtualToken) / (c.virtualQuote + net);
  let clamped = false;
  if (out > c.realToken) {
    out = c.realToken;
    clamped = true;
  }
  const p0 = Number(c.virtualQuote) / Number(c.virtualToken);
  const p1 = Number(c.virtualQuote + net) / Number(c.virtualToken - out);
  return { tokensOut: out, supplyPct: (Number(out) / Number(c.supply)) * 100, priceImpactPct: (p1 / p0 - 1) * 100, clamped };
}

// ─── Clanker v4 single-position concentrated liquidity ──────────────
// 100B supply placed in one position [tickLower, tickUpper] starting at tickLower (all token side).
// Buying with ETH moves sqrtP up: ΔsqrtP = Δy/L ; tokens = L·(1/√p0 − 1/√p1). Float math — display only.
export function clankerQuote(ethIn: number, feeBps = 100, tickLower = -230400, tickUpper = -120000, supply = 100e9): {
  tokensOut: number;
  supplyPct: number;
  priceImpactPct: number;
} {
  if (!(ethIn > 0)) return { tokensOut: 0, supplyPct: 0, priceImpactPct: 0 };
  const sa = Math.pow(1.0001, tickLower / 2);
  const sb = Math.pow(1.0001, tickUpper / 2);
  const L = supply / (1 / sa - 1 / sb);
  const net = ethIn * (1 - feeBps / 10_000);
  const s1 = Math.min(sa + net / L, sb);
  const out = L * (1 / sa - 1 / s1);
  return { tokensOut: out, supplyPct: (out / supply) * 100, priceImpactPct: ((s1 * s1) / (sa * sa) - 1) * 100 };
}
