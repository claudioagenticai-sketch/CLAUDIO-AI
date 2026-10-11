// Solana helpers for the launch module: connection, tx compilation with size checks, simulation.
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { launchEnv } from "./env";

/** Solana's hard packet limit for a serialized transaction. */
export const PACKET_LIMIT = 1232;

let conn: Connection | undefined;
export function solConnection(): Connection {
  if (!conn) conn = new Connection(launchEnv.rpcUrl("sol"), { commitment: "confirmed" });
  return conn;
}

export interface CompiledTx {
  tx: VersionedTransaction;
  bytes: Uint8Array;
  size: number;
}

/**
 * Compile instructions into a legacy message (no lookup tables — widest wallet compatibility) or a v0 message
 * when a lookup table is supplied. Returns null when the result does not fit into one packet.
 */
export function compileTx(
  payer: PublicKey,
  blockhash: string,
  ixs: TransactionInstruction[],
  lut: AddressLookupTableAccount | null,
  signWith: Keypair[] = [],
): CompiledTx | null {
  try {
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs });
    const compiled = lut ? msg.compileToV0Message([lut]) : msg.compileToLegacyMessage();
    const tx = new VersionedTransaction(compiled);
    if (signWith.length) tx.sign(signWith);
    const bytes = tx.serialize();
    if (bytes.length > PACKET_LIMIT) return null;
    return { tx, bytes, size: bytes.length };
  } catch {
    // web3.js throws RangeError when the message overflows its packet-sized buffer.
    return null;
  }
}

export interface SolSimResult {
  ok: boolean;
  error?: string;
  unitsConsumed?: number;
  logs?: string[];
}

/** simulateTransaction without signature verification (the creator hasn't signed yet). Never throws. */
export async function simulateSol(tx: VersionedTransaction): Promise<SolSimResult> {
  try {
    const res = await solConnection().simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    });
    const v = res.value;
    if (v.err) {
      const logs = v.logs ?? [];
      const tail = logs.filter((l) => /error|failed|Error/i.test(l)).slice(-3);
      return {
        ok: false,
        error: `${JSON.stringify(v.err)}${tail.length ? ` — ${tail.join(" | ")}` : ""}`,
        unitsConsumed: v.unitsConsumed ?? undefined,
        logs: logs.slice(-30),
      };
    }
    return { ok: true, unitsConsumed: v.unitsConsumed ?? undefined, logs: (v.logs ?? []).slice(-30) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
