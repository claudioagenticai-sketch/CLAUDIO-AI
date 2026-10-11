// Solana route via PumpPortal's Local Transaction API (non-custodial: returns an unsigned VersionedTransaction that the
// user's browser wallet signs). Covers pump.fun curve + PumpSwap and LaunchLab/bonk with `pool: "auto"`.
//
// API (verified 2026-09-27 at https://pumpportal.fun/local-trading-api/trading-api):
//   POST https://pumpportal.fun/api/trade-local  (application/json)
//   { publicKey, action: "buy"|"sell", mint, amount, denominatedInSol: "true"|"false", slippage (percent),
//     priorityFee (SOL), pool: "pump"|"raydium"|"pump-amm"|"launchlab"|"raydium-cpmm"|"bonk"|"auto" }
//   amount: SOL for buys (denominatedInSol "true"); sells accept a percentage string like "50%".
//   200 → body is the raw serialized transaction bytes.
// PumpPortal fee: "We take a 0.5% fee on each Local trade." (https://pumpportal.fun/fees) — disclosed in the quote.
// Jito tips are NOT part of the local-tx API; the preset tip is not applied on this route (said so in the quote).
// Live check 2026-09-27: migrated coin (pool "auto") → 200 + 1130-byte tx (first byte 0x01 = one signature).
// Bonding-curve coins → 400 "Bad Request" for every mint/pool/denomination combination tried (see fetchLocalTx).

import { deploymentOf, LAUNCHPADS } from "@shared/launchpads";
import type { PreparedTx, TokenSnapshot } from "@shared/types";
import { nativeUsd } from "../store";
import { svmTokenBalance } from "./balance";
import { TradeError, type PrepareInput, type PreparedTrade, type QuoteInput, type TradeQuoteEx, type TradeRouteBuilder } from "./types";

const PUMPPORTAL_URL = "https://pumpportal.fun/api/trade-local";
const PUMPPORTAL_FEE_BPS = 50;
const ROUTE_LABEL = "PumpPortal";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// pump.fun bonding-curve constants (initial virtual reserves). k = vSol · vTok is constant along the curve.
const PUMP_V_TOKENS0 = 1_073_000_000;
const PUMP_V_SOL0 = 30;
const PUMP_K = PUMP_V_TOKENS0 * PUMP_V_SOL0;
const PUMP_REAL_TOKENS0 = 793_100_000;

function validTrader(trader: string | undefined, required: boolean): string | undefined {
  if (!trader) {
    if (required) throw new TradeError(400, "wallet_required", "Unlock a Solana wallet to size this sell.");
    return undefined;
  }
  if (!BASE58_RE.test(trader)) throw new TradeError(400, "bad_trader", "Trader must be a valid Solana address.");
  return trader;
}

interface Reserves {
  sol: number; // native side (virtual for curve)
  tokens: number;
  feeBps: number; // venue fee
  venue: string;
}

/** Best-effort reserves for an estimate. Curve: pump virtual-reserve model calibrated to the live price. */
function estimateReserves(token: TokenSnapshot): Reserves | undefined {
  const dep = deploymentOf(token.launchpad, "sol");
  if (token.launchpad === "pump" && token.phase !== "migrated") {
    let vTok: number;
    if (token.priceNative > 0) vTok = Math.sqrt(PUMP_K / token.priceNative); // vSol/vTok = p and vSol·vTok = k
    else vTok = PUMP_V_TOKENS0 - (Math.max(0, Math.min(100, token.bondingPct)) / 100) * PUMP_REAL_TOKENS0;
    if (!Number.isFinite(vTok) || vTok <= 0) return undefined;
    return { sol: PUMP_K / vTok, tokens: vTok, feeBps: dep?.curveFeeBps ?? 125, venue: "pump.fun curve" };
  }
  // AMM (or LaunchLab curve): constant product from the indexed liquidity (USD, both sides) and price.
  const px = token.priceNative;
  const usd = nativeUsd("sol");
  if (px > 0 && usd > 0 && token.liquidityUsd > 0) {
    const sol = token.liquidityUsd / 2 / usd;
    const venue = token.phase === "migrated" ? token.venue ?? "AMM" : `${LAUNCHPADS[token.launchpad].name} curve`;
    return { sol, tokens: sol / px, feeBps: (token.phase === "migrated" ? dep?.poolFeeBps : dep?.curveFeeBps) ?? 125, venue };
  }
  return undefined;
}

function buyEstimate(token: TokenSnapshot, amountSol: number, slippageBps: number): TradeQuoteEx {
  const r = estimateReserves(token);
  const warnings = ["Estimate from the latest indexed price — PumpPortal builds the exact route at send time."];
  const totalFeeBps = (r?.feeBps ?? 125) + PUMPPORTAL_FEE_BPS;
  const net = amountSol * (1 - totalFeeBps / 10_000);
  let out = 0;
  let impact = 0;
  if (r) {
    out = (net * r.tokens) / (r.sol + net);
    const spot = r.sol / r.tokens;
    impact = out > 0 ? Math.max(0, ((net / out) / spot - 1) * 100) : 0;
  } else if (token.priceNative > 0) {
    out = net / token.priceNative;
    warnings.push("No liquidity data yet — price impact unknown.");
  } else {
    warnings.push("No price indexed yet — can't estimate output.");
  }
  return {
    amountIn: amountSol,
    expectedOut: out,
    minOut: out * (1 - slippageBps / 10_000),
    priceImpactPct: impact,
    feeNative: (amountSol * totalFeeBps) / 10_000,
    taxPct: 0,
    route: `${ROUTE_LABEL} · ${r?.venue ?? "auto"}`,
    estimate: true,
    warnings,
  };
}

function sellEstimate(token: TokenSnapshot, tokensIn: number, balance: number, slippageBps: number): TradeQuoteEx {
  const r = estimateReserves(token);
  const warnings = ["Estimate from the latest indexed price — PumpPortal builds the exact route at send time."];
  const totalFeeBps = (r?.feeBps ?? 125) + PUMPPORTAL_FEE_BPS;
  let gross = 0;
  let impact = 0;
  if (r) {
    gross = (tokensIn * r.sol) / (r.tokens + tokensIn);
    const spot = r.sol / r.tokens;
    impact = tokensIn > 0 ? Math.max(0, (1 - gross / tokensIn / spot) * 100) : 0;
  } else {
    gross = tokensIn * token.priceNative;
  }
  const fee = (gross * totalFeeBps) / 10_000;
  const out = gross - fee;
  return {
    amountIn: tokensIn,
    expectedOut: out,
    minOut: out * (1 - slippageBps / 10_000),
    priceImpactPct: impact,
    feeNative: fee,
    taxPct: 0,
    route: `${ROUTE_LABEL} · ${r?.venue ?? "auto"}`,
    estimate: true,
    balanceTokens: balance,
    warnings,
  };
}

async function fetchLocalTx(token: TokenSnapshot, body: Record<string, string | number>): Promise<string> {
  const site = LAUNCHPADS[token.launchpad].site;
  let res: Response;
  try {
    res = await fetch(PUMPPORTAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    throw new TradeError(502, "upstream_unreachable", `PumpPortal is unreachable (${(e as Error).message}). Nothing was sent.`);
  }
  if (res.status !== 200) {
    const text = (await res.text().catch(() => "")).slice(0, 240).trim();
    // Observed 2026-09-27: PumpPortal answers a bare "Bad Request" for every pump.fun *bonding-curve* coin we tried
    // (SPL and Token-2022, pool "pump"/"auto"), while migrated (PumpSwap) coins build fine. Surface it honestly.
    const where = token.phase === "migrated" ? "" : " bonding-curve";
    throw new TradeError(
      502,
      "upstream_rejected",
      `PumpPortal couldn't build this${where} trade (${res.status}${text ? ` ${text}` : ""}). Nothing was sent — try again or trade on ${new URL(site).host}.`,
      site,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // A serialized VersionedTransaction starts with a compact-u16 signature count (1 for a single signer), never "{".
  if (buf.length < 100 || buf[0] === 0x7b) {
    throw new TradeError(502, "upstream_error", `PumpPortal returned an unexpected response: ${buf.toString("utf8", 0, Math.min(200, buf.length))}`);
  }
  return buf.toString("base64");
}

export const pumpPortalRoute: TradeRouteBuilder = {
  id: "pumpportal",
  label: ROUTE_LABEL,

  matches: (t) => t.chain === "sol" && (t.launchpad === "pump" || t.launchpad === "bonk"),

  async quote(input: QuoteInput): Promise<TradeQuoteEx> {
    const { token, side, amount, slippageBps } = input;
    if (side === "buy") return buyEstimate(token, amount, slippageBps);
    const trader = validTrader(input.trader, true) as string;
    const balance = await svmTokenBalance(token.address, trader);
    const pct = Math.min(100, Math.max(0, amount));
    return sellEstimate(token, (balance * pct) / 100, balance, slippageBps);
  },

  async prepare(input: PrepareInput): Promise<PreparedTrade> {
    const { token, side, slippageBps } = input;
    const trader = validTrader(input.trader, true) as string;
    const priorityFee = Math.min(0.1, Math.max(0, input.priorityFee));
    let quote: TradeQuoteEx;
    let body: Record<string, string | number>;
    let description: string;

    if (side === "buy") {
      const amt = input.amountNative ?? 0;
      if (!(amt > 0)) throw new TradeError(400, "bad_amount", "Buy amount must be greater than zero.");
      quote = buyEstimate(token, amt, slippageBps);
      body = {
        publicKey: trader,
        action: "buy",
        mint: token.address,
        amount: amt,
        denominatedInSol: "true",
        slippage: slippageBps / 100,
        priorityFee,
        pool: "auto",
      };
      description = `Buy ${token.symbol} with ${amt} SOL via PumpPortal`;
    } else {
      // PumpPortal takes a whole-number percentage string for sells.
      const pct = Math.min(100, Math.max(1, Math.round(input.pct ?? 0)));
      const balance = await svmTokenBalance(token.address, trader).catch(() => 0);
      if (balance <= 0) throw new TradeError(400, "no_balance", "Nothing to sell — this wallet holds none of this token.");
      quote = sellEstimate(token, (balance * pct) / 100, balance, slippageBps);
      body = {
        publicKey: trader,
        action: "sell",
        mint: token.address,
        amount: `${pct}%`,
        denominatedInSol: "false",
        slippage: slippageBps / 100,
        priorityFee,
        pool: "auto",
      };
      description = `Sell ${pct}% of your ${token.symbol} via PumpPortal`;
    }

    if (input.jitoTip > 0) quote.warnings.push("Jito tip isn't applied on this route (PumpPortal local tx) — priority fee only.");
    const base64 = await fetchLocalTx(token, body);
    const tx: PreparedTx = { kind: "svm", base64, signers: [trader], partiallySigned: false, description };
    return { txs: [tx], quote };
  },
};
