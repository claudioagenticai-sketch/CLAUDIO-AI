// Agent passport: an SPL Memo transaction signed by the owner wallet whose memo is exactly
//   claudio:passport:<agentId>:<agentWallet>
// It binds the agent id to its wallet on-chain (hosted → the Claudio escrow from escrowForAgent, external → the
// wallet the agent declared). Verified by fetching the confirmed transaction from Solana RPC (read-only).
import type { AgentPassport } from "@shared/agents";
import { primaryRpc } from "../rpc";

export const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export function passportMemo(agentId: string, wallet: string): string {
  return `claudio:passport:${agentId}:${wallet}`;
}

export class PassportError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Memo strings found in a jsonParsed transaction (top-level and inner instructions). */
function memosOf(tx: any): string[] {
  const out: string[] = [];
  const visit = (ix: any) => {
    if (!ix) return;
    const pid = ix.programId ?? ix.programIdIndex;
    if (typeof pid === "string" && MEMO_PROGRAMS.has(pid)) {
      if (typeof ix.parsed === "string") out.push(ix.parsed);
      else if (typeof ix.parsed?.memo === "string") out.push(ix.parsed.memo);
    }
  };
  for (const ix of tx?.transaction?.message?.instructions ?? []) visit(ix);
  for (const inner of tx?.meta?.innerInstructions ?? []) for (const ix of inner.instructions ?? []) visit(ix);
  // getTransaction(jsonParsed) also exposes memos in the log; the instruction is authoritative, logs are not used.
  return out;
}

function signersOf(tx: any): string[] {
  const keys = tx?.transaction?.message?.accountKeys ?? [];
  return keys.filter((k: any) => typeof k === "object" && k?.signer).map((k: any) => String(k.pubkey));
}

export async function verifyPassportTx(sig: string, expect: { owner: string; agentId: string; wallet: string }): Promise<AgentPassport> {
  if (!SIG_RE.test(sig)) throw new PassportError("bad_tx", "tx must be a base58 transaction signature");
  const rpc = primaryRpc("sol");
  if (!rpc) throw new PassportError("rpc_unavailable", "No Solana RPC configured");
  let j: any;
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    j = await r.json();
  } catch (e) {
    throw new PassportError("rpc_unavailable", `Solana RPC error: ${(e as Error).message}`);
  }
  const tx = j?.result;
  if (!tx) throw new PassportError("tx_not_found", "Transaction not found (wait for confirmation and retry)");
  if (tx.meta?.err) throw new PassportError("tx_failed", "Transaction failed on-chain");
  if (!signersOf(tx).includes(expect.owner)) throw new PassportError("not_owner_signed", "The transaction is not signed by the owner wallet");
  const want = passportMemo(expect.agentId, expect.wallet);
  const memos = memosOf(tx);
  if (!memos.includes(want)) throw new PassportError("memo_mismatch", `The memo must be exactly "${want}"`);
  const at = tx.blockTime ? new Date(tx.blockTime * 1000) : new Date();
  return { tx: sig, wallet: expect.wallet, owner: expect.owner, registeredAt: at.toISOString() };
}
