// Pons V2 bonding-curve route (Robinhood Chain). Pre-migration only — graduated tokens trade on Uniswap v4 + MemeHook,
// which isn't wired yet. Curve ABI + math verified against the live deployment (see ./abis.ts).
//
// Curve math (PonsV2BondingCurve.sol, live):
//   buy:  fee/tax/snipe are bps of the GROSS input; net = in − fee − tax − snipe; out = net·Rt / (Rq + net)
//         out is clamped to sellableTokens() (partial fill + refund); slippage check is price-based.
//   sell: gross = in·Rq / (Rt + in); out = gross − fee − tax (bps of gross). Disabled once sellable == 0.
//   Rq = phantom + trackedQuote − pendingFees − creatorTax (getReserves), Rt = trackedTokens.

import { encodeFunctionData, getAddress, isAddress, maxUint256, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import { LAUNCHPADS } from "@shared/launchpads";
import type { PreparedTx, TokenSnapshot } from "@shared/types";
import { ERC20_ABI, PONS_CURVE_ABI } from "./abis";
import { B0, B100, BPS, MULTICALL3, bmin, evmClient, fromUnits, toUnits } from "./evm";
import { TradeError, type PrepareInput, type PreparedTrade, type QuoteInput, type TradeQuoteEx, type TradeRouteBuilder } from "./types";

const CHAIN = CHAINS.hood;
const TOKEN_DECIMALS = 18; // PonsV2LauncherToken (OZ ERC20) — verified live
const ROUTE_LABEL = "Pons curve";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Explicit gas for a sell that follows an approve in the same batch (wallet can't estimate before the approve lands). */
const SELL_AFTER_APPROVE_GAS = "450000";

interface CurveState {
  curve: Address;
  token: Address;
  pairToken: Address;
  feeBps: bigint;
  creatorTaxBps: bigint;
  reservedTokens: bigint;
  launchedAt: number;
  snipeTaxSeconds: number;
  graduated: boolean;
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellable: bigint;
  /** currentSnipeTaxBps(trader) — or of the zero address (never exempt) when no trader is known. */
  snipeBps: bigint;
  /** Trader's token balance / allowance to the curve (0 without a trader). */
  balance: bigint;
  allowance: bigint;
}

// Collapse concurrent refreshes (many clients polling the same curve) into one RPC round trip.
const STATE_TTL_MS = 1_200;
const stateCache = new Map<string, { at: number; p: Promise<CurveState> }>();

function curveOf(token: TokenSnapshot): Address {
  if (!token.pool || !isAddress(token.pool)) {
    throw new TradeError(409, "curve_unknown", `No bonding-curve address indexed for ${token.symbol} yet — try again in a few seconds.`, LAUNCHPADS.pons.site);
  }
  return getAddress(token.pool);
}

/** One Multicall3 eth_call: curve config + reserves + snipe tax + trader balance/allowance. */
async function fetchCurve(curve: Address, tokenAddr: Address, who: Address): Promise<CurveState> {
  let r: readonly unknown[];
  try {
    r = await evmClient("hood").multicall({
      multicallAddress: MULTICALL3,
      allowFailure: false,
      contracts: [
        { address: curve, abi: PONS_CURVE_ABI, functionName: "token" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "pairToken" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "feeBps" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "creatorTaxBps" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "reservedTokens" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "launchedAt" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "snipeTaxSeconds" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "graduated" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "getReserves" },
        { address: curve, abi: PONS_CURVE_ABI, functionName: "currentSnipeTaxBps", args: [who] },
        { address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [who] },
        { address: tokenAddr, abi: ERC20_ABI, functionName: "allowance", args: [who, curve] },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/revert/i.test(msg)) {
      throw new TradeError(409, "curve_unreadable", `Couldn't read the Pons curve at ${curve} — it may not be a Pons V2 curve.`, LAUNCHPADS.pons.site);
    }
    throw new TradeError(502, "rpc_error", `Robinhood Chain RPC error: ${msg.split("\n")[0].slice(0, 200)}`);
  }
  const [token, pairToken, feeBps, creatorTaxBps, reservedTokens, launchedAt, snipeTaxSeconds, graduated, reserves, snipeBps, balance, allowance] = r;
  const [quoteReserve, tokenReserve] = reserves as readonly [bigint, bigint];
  const reserved = reservedTokens as bigint;
  return {
    curve,
    token: token as Address,
    pairToken: pairToken as Address,
    feeBps: feeBps as bigint,
    creatorTaxBps: creatorTaxBps as bigint,
    reservedTokens: reserved,
    launchedAt: Number(launchedAt as bigint),
    snipeTaxSeconds: Number(snipeTaxSeconds as bigint),
    graduated: graduated as boolean,
    quoteReserve,
    tokenReserve,
    sellable: tokenReserve > reserved ? tokenReserve - reserved : B0,
    snipeBps: snipeBps as bigint,
    balance: balance as bigint,
    allowance: allowance as bigint,
  };
}

async function readCurve(token: TokenSnapshot, trader: Address | undefined, fresh = false): Promise<CurveState> {
  const curve = curveOf(token);
  if (!isAddress(token.address)) throw new TradeError(400, "bad_token", "Token address is not a valid EVM address.");
  const who = trader ?? (ZERO_ADDRESS as Address);
  const ck = `${curve}:${who}`;
  const now = Date.now();
  const hit = stateCache.get(ck);
  let p: Promise<CurveState>;
  if (!fresh && hit && now - hit.at < STATE_TTL_MS) p = hit.p;
  else {
    p = fetchCurve(curve, getAddress(token.address), who);
    stateCache.set(ck, { at: now, p });
    p.catch(() => stateCache.delete(ck));
    if (stateCache.size > 2_000) {
      stateCache.forEach((v, k) => {
        if (now - v.at > STATE_TTL_MS) stateCache.delete(k);
      });
    }
  }
  const s = await p;

  // Safety: the store's curve must actually dispense this token.
  if (s.token.toLowerCase() !== token.address.toLowerCase()) {
    throw new TradeError(409, "curve_mismatch", `Indexed curve ${curve} doesn't belong to ${token.symbol}. Refusing to build a trade.`);
  }
  if (s.pairToken.toLowerCase() !== ZERO_ADDRESS) {
    throw new TradeError(
      501,
      "route_unsupported",
      `Trading ${token.symbol} (paired with an ERC-20, not ETH) isn't wired yet — trade on ponsfamily.com`,
      LAUNCHPADS.pons.site,
    );
  }
  if (s.graduated) {
    throw new TradeError(
      501,
      "route_unsupported",
      `${token.symbol} has graduated to Uniswap v4 — post-migration Pons trading isn't wired yet. Trade on ponsfamily.com`,
      LAUNCHPADS.pons.site,
    );
  }
  return s;
}

function snipeWarning(s: CurveState): string | undefined {
  if (s.snipeBps === B0) return undefined;
  const left = Math.max(0, s.launchedAt + s.snipeTaxSeconds - Math.floor(Date.now() / 1000));
  return `Anti-snipe tax ${(Number(s.snipeBps) / 100).toFixed(2)}% is active (decays to 0 in ~${left}s). Waiting a few seconds is much cheaper.`;
}

function minOutFor(out: bigint, slippageBps: number): bigint {
  const slip = BigInt(Math.max(0, Math.min(9_900, Math.round(slippageBps))));
  return (out * (BPS - slip)) / BPS;
}

// ─── Buy ────────────────────────────────────────────────────────────

interface BuyMath {
  quoteIn: bigint;
  tokensOut: bigint;
  minOut: bigint;
  fee: bigint;
  taxBps: bigint;
  impactPct: number;
  partial: boolean;
}

function buyMath(s: CurveState, quoteIn: bigint, slippageBps: number): BuyMath {
  if (s.sellable === B0) {
    throw new TradeError(409, "curve_complete", "The curve is sold out and waiting for graduation. Trading resumes on Uniswap v4 once the pool is created.", LAUNCHPADS.pons.site);
  }
  let snipeBps = s.snipeBps;
  if (snipeBps > B0) {
    const cap = BPS - s.feeBps - s.creatorTaxBps - B100;
    if (snipeBps > cap) snipeBps = cap;
  }
  const fee = (quoteIn * s.feeBps) / BPS;
  const tax = (quoteIn * s.creatorTaxBps) / BPS;
  const snipe = (quoteIn * snipeBps) / BPS;
  const net = quoteIn - fee - tax - snipe;
  if (net <= B0) throw new TradeError(400, "amount_too_small", "Amount is too small to buy anything.");
  let tokensOut = (net * s.tokenReserve) / (s.quoteReserve + net);
  let partial = false;
  if (tokensOut > s.sellable) {
    tokensOut = s.sellable;
    partial = true;
  }
  if (tokensOut === B0) throw new TradeError(400, "amount_too_small", "Amount is too small to buy anything.");
  // Execution price vs spot, fees excluded (fees are reported separately).
  const spot = Number(s.quoteReserve) / Number(s.tokenReserve);
  const exec = Number(net) / Number(tokensOut);
  const impactPct = spot > 0 ? Math.max(0, (exec / spot - 1) * 100) : 0;
  return { quoteIn, tokensOut, minOut: minOutFor(tokensOut, slippageBps), fee: fee + snipe, taxBps: s.creatorTaxBps + snipeBps, impactPct, partial };
}

function buyQuote(s: CurveState, m: BuyMath): TradeQuoteEx {
  const warnings: string[] = [];
  const sw = snipeWarning(s);
  if (sw) warnings.push(sw);
  if (m.partial) warnings.push("This buy exceeds what's left on the curve: it fills the remainder and refunds the excess ETH.");
  if (m.impactPct > 15) warnings.push(`High price impact (${m.impactPct.toFixed(1)}%).`);
  return {
    amountIn: fromUnits(m.quoteIn, 18),
    expectedOut: fromUnits(m.tokensOut, TOKEN_DECIMALS),
    minOut: fromUnits(m.minOut, TOKEN_DECIMALS),
    priceImpactPct: m.impactPct,
    feeNative: fromUnits(m.fee, 18),
    taxPct: Number(m.taxBps) / 100,
    route: ROUTE_LABEL,
    estimate: false,
    partialFill: m.partial || undefined,
    warnings,
  };
}

// ─── Sell ───────────────────────────────────────────────────────────

interface SellMath {
  tokensIn: bigint;
  quoteOut: bigint;
  minOut: bigint;
  fee: bigint;
  impactPct: number;
}

function sellMath(s: CurveState, tokensIn: bigint, slippageBps: number): SellMath {
  if (s.sellable === B0) {
    throw new TradeError(409, "curve_complete", "Selling is closed: the curve is complete and waiting for graduation to Uniswap v4.", LAUNCHPADS.pons.site);
  }
  if (tokensIn <= B0) throw new TradeError(400, "no_balance", "Nothing to sell — this wallet holds none of this token.");
  const gross = (tokensIn * s.quoteReserve) / (s.tokenReserve + tokensIn);
  const fee = (gross * s.feeBps) / BPS;
  const tax = (gross * s.creatorTaxBps) / BPS;
  const quoteOut = gross - fee - tax;
  const spot = Number(s.quoteReserve) / Number(s.tokenReserve);
  const exec = Number(gross) / Number(tokensIn);
  const impactPct = spot > 0 ? Math.max(0, (1 - exec / spot) * 100) : 0;
  return { tokensIn, quoteOut, minOut: minOutFor(quoteOut, slippageBps), fee, impactPct };
}

function sellQuote(s: CurveState, m: SellMath, balance: bigint): TradeQuoteEx {
  const warnings: string[] = [];
  if (m.impactPct > 15) warnings.push(`High price impact (${m.impactPct.toFixed(1)}%).`);
  return {
    amountIn: fromUnits(m.tokensIn, TOKEN_DECIMALS),
    expectedOut: fromUnits(m.quoteOut, 18),
    minOut: fromUnits(m.minOut, 18),
    priceImpactPct: m.impactPct,
    feeNative: fromUnits(m.fee, 18),
    taxPct: Number(s.creatorTaxBps) / 100,
    route: ROUTE_LABEL,
    estimate: false,
    balanceTokens: fromUnits(balance, TOKEN_DECIMALS),
    warnings,
  };
}

function pctOf(balance: bigint, pct: number): bigint {
  if (pct >= 100) return balance;
  const bp = BigInt(Math.max(0, Math.round(pct * 100)));
  return (balance * bp) / BPS;
}

function traderAddress(trader: string | undefined, required: boolean): Address | undefined {
  if (!trader) {
    if (required) throw new TradeError(400, "wallet_required", "Connect or unlock an EVM wallet to size this sell.");
    return undefined;
  }
  if (!isAddress(trader)) throw new TradeError(400, "bad_trader", "Trader must be a valid EVM address.");
  return getAddress(trader);
}

// ─── Route ──────────────────────────────────────────────────────────

export const ponsCurveRoute: TradeRouteBuilder = {
  id: "pons-curve",
  label: ROUTE_LABEL,

  matches: (t) => t.chain === "hood" && t.launchpad === "pons" && t.phase !== "migrated",

  async quote(input: QuoteInput): Promise<TradeQuoteEx> {
    const { token, side, amount, slippageBps } = input;
    if (side === "buy") {
      const trader = traderAddress(input.trader, false);
      const s = await readCurve(token, trader);
      return buyQuote(s, buyMath(s, toUnits(amount, 18), slippageBps));
    }
    const trader = traderAddress(input.trader, true) as Address;
    const s = await readCurve(token, trader);
    return sellQuote(s, sellMath(s, pctOf(s.balance, amount), slippageBps), s.balance);
  },

  async prepare(input: PrepareInput): Promise<PreparedTrade> {
    const { token, side, slippageBps } = input;
    const trader = traderAddress(input.trader, true) as Address;
    const s = await readCurve(token, trader, true); // never build a tx from cached state

    if (side === "buy") {
      const quoteIn = toUnits(input.amountNative ?? 0, 18);
      if (quoteIn <= B0) throw new TradeError(400, "bad_amount", "Buy amount must be greater than zero.");
      const m = buyMath(s, quoteIn, slippageBps);
      const data: Hex = encodeFunctionData({ abi: PONS_CURVE_ABI, functionName: "buy", args: [quoteIn, m.minOut, trader] });
      const tx: PreparedTx = {
        kind: "evm",
        chainId: CHAIN.evmChainId ?? 4663,
        to: s.curve,
        data,
        value: quoteIn.toString(),
        description: `Buy ${token.symbol} with ${fromUnits(quoteIn, 18)} ${CHAIN.nativeSymbol} on the Pons curve`,
      };
      return { txs: [tx], quote: buyQuote(s, m) };
    }

    const pct = input.pct ?? 0;
    const bal = s.balance;
    const tokensIn = bmin(pctOf(bal, pct), bal);
    const m = sellMath(s, tokensIn, slippageBps);

    const txs: PreparedTx[] = [];
    const needsApprove = s.allowance < tokensIn;
    if (needsApprove) {
      const approveAmount = input.approveMax ? maxUint256 : tokensIn;
      txs.push({
        kind: "evm",
        chainId: CHAIN.evmChainId ?? 4663,
        to: s.token,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [s.curve, approveAmount] }),
        value: "0",
        description: input.approveMax ? `Approve ${token.symbol} for the Pons curve (unlimited)` : `Approve ${token.symbol} for the Pons curve`,
      });
    }
    txs.push({
      kind: "evm",
      chainId: CHAIN.evmChainId ?? 4663,
      to: s.curve,
      data: encodeFunctionData({ abi: PONS_CURVE_ABI, functionName: "sell", args: [tokensIn, m.minOut, trader] }),
      value: "0",
      gas: needsApprove ? SELL_AFTER_APPROVE_GAS : undefined,
      description: `Sell ${pct >= 100 ? "100" : pct.toFixed(pct % 1 ? 1 : 0)}% of your ${token.symbol} on the Pons curve`,
    });
    return { txs, quote: sellQuote(s, m, bal) };
  },
};
