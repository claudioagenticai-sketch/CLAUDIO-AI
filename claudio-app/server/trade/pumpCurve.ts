// pump.fun bonding-curve route: our own buy/sell transactions (PumpPortal answers 400 for curve coins, see ./solana.ts).
//
//   buy  → buy_exact_quote_in_v2(spendable lamports, min tokens out)   — spend exactly the SOL amount, fees included
//   sell → sell_v2(token amount, min SOL out)                          — pct of the trader's ATA balance
//
// Everything is read from chain per request: the BondingCurve (reserves, complete, creator, mayhem, quote mint), the mint
// (owner program = Token-2022 for create_v2 coins / SPL Token for legacy coins, supply, decimals), pump Global and the
// pump_fees FeeConfig (market-cap fee tiers, docs/FEE_PROGRAM_README.md). Quotes use the exact integer formulas from the
// IDL docs of buy_exact_quote_in_v2, so they're not estimates. creator_vault is derived from bonding_curve.creator
// (the sharing_config PDA for coins with fee sharing). Graduated (complete) curves, migrated tokens and non-SOL pairs
// go to PumpPortal (PumpSwap). No platform fee is added. The prepared tx is simulated (sigVerify off); a failed
// simulation is reported as a warning, never a block.
import { ComputeBudgetProgram, PublicKey, type AccountInfo, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PreparedTx, TokenSnapshot } from "@shared/types";
import { compileTx, simulateSol, solConnection, toBase64 } from "../launch/sol";
import {
  BUYBACK_FEE_RECIPIENTS,
  FEE_RECIPIENTS,
  MAYHEM_FEE_RECIPIENTS,
  buyExactQuoteInV2Ix,
  createUserAtaIx,
  curveBuyQuote,
  curveFeesBps,
  curveSellQuote,
  decodeBondingCurveState,
  decodeFeeConfigTiers,
  decodeGlobalFees,
  pumpPda,
  sellV2Ix,
  userAta,
  type BondingCurveState,
  type PumpFeeTier,
} from "../launch/pump/ixs";
import { pumpPortalRoute } from "./solana";
import { pumpFeeRecipients } from "../launch/pump/global";
import { TradeError, type PrepareInput, type PreparedTrade, type QuoteInput, type TradeQuoteEx, type TradeRouteBuilder } from "./types";

const ROUTE_LABEL = "pump.fun curve";
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BPS = BigInt(10_000);
const ZERO = BigInt(0);
/** CU limits used when the measuring simulation fails (ATA + buy ≈ 111–115k CU measured; sell is lighter). */
const DEFAULT_CU = { buy: 200_000, sell: 160_000 } as const;
const MEASURE_CU = 400_000;
const MAX_PRIORITY_SOL = 0.1;

// ─── chain state ────────────────────────────────────────────────────

interface FeeParams {
  tiers: PumpFeeTier[] | null;
  global: { protocolFeeBps: bigint; creatorFeeBps: bigint } | null;
  at: number;
}
let feeCache: FeeParams | null = null;

interface CurveState {
  mint: PublicKey;
  curve: BondingCurveState;
  baseProgram: PublicKey;
  decimals: number;
  supply: bigint;
  fees: { protocolFeeBps: bigint; creatorFeeBps: bigint; source: string };
  /** Trader's base-token ATA (when a trader was given). */
  userAta?: PublicKey;
  userAtaExists?: boolean;
  userBalanceRaw?: bigint;
  userVolExists?: boolean;
}

/** Why this token can't use the curve route (→ PumpPortal); null = curve route applies. */
type Fallback = { reason: string };

function pk(addr: string, what: string): PublicKey {
  try {
    return new PublicKey(addr);
  } catch {
    throw new TradeError(400, "bad_address", `Invalid ${what} address.`);
  }
}

async function readState(token: TokenSnapshot, trader?: string): Promise<CurveState | Fallback> {
  const mint = pk(token.address, "token");
  const user = trader ? pk(trader, "trader") : undefined;
  const conn = solConnection();
  const needFees = !feeCache || Date.now() - feeCache.at > 60_000;
  const keys: PublicKey[] = [pumpPda.bondingCurve(mint), mint];
  if (needFees) keys.push(pumpPda.global(), pumpPda.feeConfig());
  let infos: (AccountInfo<Buffer> | null)[];
  try {
    infos = await conn.getMultipleAccountsInfo(keys, "confirmed");
  } catch (e) {
    throw new TradeError(502, "rpc_unreachable", `Solana RPC unavailable (${(e as Error).message}). Nothing was sent.`);
  }
  const [bcInfo, mintInfo] = infos;
  if (needFees) {
    feeCache = {
      global: infos[2] ? decodeGlobalFees(infos[2].data) : null,
      tiers: infos[3] ? decodeFeeConfigTiers(infos[3].data) : null,
      at: Date.now(),
    };
  }
  if (!bcInfo) return { reason: "no pump.fun bonding curve for this mint" };
  const curve = decodeBondingCurveState(bcInfo.data);
  if (!curve) return { reason: "unreadable bonding curve account" };
  if (curve.complete) return { reason: "the bonding curve is complete (graduated to PumpSwap)" };
  if (curve.quoteMint) return { reason: `the curve is paired with ${curve.quoteMint.toBase58().slice(0, 4)}… instead of SOL` };
  if (!mintInfo) throw new TradeError(404, "mint_not_found", "Mint account not found on Solana.");
  const baseProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : mintInfo.owner.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : null;
  if (!baseProgram) throw new TradeError(400, "unknown_token_program", "This mint isn't owned by a token program.");
  // SPL mint layout (same base for Token-2022): mint_authority COption 36 · supply u64 @36 · decimals u8 @44.
  const supply = mintInfo.data.readBigUInt64LE(36);
  const decimals = mintInfo.data.readUInt8(44);
  const fees = curveFeesBps(curve, supply, feeCache?.tiers ?? null, feeCache?.global ?? null);
  const state: CurveState = { mint, curve, baseProgram, decimals, supply, fees };
  if (user) {
    const ataAddr = userAta(mint, user, baseProgram);
    const [ataInfo, volInfo] = await conn.getMultipleAccountsInfo([ataAddr, pumpPda.userVolumeAccumulator(user)], "confirmed").catch(() => [null, null]);
    state.userAta = ataAddr;
    state.userAtaExists = !!ataInfo;
    // Token account layout: mint 32 · owner 32 · amount u64 @64.
    state.userBalanceRaw = ataInfo && ataInfo.data.length >= 72 ? ataInfo.data.readBigUInt64LE(64) : ZERO;
    state.userVolExists = !!volInfo;
  }
  return state;
}

const isFallback = (s: CurveState | Fallback): s is Fallback => "reason" in s;

// ─── math helpers ───────────────────────────────────────────────────

function lamports(sol: number): bigint {
  if (!(sol > 0)) return ZERO;
  return BigInt(Math.floor(sol * 1e9));
}
const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;
const slipFloor = (v: bigint, slippageBps: number) => (v * (BPS - BigInt(Math.max(0, Math.min(9_900, Math.floor(slippageBps)))))) / BPS;

function feeNote(s: CurveState): string {
  const p = Number(s.fees.protocolFeeBps) / 100;
  const c = Number(s.fees.creatorFeeBps) / 100;
  return `pump.fun fee ${(p + c).toFixed(2)}% (protocol ${p}% + creator ${c}%${s.fees.source === "default" ? ", fee config unreadable — default assumed" : ""}). No platform fee.`;
}

function buyQuote(s: CurveState, amountSol: number, slippageBps: number): { quote: TradeQuoteEx; spendable: bigint; minOut: bigint } {
  const spendable = lamports(amountSol);
  if (spendable <= ZERO) throw new TradeError(400, "bad_amount", "Buy amount must be greater than zero.");
  const q = curveBuyQuote(s.curve, spendable, s.fees);
  const minOut = slipFloor(q.tokensOut, slippageBps);
  const spot = Number(s.curve.virtualQuote) / Number(s.curve.virtualToken);
  const eff = q.tokensOut > ZERO ? Number(q.netSol) / Number(q.tokensOut) : 0;
  const warnings = [feeNote(s)];
  const partialFill = q.tokensOut >= s.curve.realToken;
  if (partialFill) warnings.push("This buy is larger than what's left on the curve — it would take the rest of the curve.");
  if (s.userAtaExists === false) warnings.push("First buy of this coin: ~0.002 SOL refundable token-account rent is added.");
  if (s.userVolExists === false) warnings.push("First pump.fun trade from this wallet: ~0.0018 SOL one-time volume-account rent.");
  return {
    spendable,
    minOut,
    quote: {
      amountIn: amountSol,
      expectedOut: units(q.tokensOut, s.decimals),
      minOut: units(minOut, s.decimals),
      priceImpactPct: spot > 0 && eff > 0 ? Math.max(0, (eff / spot - 1) * 100) : 0,
      feeNative: Number(q.feeLamports) / 1e9,
      taxPct: 0,
      route: ROUTE_LABEL,
      estimate: false,
      partialFill: partialFill || undefined,
      warnings,
    },
  };
}

function sellQuote(s: CurveState, pct: number, slippageBps: number): { quote: TradeQuoteEx; amount: bigint; minSol: bigint } {
  const balance = s.userBalanceRaw ?? ZERO;
  const p = Math.min(100, Math.max(0, pct));
  // 100% sells the exact balance (no float rounding dust left behind).
  const amount = p >= 100 ? balance : (balance * BigInt(Math.round(p * 100))) / BPS;
  const q = curveSellQuote(s.curve, amount, s.fees);
  const minSol = slipFloor(q.solOut, slippageBps);
  const spot = Number(s.curve.virtualQuote) / Number(s.curve.virtualToken);
  const effective = amount > ZERO ? Number(q.grossSol) / Number(amount) : 0;
  return {
    amount,
    minSol,
    quote: {
      amountIn: units(amount, s.decimals),
      expectedOut: Number(q.solOut) / 1e9,
      minOut: Number(minSol) / 1e9,
      priceImpactPct: spot > 0 && effective > 0 ? Math.max(0, (1 - effective / spot) * 100) : 0,
      feeNative: Number(q.feeLamports) / 1e9,
      taxPct: 0,
      route: ROUTE_LABEL,
      estimate: false,
      balanceTokens: units(balance, s.decimals),
      warnings: s.userVolExists === false ? [feeNote(s), "First pump.fun trade from this wallet: ~0.0018 SOL one-time volume-account rent."] : [feeNote(s)],
    },
  };
}

function validTrader(trader: string | undefined): string {
  if (!trader) throw new TradeError(400, "wallet_required", "Unlock a Solana wallet to trade.");
  if (!BASE58_RE.test(trader)) throw new TradeError(400, "bad_trader", "Trader must be a valid Solana address.");
  return trader;
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function withFallbackNote(q: TradeQuoteEx, reason: string): TradeQuoteEx {
  q.warnings.unshift(`Routed via PumpPortal: ${reason}.`);
  return q;
}

// ─── route ──────────────────────────────────────────────────────────

export const pumpCurveRoute: TradeRouteBuilder = {
  id: "pump-curve",
  label: ROUTE_LABEL,

  matches: (t) => t.chain === "sol" && t.launchpad === "pump" && t.phase !== "migrated",

  async quote(input: QuoteInput): Promise<TradeQuoteEx> {
    const { token, side, amount, slippageBps } = input;
    const trader = side === "sell" ? validTrader(input.trader) : input.trader && BASE58_RE.test(input.trader) ? input.trader : undefined;
    const s = await readState(token, trader);
    if (isFallback(s)) return withFallbackNote(await pumpPortalRoute.quote(input), s.reason);
    if (side === "buy") return buyQuote(s, amount, slippageBps).quote;
    if ((s.userBalanceRaw ?? ZERO) <= ZERO) {
      const q = sellQuote(s, 0, slippageBps).quote;
      q.warnings.push("This wallet holds none of this token.");
      return q;
    }
    return sellQuote(s, amount, slippageBps).quote;
  },

  async prepare(input: PrepareInput): Promise<PreparedTrade> {
    const { token, side, slippageBps } = input;
    const traderB58 = validTrader(input.trader);
    const s = await readState(token, traderB58);
    if (isFallback(s)) {
      const out = await pumpPortalRoute.prepare(input);
      withFallbackNote(out.quote, s.reason);
      return out;
    }
    const user = new PublicKey(traderB58);
    const live = await pumpFeeRecipients();
    const feeRecipient = pick(s.curve.mayhem ? live.mayhem : live.normal);
    const buybackFeeRecipient = pick(live.buyback);

    let quote: TradeQuoteEx;
    let tradeIxs: TransactionInstruction[];
    let description: string;
    if (side === "buy") {
      const amt = input.amountNative ?? 0;
      const b = buyQuote(s, amt, slippageBps);
      if (b.minOut <= ZERO) throw new TradeError(400, "amount_too_small", "Buy amount is too small to receive any tokens.");
      quote = b.quote;
      tradeIxs = [
        createUserAtaIx(s.mint, user, s.baseProgram),
        buyExactQuoteInV2Ix({
          mint: s.mint,
          user,
          curveCreator: s.curve.creator,
          feeRecipient,
          buybackFeeRecipient,
          spendableLamports: b.spendable,
          minTokensOut: b.minOut,
          baseTokenProgram: s.baseProgram,
        }),
      ];
      description = `Buy ${token.symbol} with ${amt} SOL on the pump.fun curve`;
    } else {
      const pct = Math.min(100, Math.max(0, input.pct ?? 0));
      if ((s.userBalanceRaw ?? ZERO) <= ZERO) throw new TradeError(400, "no_balance", "Nothing to sell — this wallet holds none of this token.");
      const sq = sellQuote(s, pct, slippageBps);
      if (sq.amount <= ZERO) throw new TradeError(400, "bad_amount", "Sell amount rounds to zero.");
      quote = sq.quote;
      tradeIxs = [
        sellV2Ix({
          mint: s.mint,
          user,
          curveCreator: s.curve.creator,
          feeRecipient,
          buybackFeeRecipient,
          amount: sq.amount,
          minSolOutput: sq.minSol,
          baseTokenProgram: s.baseProgram,
        }),
      ];
      description = `Sell ${pct}% of your ${token.symbol} on the pump.fun curve`;
    }

    // Priority fee: input.priorityFee is the total SOL the trader is willing to pay on top of the base fee.
    const priorityLamports = Math.floor(Math.min(MAX_PRIORITY_SOL, Math.max(0, input.priorityFee)) * 1e9);
    const conn = solConnection();
    let blockhash: string;
    try {
      blockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    } catch (e) {
      throw new TradeError(502, "rpc_unreachable", `Solana RPC unavailable (${(e as Error).message}). Nothing was sent.`);
    }
    const build = (limit: number) => {
      const price = priorityLamports > 0 ? Math.floor((priorityLamports * 1e6) / limit) : 0;
      const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ...(price > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })] : []), ...tradeIxs];
      const c = compileTx(user, blockhash, ixs, null);
      if (!c) throw new TradeError(500, "tx_too_large", "Trade transaction doesn't fit into one Solana packet.");
      return c;
    };
    // Measure with a generous limit, then size the real limit with headroom (the priority fee total stays the same).
    const measured = await simulateSol(build(MEASURE_CU).tx);
    let limit: number = DEFAULT_CU[side];
    if (measured.ok && measured.unitsConsumed) limit = Math.max(60_000, Math.ceil((measured.unitsConsumed * 1.3) / 1000) * 1000);
    const compiled = build(limit);
    if (!measured.ok) quote.warnings.push(`Simulation failed — the trade would likely revert: ${measured.error ?? "unknown error"}`);
    if (input.jitoTip > 0) quote.warnings.push("Jito tip isn't applied on this route — priority fee only.");

    const tx: PreparedTx = { kind: "svm", base64: toBase64(compiled.bytes), signers: [traderB58], partiallySigned: false, description };
    return { txs: [tx], quote };
  },
};
