// Live pump.fun fee recipients from the Global account (cached 10 min). pump checks fee_recipient against Global, so
// hard-coded lists break the moment pump rotates them (and devnet's Global already differs from mainnet's).
// Layout (idl/pump.json Global): disc 8 · initialized 1 · authority 32 · fee_recipient 32 @41 · 4×u64 · fee_bps u64 ·
// withdraw_authority 32 · enable_migrate 1 · pool_migration_fee 8 · creator_fee_bps 8 · fee_recipients[7] @162 ·
// set_creator_authority 32 · admin_set_creator_authority 32 · create_v2_enabled 1 · whitelist_pda 32 ·
// reserved_fee_recipient 32 @483 · mayhem_mode_enabled 1 · reserved_fee_recipients[7] @516 · is_cashback_enabled 1 ·
// buyback_fee_recipients[8] @741.
import { PublicKey } from "@solana/web3.js";
import { solConnection } from "../sol";
import { BUYBACK_FEE_RECIPIENTS, FEE_RECIPIENTS, MAYHEM_FEE_RECIPIENTS, pumpPda } from "./ixs";

export interface PumpFeeRecipients {
  normal: PublicKey[];
  mayhem: PublicKey[];
  buyback: PublicKey[];
  source: "chain" | "constants";
}

const FALLBACK: PumpFeeRecipients = { normal: FEE_RECIPIENTS, mayhem: MAYHEM_FEE_RECIPIENTS, buyback: BUYBACK_FEE_RECIPIENTS, source: "constants" };

const keys = (data: Buffer, offset: number, n: number): PublicKey[] => {
  const out: PublicKey[] = [];
  for (let i = 0; i < n; i++) {
    const k = new PublicKey(data.subarray(offset + 32 * i, offset + 32 * (i + 1)));
    if (!k.equals(PublicKey.default)) out.push(k);
  }
  return out;
};

export function decodeGlobalRecipients(data: Buffer): Omit<PumpFeeRecipients, "source"> | null {
  if (data.length < 741 + 32 * 8) return null;
  return {
    normal: [...keys(data, 41, 1), ...keys(data, 162, 7)],
    mayhem: [...keys(data, 483, 1), ...keys(data, 516, 7)],
    buyback: keys(data, 741, 8),
  };
}

let cache: { at: number; v: PumpFeeRecipients } | null = null;

export async function pumpFeeRecipients(): Promise<PumpFeeRecipients> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.v;
  let v = FALLBACK;
  try {
    const info = await solConnection().getAccountInfo(pumpPda.global(), "confirmed");
    const d = info ? decodeGlobalRecipients(Buffer.from(info.data)) : null;
    if (d && d.normal.length && d.mayhem.length && d.buyback.length) v = { ...d, source: "chain" };
  } catch {
    /* constants */
  }
  cache = { at: Date.now(), v };
  return v;
}

/** Random pick, preferring addresses already in the lookup table (keeps the atomic launch tx under 1232 B). */
export function pickRecipient(list: PublicKey[], inLut?: Set<string>): PublicKey {
  const preferred = inLut ? list.filter((k) => inLut.has(k.toBase58())) : [];
  const pool = preferred.length ? preferred : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
