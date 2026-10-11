// Vanity mint grinding (Solana, beta) + the client-side mint signature.
//
// How the vanity key reaches the transaction without ever leaving the browser:
//  1. useVanity() grinds a Keypair in N web workers until the base58 pubkey ends with the suffix (e.g. "pump").
//  2. The launch request sends ONLY the public key as `vanitySalt`.
//  3. The server builds the create tx with that mint as a required signer but does NOT sign it
//     (PreparedTx.partiallySigned = false, signers = [creator, mint]).
//  4. Before signAndSend(), addMintSignature() deserializes the tx, signs it with the vanity keypair (filling only
//     the mint's signature slot) and re-serializes it; the wallet then adds the creator's signature.
import { useCallback, useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { PreparedTx } from "@shared/types";

export const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]*$/;
/** Safety valve: never grind forever (≈ 10× the expected work for a 4-char case-sensitive suffix). */
export const MAX_ATTEMPTS = 150_000_000;

export interface VanityResult {
  publicKey: string;
  secretKey: Uint8Array;
  attempts: number;
}

export type VanityState =
  | { status: "idle" }
  | { status: "running"; attempts: number; rate: number; expected: number; startedAt: number; workers: number }
  | { status: "found"; result: VanityResult; ms: number }
  | { status: "exhausted"; attempts: number }
  | { status: "error"; message: string };

/** Expected attempts for a base58 pattern. Case-insensitive letters roughly halve the alphabet per char. */
export function expectedAttempts(pattern: string, caseSensitive: boolean): number {
  let n = 1;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const insensitiveLetter = !caseSensitive && /[a-z]/i.test(ch) && ch.toLowerCase() !== "l" && ch.toUpperCase() !== "O" && ch !== "I";
    n *= insensitiveLetter ? 29 : 58;
  }
  return n;
}

type WorkerMsg =
  | { type: "progress"; attempts: number; rate: number }
  | { type: "found"; publicKey: string; secretKey: number[]; attempts: number }
  | { type: "exhausted"; attempts: number }
  | { type: "error"; message: string };

export function useVanity() {
  const [state, setState] = useState<VanityState>({ status: "idle" });
  const workers = useRef<Worker[]>([]);
  const stats = useRef<{ attempts: number[]; rate: number[] }>({ attempts: [], rate: [] });

  const stop = useCallback(() => {
    workers.current.forEach((w) => w.terminate());
    workers.current = [];
    setState((s) => (s.status === "running" ? { status: "idle" } : s));
  }, []);

  useEffect(() => () => workers.current.forEach((w) => w.terminate()), []);

  const start = useCallback((suffix: string, caseSensitive = true, prefix = "") => {
    workers.current.forEach((w) => w.terminate());
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const expected = expectedAttempts(suffix + prefix, caseSensitive);
    const startedAt = Date.now();
    stats.current = { attempts: new Array(n).fill(0), rate: new Array(n).fill(0) };
    setState({ status: "running", attempts: 0, rate: 0, expected, startedAt, workers: n });
    const list: Worker[] = [];
    for (let i = 0; i < n; i++) {
      let w: Worker;
      try {
        w = new Worker(new URL("../../workers/vanity.worker.ts", import.meta.url), { type: "module" });
      } catch (e) {
        setState({ status: "error", message: e instanceof Error ? e.message : "Web workers unavailable" });
        return;
      }
      w.onmessage = (e: MessageEvent<WorkerMsg>) => {
        const m = e.data;
        if (m.type === "progress") {
          stats.current.attempts[i] = m.attempts;
          stats.current.rate[i] = m.rate;
          const attempts = stats.current.attempts.reduce((a, b) => a + b, 0);
          const rate = stats.current.rate.reduce((a, b) => a + b, 0);
          setState((s) => (s.status === "running" ? { ...s, attempts, rate } : s));
        } else if (m.type === "found") {
          list.forEach((x) => x.terminate());
          workers.current = [];
          stats.current.attempts[i] = m.attempts;
          const attempts = stats.current.attempts.reduce((a, b) => a + b, 0);
          setState({
            status: "found",
            result: { publicKey: m.publicKey, secretKey: Uint8Array.from(m.secretKey), attempts },
            ms: Date.now() - startedAt,
          });
        } else if (m.type === "exhausted") {
          stats.current.attempts[i] = m.attempts;
          const done = stats.current.attempts.reduce((a, b) => a + b, 0);
          if (done >= MAX_ATTEMPTS * 0.99) {
            list.forEach((x) => x.terminate());
            workers.current = [];
            setState({ status: "exhausted", attempts: done });
          }
        } else if (m.type === "error") {
          list.forEach((x) => x.terminate());
          workers.current = [];
          setState({ status: "error", message: m.message });
        }
      };
      w.onerror = () => {
        list.forEach((x) => x.terminate());
        workers.current = [];
        setState({ status: "error", message: "Vanity worker crashed" });
      };
      w.postMessage({ type: "start", suffix, prefix, caseSensitive, maxAttempts: Math.ceil(MAX_ATTEMPTS / n) });
      list.push(w);
    }
    workers.current = list;
  }, []);

  const reset = useCallback(() => {
    workers.current.forEach((w) => w.terminate());
    workers.current = [];
    setState({ status: "idle" });
  }, []);

  return { state, start, stop, reset };
}

/**
 * Adds the vanity mint's signature to the create transaction(s) that require it. Other txs pass through.
 * Throws if a tx claims to need the mint but doesn't list it as a signer.
 */
export function addMintSignature(txs: PreparedTx[], mint: VanityResult): PreparedTx[] {
  const kp = Keypair.fromSecretKey(mint.secretKey);
  return txs.map((t) => {
    if (t.kind !== "svm" || !t.signers.includes(mint.publicKey)) return t;
    const tx = VersionedTransaction.deserialize(Buffer.from(t.base64, "base64"));
    const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    if (!required.some((k) => k.equals(kp.publicKey))) throw new Error("Vanity mint is not a signer of this transaction");
    tx.sign([kp]);
    return {
      ...t,
      base64: Buffer.from(tx.serialize()).toString("base64"),
      signers: t.signers.filter((s) => s !== mint.publicKey),
      partiallySigned: true,
    };
  });
}
