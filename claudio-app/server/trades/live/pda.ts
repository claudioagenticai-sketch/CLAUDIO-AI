// Accounts a pump.fun coin trades through: the bonding curve (pump: ["bonding-curve", mint]) and, after graduation,
// the canonical PumpSwap pool (pump_amm: ["pool", u16 index = 0, pool-authority, mint, WSOL] where pool-authority is
// pump's ["pool-authority", mint] — docs/PUMP_SWAP_README.md + PUMP_SWAP_CREATOR_FEE_README.md). Cached per mint.
import { PublicKey } from "@solana/web3.js";
import { PUMP_AMM_PROGRAM, PUMP_PROGRAM, WSOL, pumpPda } from "../../launch/pump/ixs";

const cache = new Map<string, { curve: string; pool: string } | null>();

export function pumpAccounts(mint: string): { curve: string; pool: string } | null {
  const hit = cache.get(mint);
  if (hit !== undefined) return hit;
  let out: { curve: string; pool: string } | null = null;
  try {
    const m = new PublicKey(mint);
    const curve = pumpPda.bondingCurve(m);
    const authority = PublicKey.findProgramAddressSync([Buffer.from("pool-authority"), m.toBuffer()], PUMP_PROGRAM)[0];
    const index = Buffer.alloc(2); // CANONICAL_POOL_INDEX = 0 (u16 LE)
    const pool = PublicKey.findProgramAddressSync([Buffer.from("pool"), index, authority.toBuffer(), m.toBuffer(), WSOL.toBuffer()], PUMP_AMM_PROGRAM)[0];
    out = { curve: curve.toBase58(), pool: pool.toBase58() };
  } catch {
    out = null;
  }
  cache.set(mint, out);
  if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
  return out;
}
