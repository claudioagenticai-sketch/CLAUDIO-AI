// Decoders for pump.fun bonding-curve TradeEvent and PumpSwap BuyEvent / SellEvent (Anchor events: 8-byte
// discriminator + Borsh). Layouts from research/repos/pump-public-docs/idl/{pump,pump_amm}.json.
//
// Where the events live (checked against mainnet txs, see fixtures/ + live.check.ts):
//  • both programs log every trade event as a `Program data: <base64>` line (Anchor `emit!`), so a logsSubscribe
//    notification alone is enough;
//  • they ALSO self-CPI the same bytes (`emit_cpi!`) as an inner instruction to the program's __event_authority, prefixed
//    by the 8-byte Anchor event-ix tag. That copy survives log truncation, so it's the fallback path (getTransaction).
//
// Units: pump tokens have 6 decimals, SOL 9. Amounts we report:
//  • curve: sol_amount (SOL into / out of the curve reserves, before platform/creator fees — same as PumpPortal's
//    `solAmount`) and token_amount;
//  • PumpSwap: quote_amount_in (buy) / quote_amount_out (sell) — the pool-side SOL before fees, the same convention.
// Price = amountNative / amountToken (pre-fee execution price). Spot after the trade comes from the event's reserves.
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

const DISC = {
  TradeEvent: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  BuyEvent: Buffer.from([103, 244, 82, 31, 44, 245, 119, 119]),
  SellEvent: Buffer.from([62, 47, 55, 10, 165, 3, 220, 42]),
};
/** sha256("anchor:event")[0..8] — prefix of an `emit_cpi!` inner instruction. */
export const EVENT_IX_TAG = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

const TOKEN_DECIMALS = 1e6;
const LAMPORTS = 1e9;

/** A trade normalized from either program; amounts in human units. */
export interface DecodedTrade {
  program: "pump" | "pump-amm";
  side: "buy" | "sell";
  /** Token mint (curve events carry it; AMM events carry the pool, mapped to the mint by the caller). */
  mint?: string;
  pool?: string;
  trader: string;
  amountToken: number;
  amountSol: number;
  /** Raw integer amounts (exact). */
  rawToken: bigint;
  rawLamports: bigint;
  /** amountSol / amountToken. */
  priceSol: number;
  /** Spot price after the trade (SOL per token) from the reserves in the event. */
  spotSol: number;
  /** Unix seconds from the event. */
  timestamp: number;
  /** Curve only: post-trade reserves (lamports / raw tokens). */
  curve?: { vSol: bigint; vToken: bigint; realSol: bigint; realToken: bigint; mayhem?: boolean; quoteMint?: string };
  /** AMM only: post-trade pool reserves (raw base; effective quote = vault + virtual_quote_reserves). */
  amm?: { baseReserves: bigint; quoteReserves: bigint; virtualQuote: bigint; quoteVaultDelta: bigint; lpFee: bigint };
  ixName?: string;
}

class Reader {
  o = 0;
  constructor(readonly b: Buffer) {}
  left(): number {
    return this.b.length - this.o;
  }
  u8(): number {
    const v = this.b.readUInt8(this.o);
    this.o += 1;
    return v;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    const v = this.b.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  u32(): number {
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u64(): bigint {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64(): bigint {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i128(): bigint {
    const lo = this.b.readBigUInt64LE(this.o);
    const hi = this.b.readBigInt64LE(this.o + 8);
    this.o += 16;
    return (hi << 64n) | lo;
  }
  pubkey(): string {
    const v = new PublicKey(this.b.subarray(this.o, this.o + 32)).toBase58();
    this.o += 32;
    return v;
  }
  str(): string {
    const n = this.u32();
    if (n > 256 || n > this.left()) throw new RangeError("string too long");
    const v = this.b.toString("utf8", this.o, this.o + n);
    this.o += n;
    return v;
  }
}

const num = (raw: bigint, scale: number): number => Number(raw) / scale;

/** Reads optional trailing fields: events written before a field existed are shorter → undefined. */
function opt<T>(r: Reader, need: number, f: () => T): T | undefined {
  if (r.left() < need) return undefined;
  try {
    return f();
  } catch {
    return undefined;
  }
}

function decodePumpTrade(body: Buffer): DecodedTrade | null {
  const r = new Reader(body);
  if (r.left() < 32 + 8 + 8 + 1 + 32 + 8 + 8 * 4) return null;
  const mint = r.pubkey();
  const solAmount = r.u64();
  const tokenAmount = r.u64();
  const isBuy = r.bool();
  const user = r.pubkey();
  const timestamp = Number(r.i64());
  const vSol = r.u64();
  const vToken = r.u64();
  const realSol = r.u64();
  const realToken = r.u64();
  // fee_recipient, fee_basis_points, fee, creator, creator_fee_basis_points, creator_fee, track_volume,
  // total_unclaimed_tokens, total_claimed_tokens, current_sol_volume, last_update_timestamp, ix_name, mayhem_mode, …
  let ixName: string | undefined;
  let mayhem: boolean | undefined;
  let quoteMint: string | undefined;
  let quoteAmount: bigint | undefined;
  let vQuote: bigint | undefined;
  try {
    r.o += 32 + 8 + 8 + 32 + 8 + 8 + 1 + 8 + 8 + 8 + 8;
    ixName = opt(r, 4, () => r.str());
    mayhem = opt(r, 1, () => r.bool());
    // cashback_fee_basis_points, cashback, buyback_fee_basis_points, buyback_fee
    if (r.left() >= 32) {
      r.o += 32;
      const n = r.u32();
      if (n > 64 || r.left() < n * 34) throw new RangeError("bad shareholders");
      r.o += n * 34; // Shareholder { address: pubkey, share_bps: u16 }
      quoteMint = opt(r, 32, () => r.pubkey());
      quoteAmount = opt(r, 8, () => r.u64());
      vQuote = opt(r, 8, () => r.u64());
    }
  } catch {
    /* trailing fields are informational */
  }
  // Non-SOL quote coins (custom pairs) report the quote side in quote_amount; SOL coins in sol_amount.
  const solQuote = !quoteMint || quoteMint === DEFAULT_PUBKEY || quoteMint === WSOL_MINT;
  const lamports = solQuote ? solAmount : (quoteAmount ?? solAmount);
  const vS = solQuote ? vSol : (vQuote ?? vSol);
  const amountToken = num(tokenAmount, TOKEN_DECIMALS);
  const amountSol = num(lamports, LAMPORTS);
  return {
    program: "pump",
    side: isBuy ? "buy" : "sell",
    mint,
    trader: user,
    amountToken,
    amountSol,
    rawToken: tokenAmount,
    rawLamports: lamports,
    priceSol: amountToken > 0 ? amountSol / amountToken : 0,
    spotSol: vToken > 0n ? num(vS, LAMPORTS) / num(vToken, TOKEN_DECIMALS) : 0,
    timestamp,
    curve: { vSol: vS, vToken, realSol, realToken, mayhem, quoteMint },
    ixName,
  };
}

function decodeAmm(body: Buffer, side: "buy" | "sell"): DecodedTrade | null {
  const r = new Reader(body);
  if (r.left() < 8 * 14 + 32 * 2) return null;
  const timestamp = Number(r.i64());
  const baseAmount = r.u64(); // base_amount_out (buy) / base_amount_in (sell)
  r.u64(); // max_quote_amount_in / min_quote_amount_out
  r.u64(); // user_base_token_reserves
  r.u64(); // user_quote_token_reserves
  const poolBase = r.u64(); // pre-trade base vault balance
  const poolQuote = r.u64(); // pre-trade quote vault balance (raw; effective = raw + virtual_quote_reserves)
  const quoteField = r.u64(); // quote_amount_in (buy; = the whole budget on buy_exact_quote_in) / quote_amount_out (sell, gross)
  r.u64(); // lp_fee_basis_points
  const lpFee = r.u64();
  r.u64(); // protocol_fee_basis_points
  r.u64(); // protocol_fee
  const vaultDelta = r.u64(); // quote_amount_in_with_lp_fee (buy) / quote_amount_out_without_lp_fee (sell)
  r.u64(); // user_quote_amount_in / user_quote_amount_out
  const pool = r.pubkey();
  const user = r.pubkey();
  let ixName: string | undefined;
  let vQuote = 0n;
  try {
    // user_base_token_account, user_quote_token_account, protocol_fee_recipient, protocol_fee_recipient_token_account,
    // coin_creator, coin_creator_fee_basis_points, coin_creator_fee
    r.o += 32 * 5 + 8 + 8;
    if (side === "buy") {
      // track_volume, total_unclaimed_tokens, total_claimed_tokens, current_sol_volume, last_update_timestamp,
      // min_base_amount_out, ix_name
      r.o += 1 + 8 * 5;
      ixName = opt(r, 4, () => r.str());
    }
    // cashback_fee_basis_points, cashback, buyback_fee_basis_points, buyback_fee, virtual_quote_reserves (i128)
    if (r.left() >= 32 + 16) {
      r.o += 32;
      vQuote = r.i128();
    }
  } catch {
    /* trailing fields are informational */
  }
  // Verified on mainnet txs (fixtures): the quote vault moves by exactly `vaultDelta` (the LP fee stays in the pool,
  // protocol / creator / buyback fees leave it). The SOL that hits the x·y=k curve, before any fee — the same
  // convention as the bonding curve's sol_amount — is vaultDelta − lp_fee on a buy (equals quote_amount_in on `buy`,
  // user_quote_amount_in on `buy_exact_quote_in`) and quote_amount_out (gross) on a sell.
  const quoteAmount = side === "buy" ? vaultDelta - lpFee : quoteField;
  const base = side === "buy" ? poolBase - baseAmount : poolBase + baseAmount;
  const quote = (side === "buy" ? poolQuote + vaultDelta : poolQuote - vaultDelta) + vQuote;
  const amountToken = num(baseAmount, TOKEN_DECIMALS);
  const amountSol = num(quoteAmount, LAMPORTS);
  return {
    program: "pump-amm",
    side,
    pool,
    trader: user,
    amountToken,
    amountSol,
    rawToken: baseAmount,
    rawLamports: quoteAmount,
    priceSol: amountToken > 0 ? amountSol / amountToken : 0,
    spotSol: base > 0n ? num(quote, LAMPORTS) / num(base, TOKEN_DECIMALS) : 0,
    timestamp,
    amm: { baseReserves: base, quoteReserves: quote, virtualQuote: vQuote, quoteVaultDelta: vaultDelta, lpFee },
    ixName,
  };
}

/** Decode one Anchor event payload (discriminator + Borsh). Unknown events → null. */
export function decodeEvent(data: Buffer): DecodedTrade | null {
  if (data.length < 8) return null;
  const disc = data.subarray(0, 8);
  const body = data.subarray(8);
  try {
    if (disc.equals(DISC.TradeEvent)) return decodePumpTrade(body);
    if (disc.equals(DISC.BuyEvent)) return decodeAmm(body, "buy");
    if (disc.equals(DISC.SellEvent)) return decodeAmm(body, "sell");
  } catch {
    return null;
  }
  return null;
}

/** Trade events from a tx's log lines (`Program data: <base64>`), in order. */
export function decodeLogs(logs: readonly string[]): DecodedTrade[] {
  const out: DecodedTrade[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(line.slice(14).trim(), "base64");
    } catch {
      continue;
    }
    const d = decodeEvent(buf);
    if (d) out.push(d);
  }
  return out;
}

/** True when the validator cut the logs short (events may be missing → fetch the tx instead). */
export function logsTruncated(logs: readonly string[]): boolean {
  return logs.some((l) => l.startsWith("Log truncated"));
}

interface JsonInnerIx {
  programIdIndex: number;
  data: string;
}
export interface JsonTx {
  slot?: number;
  blockTime?: number | null;
  transaction: { message: { accountKeys: string[] }; signatures: string[] };
  meta: {
    err: unknown;
    logMessages?: string[] | null;
    innerInstructions?: { index: number; instructions: JsonInnerIx[] }[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  } | null;
}

/** Trade events from a `getTransaction` (encoding "json") result: the self-CPI inner instructions. */
export function decodeTransaction(tx: JsonTx): DecodedTrade[] {
  const meta = tx.meta;
  if (!meta || meta.err) return [];
  const keys = [...tx.transaction.message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
  const out: DecodedTrade[] = [];
  for (const group of meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const prog = keys[ix.programIdIndex];
      if (prog !== PUMP_PROGRAM_ID && prog !== PUMP_AMM_PROGRAM_ID) continue;
      let data: Uint8Array;
      try {
        data = bs58.decode(ix.data);
      } catch {
        continue;
      }
      const buf = Buffer.from(data);
      if (buf.length < 16 || !buf.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const d = decodeEvent(buf.subarray(8));
      if (d) out.push(d);
    }
  }
  if (out.length === 0 && meta.logMessages) return decodeLogs(meta.logMessages);
  return out;
}
