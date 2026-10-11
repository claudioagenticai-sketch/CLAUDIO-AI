// One-time ops helper: builds the transactions that create Claudio's pump.fun Address Lookup Table.
//
// Why: create_v2 + create_fee_sharing_config + update_fee_shares_v2 + dev buy touch ~40 accounts. As a legacy
// transaction that is ~1.7 KB, far over Solana's 1232-byte packet limit, so without a lookup table the launch is
// split into several transactions (dev buy not atomic with creation). With a LUT holding the static accounts the
// whole launch fits into ONE v0 transaction.
//
// Usage (operator): POST /api/launch/pump/lut { authority } → sign & send the returned txs with that wallet,
// wait ~1 slot, then set PUMP_LUT_ADDRESS=<address> and restart. Sign within ~1 minute (blockhash + recent-slot
// windows). Nothing here touches user funds; the authority pays ~0.01 SOL rent for the table.
import { AddressLookupTableProgram, PublicKey } from "@solana/web3.js";
import type { PreparedTx } from "@shared/types";
import { compileTx, solConnection, toBase64 } from "../sol";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { WSOL, pumpStaticAccounts } from "./ixs";
import { pumpFeeRecipients } from "./global";

const CHUNK = 20;

export async function buildLutSetup(authorityB58: string): Promise<{ address: string; txs: PreparedTx[]; addresses: string[] }> {
  const authority = new PublicKey(authorityB58);
  const conn = solConnection();
  const [finalized, { blockhash }] = await Promise.all([conn.getSlot("finalized"), conn.getLatestBlockhash("confirmed")]);
  // recentSlot must be in the SlotHashes sysvar of whichever node executes the tx: a slot that produced a block, a bit
  // behind the tip (load-balanced RPCs lag — the newest finalized slot was rejected as "not a recent slot" on devnet).
  const blocks = await conn.getBlocks(finalized - 40, finalized - 20, "finalized").catch(() => [] as number[]);
  const slot = blocks.length ? blocks[blocks.length - 1] : finalized - 30;
  const [createIx, lut] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot: slot });
  // Static accounts + the LIVE fee recipients (and their wSOL ATAs) from pump's Global, so a rotated list still fits.
  const live = await pumpFeeRecipients();
  const extra = [...live.normal, ...live.mayhem, ...live.buyback].flatMap((p) => [p, getAssociatedTokenAddressSync(WSOL, p, true, TOKEN_PROGRAM_ID)]);
  const seen = new Set<string>();
  const addresses = [...pumpStaticAccounts(), ...extra].filter((a) => (seen.has(a.toBase58()) ? false : (seen.add(a.toBase58()), true)));
  const txs: PreparedTx[] = [];
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable: lut, authority, payer: authority, addresses: chunk });
    const ixs = i === 0 ? [createIx, extendIx] : [extendIx];
    const compiled = compileTx(authority, blockhash, ixs, null);
    if (!compiled) throw new Error("LUT setup transaction too large");
    txs.push({
      kind: "svm",
      base64: toBase64(compiled.bytes),
      signers: [authority.toBase58()],
      partiallySigned: false,
      description: i === 0 ? `Create lookup table + add ${chunk.length} addresses` : `Extend lookup table (+${chunk.length})`,
    });
  }
  return { address: lut.toBase58(), txs, addresses: addresses.map((a) => a.toBase58()) };
}
