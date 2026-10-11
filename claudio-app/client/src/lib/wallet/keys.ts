// Key generation, import parsing and address derivation for EVM + Solana.
// Secrets are only ever returned to the keystore; nothing here logs or transmits them.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { ChainKind } from "@shared/chains";
import { wipe } from "./codec";

export interface ParsedSecret {
  /** Canonical secret: EVM = 0x-prefixed lowercase hex; SVM = base58 of the 64-byte secret key. */
  secret: string;
  address: string;
}

export function generateSecret(kind: ChainKind): ParsedSecret {
  if (kind === "evm") {
    const pk = generatePrivateKey();
    return { secret: pk, address: privateKeyToAccount(pk).address };
  }
  const kp = Keypair.generate();
  const sk = kp.secretKey; // copy
  try {
    return { secret: bs58.encode(sk), address: kp.publicKey.toBase58() };
  } finally {
    wipe(sk);
  }
}

/** Derives the public address from a canonical secret (used to verify the vault on unlock). */
export function addressOf(kind: ChainKind, secret: string): string {
  if (kind === "evm") return privateKeyToAccount(secret as `0x${string}`).address;
  const bytes = bs58.decode(secret);
  try {
    return Keypair.fromSecretKey(bytes).publicKey.toBase58();
  } finally {
    wipe(bytes);
  }
}

function looksLikeMnemonic(s: string): boolean {
  const words = s.trim().split(/\s+/);
  return words.length >= 12 && words.every((w) => /^[a-z]+$/i.test(w));
}

/** Parses user input into a canonical secret. Throws a readable Error on anything invalid. */
export function parseImport(kind: ChainKind, input: string): ParsedSecret {
  const raw = input.trim();
  if (!raw) throw new Error("Paste a private key");
  if (looksLikeMnemonic(raw)) throw new Error("Seed phrases aren't supported — export the private key from your wallet instead");

  if (kind === "evm") {
    const hex = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("EVM private key must be 64 hex characters (with or without 0x)");
    const pk = `0x${hex.toLowerCase()}` as `0x${string}`;
    let address: string;
    try {
      address = privateKeyToAccount(pk).address;
    } catch {
      throw new Error("That isn't a valid secp256k1 private key");
    }
    return { secret: pk, address };
  }

  // Solana: JSON byte array (solana-keygen file) or base58 (Phantom export).
  let bytes: Uint8Array;
  if (raw.startsWith("[")) {
    let arr: unknown;
    try {
      arr = JSON.parse(raw);
    } catch {
      throw new Error("Couldn't parse the byte array");
    }
    if (!Array.isArray(arr) || !arr.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new Error("Byte array must contain integers 0–255");
    }
    bytes = Uint8Array.from(arr as number[]);
  } else {
    try {
      bytes = bs58.decode(raw);
    } catch {
      throw new Error("Solana key must be base58 or a JSON byte array");
    }
  }

  try {
    let kp: Keypair;
    if (bytes.length === 64) kp = Keypair.fromSecretKey(bytes);
    else if (bytes.length === 32) kp = Keypair.fromSeed(bytes);
    else throw new Error(`Solana secret key must be 64 bytes (got ${bytes.length})`);
    const sk = kp.secretKey;
    try {
      return { secret: bs58.encode(sk), address: kp.publicKey.toBase58() };
    } finally {
      wipe(sk);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Solana secret")) throw e;
    throw new Error("That isn't a valid Solana secret key");
  } finally {
    wipe(bytes);
  }
}

// ─── Address validation (public, no secrets) ───────────────────────

export function isEvmAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

export function isSolAddress(a: string): boolean {
  const s = a.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return new PublicKey(s).toBytes().length === 32;
  } catch {
    return false;
  }
}

export function kindOfAddress(a: string): ChainKind | undefined {
  if (isEvmAddress(a)) return "evm";
  if (isSolAddress(a)) return "svm";
  return undefined;
}

/** Normalises for comparisons (EVM is case-insensitive, Solana base58 is not). */
export function normAddr(a: string): string {
  const s = a.trim();
  return s.startsWith("0x") ? s.toLowerCase() : s;
}
