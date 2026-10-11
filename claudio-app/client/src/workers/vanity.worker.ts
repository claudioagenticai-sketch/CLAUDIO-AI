// (No `/// <reference lib="webworker" />`: it would clash with the DOM lib in the shared tsconfig program.)
// Vanity Solana address grinder. Generates ed25519 keypairs until the base58 public key ends (and/or starts) with
// the requested pattern. Runs entirely in the browser; the found secret key is posted back to the page only.
//
// Protocol:
//   in : { type: "start", suffix, prefix, caseSensitive, maxAttempts } | { type: "stop" }
//   out: { type: "progress", attempts, rate } (~4×/s) | { type: "found", publicKey, secretKey, attempts }
//        | { type: "exhausted", attempts } | { type: "error", message }
import { Buffer } from "buffer";
import { Keypair } from "@solana/web3.js";

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

interface StartMsg {
  type: "start";
  suffix: string;
  prefix: string;
  caseSensitive: boolean;
  maxAttempts: number;
}
type InMsg = StartMsg | { type: "stop" };

const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
};

let running = false;

function grind(m: StartMsg) {
  running = true;
  const suffix = m.caseSensitive ? m.suffix : m.suffix.toLowerCase();
  const prefix = m.caseSensitive ? m.prefix : m.prefix.toLowerCase();
  let attempts = 0;
  let windowStart = performance.now();
  let windowAttempts = 0;

  const batch = () => {
    if (!running) return;
    const deadline = performance.now() + 40;
    while (performance.now() < deadline) {
      for (let i = 0; i < 64; i++) {
        const kp = Keypair.generate();
        const pk = kp.publicKey.toBase58();
        const cmp = m.caseSensitive ? pk : pk.toLowerCase();
        attempts++;
        windowAttempts++;
        if ((!suffix || cmp.endsWith(suffix)) && (!prefix || cmp.startsWith(prefix))) {
          running = false;
          ctx.postMessage({ type: "found", publicKey: pk, secretKey: Array.from(kp.secretKey), attempts });
          return;
        }
      }
      if (attempts >= m.maxAttempts) {
        running = false;
        ctx.postMessage({ type: "exhausted", attempts });
        return;
      }
    }
    const now = performance.now();
    if (now - windowStart >= 250) {
      ctx.postMessage({ type: "progress", attempts, rate: (windowAttempts * 1000) / (now - windowStart) });
      windowStart = now;
      windowAttempts = 0;
    }
    // Yield so "stop" messages are processed.
    setTimeout(batch, 0);
  };
  batch();
}

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "stop") running = false;
    else if (msg.type === "start" && !running) grind(msg);
  } catch (err) {
    ctx.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
