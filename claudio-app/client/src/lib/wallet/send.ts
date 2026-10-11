// signAndSend: signs prepared transactions with the active wallet (local keystore or injected) and
// broadcasts them sequentially, waiting for each to confirm before the next.

import { createWalletClient, custom, http, isAddress, isHex, type Address, type Hex } from "viem";
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { CHAINS, type ChainId } from "@shared/chains";
import type { PreparedTx } from "@shared/types";
import type { SendResult, WalletAccount } from "./index";
import { b64ToBytes } from "./codec";
import { ensureEvmChain, evmProvider, isUserRejection, solProvider } from "./injected";
import { requireUnlocked, withEvmSigner, withSolSigner } from "./keystore";
import { evmRpcUrl, publicClient, solConnection, viemChain } from "./rpc";
import { getActiveAccount, useWallet } from "./state";

type EvmTx = Extract<PreparedTx, { kind: "evm" }>;
type SvmTx = Extract<PreparedTx, { kind: "svm" }>;

/** Thrown by signAndSend. `hashes` lists the txs that DID land before the failure. */
export class SendError extends Error {
  hashes: string[];
  constructor(message: string, hashes: string[]) {
    super(message);
    this.name = "SendError";
    this.hashes = [...hashes];
  }
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function firstLine(e: unknown): string {
  const x = e as { shortMessage?: unknown; message?: unknown } | null;
  const msg = typeof x?.shortMessage === "string" ? x.shortMessage : typeof x?.message === "string" ? x.message : String(e);
  return msg.split("\n")[0].slice(0, 240);
}

function readableEvm(e: unknown, native: string): string {
  if (isUserRejection(e)) return "Rejected in wallet";
  const msg = firstLine(e);
  if (/insufficient funds/i.test(msg)) return `Insufficient ${native} for amount + gas`;
  if (/nonce too low|replacement transaction underpriced/i.test(msg)) return "Nonce conflict — another transaction is still pending";
  if (/execution reverted/i.test(msg)) return msg.replace(/^.*?execution reverted/i, "Would revert");
  return msg;
}

function readableSol(e: unknown): string {
  if (isUserRejection(e)) return "Rejected in wallet";
  const msg = firstLine(e);
  if (/no record of a prior credit|insufficient lamports|insufficient funds/i.test(msg)) return "Insufficient SOL for amount + fees";
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) return "Transaction expired before landing — try again (P2/P3 pays more priority)";
  return msg;
}

export async function signAndSend(chain: ChainId, txs: PreparedTx[]): Promise<SendResult> {
  const c = CHAINS[chain];
  if (txs.length === 0) return { hashes: [] };
  if (txs.some((t) => t.kind !== c.kind)) throw new SendError(`Transaction type doesn't match ${c.name}`, []);

  let acct = getActiveAccount(c.kind);
  if (!acct || (acct.source === "local" && !useWallet.getState().unlocked)) {
    await requireUnlocked(`Sign ${txs.length > 1 ? `${txs.length} transactions` : "transaction"} on ${c.short}`);
    acct = getActiveAccount(c.kind);
  }
  if (!acct) throw new SendError(`No ${c.kind === "evm" ? "EVM" : "Solana"} wallet — create or connect one first`, []);

  if (c.kind === "evm") return sendEvm(chain, acct, txs as EvmTx[]);
  return sendSvm(acct, txs as SvmTx[]);
}

// ─── EVM ────────────────────────────────────────────────────────────

interface EvmCall {
  to: Address;
  data?: Hex;
  value: bigint;
  gas?: bigint;
}

function toCall(tx: EvmTx, i: number): EvmCall {
  if (!isAddress(tx.to)) throw new SendError(`Tx ${i + 1}: invalid recipient`, []);
  if (tx.data && !isHex(tx.data)) throw new SendError(`Tx ${i + 1}: invalid calldata`, []);
  let value: bigint;
  let gas: bigint | undefined;
  try {
    value = BigInt(tx.value || "0");
    gas = tx.gas ? BigInt(tx.gas) : undefined;
  } catch {
    throw new SendError(`Tx ${i + 1}: invalid value/gas`, []);
  }
  return { to: tx.to as Address, data: tx.data ? (tx.data as Hex) : undefined, value, gas };
}

async function sendEvm(chain: ChainId, acct: WalletAccount, txs: EvmTx[]): Promise<SendResult> {
  const c = CHAINS[chain];
  const chainDef = viemChain(chain);
  const pub = publicClient(chain);
  const hashes: string[] = [];

  // Validate everything up front so we never send tx 1 of a batch that can't complete.
  const calls = txs.map((tx, i) => {
    if (tx.chainId !== c.evmChainId) throw new SendError(`Tx ${i + 1} targets chain ${tx.chainId}, expected ${c.name}`, []);
    return toCall(tx, i);
  });

  const run = async (send: (call: EvmCall) => Promise<Hex>) => {
    for (let i = 0; i < calls.length; i++) {
      let hash: Hex;
      try {
        hash = await send(calls[i]);
      } catch (e) {
        throw new SendError(readableEvm(e, c.nativeSymbol), hashes);
      }
      hashes.push(hash);
      let status: "success" | "reverted";
      try {
        const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
        status = receipt.status;
      } catch {
        throw new SendError(`Tx ${i + 1} not confirmed within 60s — check the explorer`, hashes);
      }
      if (status !== "success") {
        const d = txs[i].description;
        throw new SendError(`Tx ${i + 1}/${calls.length} reverted${d ? ` (${d})` : ""}`, hashes);
      }
    }
  };

  if (acct.source === "local") {
    await withEvmSigner(acct.id, async (account) => {
      const wc = createWalletClient({ account, chain: chainDef, transport: http(evmRpcUrl(chain)) });
      await run((call) => wc.sendTransaction({ to: call.to, data: call.data, value: call.value, gas: call.gas }));
    });
  } else {
    const provider = evmProvider();
    if (!provider) throw new SendError("Browser wallet not found", []);
    try {
      await ensureEvmChain(chain);
    } catch (e) {
      throw new SendError(isUserRejection(e) ? `Switch to ${c.name} in your wallet to continue` : readableEvm(e, c.nativeSymbol), []);
    }
    const wc = createWalletClient({ account: acct.address as Address, chain: chainDef, transport: custom(provider) });
    await run((call) => wc.sendTransaction({ to: call.to, data: call.data, value: call.value, gas: call.gas }));
  }
  return { hashes };
}

// ─── Solana ─────────────────────────────────────────────────────────

async function sendSvm(acct: WalletAccount, txs: SvmTx[]): Promise<SendResult> {
  const conn = solConnection();
  const me = new PublicKey(acct.address);
  const hashes: string[] = [];

  for (let i = 0; i < txs.length; i++) {
    const tag = `Tx ${i + 1}${txs.length > 1 ? `/${txs.length}` : ""}`;
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(b64ToBytes(txs[i].base64));
    } catch {
      throw new SendError(`${tag}: couldn't decode transaction`, hashes);
    }
    const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    if (!required.some((k) => k.equals(me))) {
      throw new SendError(`${tag} doesn't require your wallet (${short(acct.address)}) to sign`, hashes);
    }

    let signed: VersionedTransaction;
    try {
      if (acct.source === "local") {
        // sign() fills only our signer slot and keeps existing partial signatures (e.g. mint keypair).
        signed = await withSolSigner(acct.id, async (kp) => {
          tx.sign([kp]);
          return tx;
        });
      } else {
        const prov = solProvider();
        if (!prov) throw new Error("Solana browser wallet not found");
        signed = await prov.signTransaction<VersionedTransaction>(tx);
      }
    } catch (e) {
      throw new SendError(readableSol(e), hashes);
    }

    const missing = required.filter((_, idx) => {
      const sig = signed.signatures[idx];
      return !sig || sig.every((b) => b === 0);
    });
    if (missing.length) {
      throw new SendError(`${tag} is missing signatures from ${missing.map((k) => short(k.toBase58())).join(", ")}`, hashes);
    }

    let lastValidBlockHeight: number;
    let sig: string;
    try {
      lastValidBlockHeight = (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;
      sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" });
    } catch (e) {
      throw new SendError(readableSol(e), hashes);
    }
    hashes.push(sig);

    try {
      const err = await waitForSolConfirmation(conn, sig, lastValidBlockHeight);
      if (err) throw new SendError(`${tag} failed on-chain: ${JSON.stringify(err)}`, hashes);
    } catch (e) {
      if (e instanceof SendError) throw e;
      throw new SendError(readableSol(e), hashes);
    }
  }
  return { hashes };
}

/**
 * Polls signature statuses until the transaction is confirmed, fails, or its blockhash expires. Plain HTTP (no
 * websocket subscription), so it works through the server's RPC proxy. Returns the on-chain error, or null on success.
 */
async function waitForSolConfirmation(conn: Connection, signature: string, lastValidBlockHeight: number): Promise<unknown | null> {
  const started = Date.now();
  for (let i = 0; ; i++) {
    const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const st = value[0];
    if (st?.err) return st.err;
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return null;
    // Every few polls, check whether the blockhash can still land.
    if (i % 4 === 3) {
      const height = await conn.getBlockHeight("confirmed").catch(() => 0);
      if (height > lastValidBlockHeight) {
        const last = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (last?.err) return last.err;
        if (last?.confirmationStatus === "confirmed" || last?.confirmationStatus === "finalized") return null;
        throw new Error("The transaction expired before it landed. Nothing was spent; try again.");
      }
    }
    if (Date.now() - started > 120_000) throw new Error("Still waiting for confirmation after 2 minutes — check the explorer before retrying.");
    await new Promise((r) => setTimeout(r, 1_200));
  }
}
