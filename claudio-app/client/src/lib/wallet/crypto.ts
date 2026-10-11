// Vault encryption: PBKDF2-SHA256 (600k iterations) → AES-GCM-256, all via WebCrypto.
// The derived key is created NON-EXTRACTABLE, so even while unlocked its raw bytes are not reachable from JS.

import { b64ToBytes, bytesToB64, randomBytes } from "./codec";

export const KDF_ITERATIONS = 600_000;
export const MIN_PASSCODE = 8;
/** Additional authenticated data binds ciphertexts to this vault format. */
const AAD = new TextEncoder().encode("claudio.vault.v1");

export interface VaultKdf {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string; // base64
}

export interface VaultFile {
  v: 1;
  kdf: VaultKdf;
  iv: string; // base64, 12 bytes
  ct: string; // base64 AES-GCM ciphertext (+tag)
}

export function hasWebCrypto(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.getRandomValues === "function";
}

export function newKdf(): VaultKdf {
  return { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: bytesToB64(randomBytes(16)) };
}

export async function deriveVaultKey(passcode: string, kdf: VaultKdf): Promise<CryptoKey> {
  if (!hasWebCrypto()) throw new Error("This browser has no WebCrypto (needs HTTPS or localhost).");
  const pass = new TextEncoder().encode(passcode.normalize("NFKC"));
  try {
    const base = await crypto.subtle.importKey("raw", pass as BufferSource, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64ToBytes(kdf.salt) as BufferSource, iterations: kdf.iterations, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false, // non-extractable
      ["encrypt", "decrypt"],
    );
  } finally {
    pass.fill(0);
  }
}

export async function encryptJson(key: CryptoKey, kdf: VaultKdf, payload: unknown): Promise<VaultFile> {
  const iv = randomBytes(12); // fresh IV for every write
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  try {
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD as BufferSource }, key, pt as BufferSource);
    return { v: 1, kdf, iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
  } finally {
    pt.fill(0);
  }
}

/** Throws on wrong key / tampered ciphertext (GCM tag check). */
export async function decryptJson<T>(key: CryptoKey, file: VaultFile): Promise<T> {
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(file.iv) as BufferSource, additionalData: AAD as BufferSource },
      key,
      b64ToBytes(file.ct) as BufferSource,
    ),
  );
  try {
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } finally {
    pt.fill(0);
  }
}

export function isVaultFile(x: unknown): x is VaultFile {
  if (!x || typeof x !== "object") return false;
  const f = x as Partial<VaultFile>;
  return (
    f.v === 1 &&
    !!f.kdf &&
    f.kdf.name === "PBKDF2" &&
    typeof f.kdf.iterations === "number" &&
    typeof f.kdf.salt === "string" &&
    typeof f.iv === "string" &&
    typeof f.ct === "string"
  );
}

// ─── Passcode strength ──────────────────────────────────────────────

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  hint?: string;
}

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "admin", "iloveyou", "monkey", "dragon", "abc123", "111111", "000000", "passw0rd", "solana", "ethereum", "bitcoin", "crypto", "moon"];

export function passcodeStrength(p: string): Strength {
  if (p.length < MIN_PASSCODE) return { score: 0, label: "Too short", hint: `At least ${MIN_PASSCODE} characters` };
  const lower = p.toLowerCase();
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  const unique = new Set(p).size;
  // Rough entropy estimate, penalised for repetition and common words.
  let bits = Math.log2(Math.max(pool, 2)) * Math.min(p.length, Math.ceil(unique * 1.5));
  if (COMMON.some((w) => lower.includes(w))) bits -= 28;
  if (/(.)\1{2,}/.test(p)) bits -= 10;
  if (/(012|123|234|345|456|567|678|789|abc|bcd|qwe|asd|zxc)/.test(lower)) bits -= 8;
  if (bits < 36) return { score: 1, label: "Weak", hint: "Add length, numbers and symbols" };
  if (bits < 52) return { score: 2, label: "Fair", hint: "Longer is stronger — try a phrase" };
  if (bits < 70) return { score: 3, label: "Good" };
  return { score: 4, label: "Strong" };
}
