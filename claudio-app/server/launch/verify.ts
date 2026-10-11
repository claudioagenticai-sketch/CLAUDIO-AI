// Which submitted signatures really belong to a launch. Used by /api/launch/confirm and the reconciler so nobody but
// the planning wallet can attach (or overwrite) transaction hashes on a launch record.
//
// Solana: a transaction id IS the fee payer's ed25519 signature over the message. The plan stores the exact messages
// it built (meta.planMsgs), so a hash is accepted when it verifies as the creator's signature over one of them — no
// RPC needed. (The creation tx is pre-signed by the mint, so a wallet can't modify it without breaking that
// signature; a separate dev-buy tx might be re-written by a wallet, so a non-matching hash may still be accepted from
// the chain: fee payer = creator and the planned mint among its accounts.) Unknown hashes are kept as candidates.
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { verifySolanaSignature } from "../auth";
import { solConnection } from "./sol";
import type { LaunchRecord } from "./types";

export interface HashVerdict {
  /** Accepted hashes, ordered by their planned transaction index (chain-verified extras last). */
  accepted: string[];
  /** Not verifiable yet (not on-chain / not found) — worth re-checking later. */
  pending: string[];
  /** Definitely not this launch's transactions. */
  rejected: string[];
}

function plannedMessages(launch: LaunchRecord): Buffer[] {
  try {
    const list = JSON.parse(launch.meta.planMsgs ?? "[]") as string[];
    return list.map((b) => Buffer.from(b, "base64"));
  } catch {
    return [];
  }
}

function decodeSig(hash: string): Uint8Array | null {
  try {
    const b = bs58.decode(hash);
    return b.length === 64 ? b : null;
  } catch {
    return null;
  }
}

/** Offline part: index of the planned message this hash signs (by the creator), or -1. */
export function plannedIndexOf(launch: LaunchRecord, hash: string): number {
  const sig = decodeSig(hash);
  if (!sig) return -1;
  const msgs = plannedMessages(launch);
  for (let i = 0; i < msgs.length; i++) if (verifySolanaSignature(launch.creator, msgs[i], sig)) return i;
  return -1;
}

/** Online fallback: the landed tx was paid by the creator and touches the planned mint. null = not found (yet). */
async function chainBelongs(launch: LaunchRecord, hash: string): Promise<boolean | null> {
  try {
    const tx = await solConnection().getTransaction(hash, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx) return null;
    const keys = tx.transaction.message.staticAccountKeys.map((k: PublicKey) => k.toBase58());
    return keys[0] === launch.creator && !!launch.meta.mint && keys.includes(launch.meta.mint);
  } catch {
    return null;
  }
}

export async function verifySolHashes(launch: LaunchRecord, hashes: string[], opts: { online?: boolean } = {}): Promise<HashVerdict> {
  const out: HashVerdict = { accepted: [], pending: [], rejected: [] };
  const indexed: { i: number; h: string }[] = [];
  const unique = hashes.filter((h, i) => hashes.indexOf(h) === i);
  for (const h of unique) {
    if (!decodeSig(h)) {
      out.rejected.push(h);
      continue;
    }
    const i = plannedIndexOf(launch, h);
    if (i >= 0) {
      indexed.push({ i, h });
      continue;
    }
    if (opts.online === false) {
      out.pending.push(h);
      continue;
    }
    const belongs = await chainBelongs(launch, h);
    if (belongs === true) indexed.push({ i: 1_000 + indexed.length, h });
    else if (belongs === false) out.rejected.push(h);
    else out.pending.push(h);
  }
  // One hash per planned tx (a second, different signature for the same message would be a replay attempt).
  const seen = new Set<number>();
  for (const x of indexed.sort((a, b) => a.i - b.i)) {
    if (x.i < 1_000 && seen.has(x.i)) {
      out.rejected.push(x.h);
      continue;
    }
    seen.add(x.i);
    out.accepted.push(x.h);
  }
  return out;
}
