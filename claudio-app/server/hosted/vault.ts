// Escrow wallet vault: generates hosted agents' Solana keypairs server-side and stores them envelope-encrypted.
//
//   master key  VAULT_MASTER_KEY (Replit Secret; ≥ 32 random bytes as hex or base64 — passphrases are refused)
//   KEK         HKDF-SHA256(master, salt "claudio/vault/v1", info "claudio/vault/kek") — 32 bytes, never stored
//   key_version "k1:" + HMAC-SHA256(KEK, "claudio/vault/kid")[0..8] hex — identifies which master wrapped a row
//   data key    32 fresh random bytes per wallet
//   enc_key     AES-256-GCM(data key, ed25519 seed), AAD "claudio:escrow:v1|<agentId>|<address>"
//   wrapped_dek AES-256-GCM(KEK, data key) as "iv.tag.ct", AAD "claudio:dek:v1|<agentId>|<address>|<key_version>"
//
// A database dump alone reveals nothing; a stolen row can't be replayed onto another agent/address (AAD); a
// tampered byte fails the GCM tag. Rotation: set VAULT_MASTER_KEY to the new key and VAULT_MASTER_KEY_PREVIOUS to
// the old one, then run the admin re-wrap (POST /api/admin/hosted/rewrap): only the data keys are re-wrapped — the
// seeds are never decrypted for that.
//
// Decryption of a seed is a one-shot capability: claimOpener() hands the opener to the FIRST caller only, which is
// server/hosted/signer.ts at import time. Any later claim throws, so no other module can obtain it. Nothing here
// logs or returns secret material, and there is no export endpoint.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto";
import { Keypair } from "@solana/web3.js";
import type { VaultState } from "@shared/agents";
import { pool } from "../db";
import { audit } from "../auth/audit";
import { agentById, escrowEligible } from "./agentsRepo";

interface Keyring {
  kek: Buffer;
  version: string;
}

export interface SealedWallet {
  address: string;
  encKey: string;
  iv: string;
  tag: string;
  wrappedDek: string;
  keyVersion: string;
}

// ─── master key parsing ──────────────────────────────────────────────

type Parsed = { ok: true; key: Buffer } | { ok: false; state: "missing_key" | "weak_key" };

/** Accepts hex (64+ chars) or base64/base64url decoding to ≥ 32 bytes with enough distinct byte values. */
export function parseMasterKey(raw: string | undefined): Parsed {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, state: "missing_key" };
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) key = Buffer.from(s, "hex");
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) key = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!key || key.length < 32) return { ok: false, state: "weak_key" };
  if (new Set(key).size < 16) return { ok: false, state: "weak_key" }; // "0000…", "abab…", low-entropy patterns
  return { ok: true, key };
}

function deriveKeyring(master: Buffer): Keyring {
  const kek = Buffer.from(hkdfSync("sha256", master, Buffer.from("claudio/vault/v1"), Buffer.from("claudio/vault/kek"), 32));
  const version = "k1:" + createHmac("sha256", kek).update("claudio/vault/kid").digest("hex").slice(0, 16);
  return { kek, version };
}

let cache: { raw: string; prevRaw: string; cur: Keyring | null; prev: Keyring | null; state: VaultState } | null = null;

function keyrings(): { cur: Keyring | null; prev: Keyring | null; state: VaultState } {
  const raw = process.env.VAULT_MASTER_KEY ?? "";
  const prevRaw = process.env.VAULT_MASTER_KEY_PREVIOUS ?? "";
  if (cache && cache.raw === raw && cache.prevRaw === prevRaw) return cache;
  const p = parseMasterKey(raw);
  const pp = parseMasterKey(prevRaw);
  const cur = p.ok ? deriveKeyring(p.key) : null;
  const prev = pp.ok ? deriveKeyring(pp.key) : null;
  if (p.ok) p.key.fill(0);
  if (pp.ok) pp.key.fill(0);
  const state: VaultState = p.ok ? "ready" : p.state;
  if (!p.ok && raw.trim()) console.warn("[hosted] VAULT_MASTER_KEY is too weak (need ≥ 32 random bytes, hex or base64) — escrow wallets disabled");
  if (prevRaw.trim() && !pp.ok) console.warn("[hosted] VAULT_MASTER_KEY_PREVIOUS is not a valid key — ignored");
  cache = { raw, prevRaw, cur, prev: prev && cur && prev.version === cur.version ? null : prev, state };
  return cache;
}

/** "ready" only with a database and a strong master key. */
export function vaultState(): VaultState {
  const k = keyrings();
  if (k.state !== "ready") return k.state;
  return pool ? "ready" : "no_database";
}

export function vaultReady(): boolean {
  return vaultState() === "ready";
}

export function currentKeyVersion(): string | null {
  return keyrings().cur?.version ?? null;
}

export function previousKeyVersion(): string | null {
  return keyrings().prev?.version ?? null;
}

// ─── AES-256-GCM helpers ─────────────────────────────────────────────

function seal(key: Buffer, plain: Buffer, aad: string): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}

function unseal(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: string): Buffer {
  if (iv.length !== 12 || tag.length !== 16) throw new Error("vault: malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

const seedAad = (agentId: string, address: string) => `claudio:escrow:v1|${agentId}|${address}`;
const dekAad = (agentId: string, address: string, version: string) => `claudio:dek:v1|${agentId}|${address}|${version}`;

function wrapDek(ring: Keyring, dek: Buffer, agentId: string, address: string): string {
  const w = seal(ring.kek, dek, dekAad(agentId, address, ring.version));
  return [w.iv, w.tag, w.ct].map((b) => b.toString("base64")).join(".");
}

function unwrapDek(rec: Pick<SealedWallet, "wrappedDek" | "keyVersion">, agentId: string, address: string): Buffer {
  const { cur, prev } = keyrings();
  const ring = [cur, prev].find((r) => r && r.version === rec.keyVersion);
  if (!ring) throw new Error("vault: no master key for this key_version");
  const parts = rec.wrappedDek.split(".");
  if (parts.length !== 3) throw new Error("vault: malformed wrapped key");
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64"));
  return unseal(ring.kek, iv, tag, ct, dekAad(agentId, address, ring.version));
}

/** Generates a fresh keypair for `agentId` and returns only the sealed record (the seed is wiped). */
export function sealNewWallet(agentId: string): SealedWallet {
  const { cur } = keyrings();
  if (!cur) throw new Error("vault: VAULT_MASTER_KEY missing or weak");
  const kp = Keypair.generate();
  const address = kp.publicKey.toBase58();
  const seed = Buffer.from(kp.secretKey.subarray(0, 32));
  const dek = randomBytes(32);
  try {
    const s = seal(dek, seed, seedAad(agentId, address));
    return {
      address,
      encKey: s.ct.toString("base64"),
      iv: s.iv.toString("base64"),
      tag: s.tag.toString("base64"),
      wrappedDek: wrapDek(cur, dek, agentId, address),
      keyVersion: cur.version,
    };
  } finally {
    seed.fill(0);
    dek.fill(0);
    kp.secretKey.fill(0);
  }
}

/** Re-wraps a record's data key under the current master key (the seed itself is never decrypted). */
export function rewrapSealed(rec: SealedWallet, agentId: string): SealedWallet {
  const { cur } = keyrings();
  if (!cur) throw new Error("vault: VAULT_MASTER_KEY missing or weak");
  if (rec.keyVersion === cur.version) return rec;
  const dek = unwrapDek(rec, agentId, rec.address);
  try {
    return { ...rec, wrappedDek: wrapDek(cur, dek, agentId, rec.address), keyVersion: cur.version };
  } finally {
    dek.fill(0);
  }
}

// ─── one-shot opener capability (claimed by signer.ts) ───────────────

export type SeedOpener = (agentId: string, rec: SealedWallet) => Buffer;
let claimed = false;

/** Returns the seed decryptor exactly once per process. The caller owns the returned buffer and must wipe it. */
export function claimOpener(): SeedOpener {
  if (claimed) {
    audit({ action: "hosted.vault_claim_refused", severity: "critical", detail: { stack: (new Error().stack ?? "").split("\n").slice(2, 5).join(" | ") } });
    throw new Error("vault: opener already claimed");
  }
  claimed = true;
  return (agentId, rec) => {
    const dek = unwrapDek(rec, agentId, rec.address);
    try {
      return unseal(dek, Buffer.from(rec.iv, "base64"), Buffer.from(rec.tag, "base64"), Buffer.from(rec.encKey, "base64"), seedAad(agentId, rec.address));
    } finally {
      dek.fill(0);
    }
  };
}

// ─── database ────────────────────────────────────────────────────────

function rowToSealed(r: any): SealedWallet {
  return { address: r.address, encKey: r.enc_key, iv: r.iv, tag: r.tag, wrappedDek: r.wrapped_dek, keyVersion: r.key_version };
}

/** Sealed record for the signer (never leaves server/hosted). */
export async function loadSealed(agentId: string): Promise<SealedWallet | null> {
  if (!pool) return null;
  const r = await pool.query(`SELECT address, enc_key, iv, tag, wrapped_dek, key_version FROM agent_wallets WHERE agent_id = $1`, [agentId]);
  return r.rows[0] ? rowToSealed(r.rows[0]) : null;
}

export async function escrowAddressOf(agentId: string): Promise<string | null> {
  if (!pool) return null;
  try {
    const r = await pool.query(`SELECT address FROM agent_wallets WHERE agent_id = $1`, [agentId]);
    return r.rows[0]?.address ?? null;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<string | null>>();

/**
 * Idempotent: returns the agent's escrow address, creating the wallet on first use. Null when the vault is not
 * ready, the agent doesn't exist, or it isn't eligible (hosted, or resident "claudio"). Safe under concurrency:
 * same-process callers share one promise; cross-process races resolve through the agent_id primary key.
 */
export function ensureEscrow(agentId: string): Promise<string | null> {
  const hit = inflight.get(agentId);
  if (hit) return hit;
  const p = createOrGet(agentId).finally(() => inflight.delete(agentId));
  inflight.set(agentId, p);
  return p;
}

async function createOrGet(agentId: string): Promise<string | null> {
  if (!vaultReady() || !pool) return null;
  try {
    const existing = await escrowAddressOf(agentId);
    if (existing) return existing;
    const agent = await agentById(agentId);
    if (!escrowEligible(agent)) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = sealNewWallet(agentId);
      try {
        const r = await pool.query(
          `INSERT INTO agent_wallets (agent_id, address, enc_key, iv, tag, wrapped_dek, key_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (agent_id) DO NOTHING RETURNING address`,
          [agentId, s.address, s.encKey, s.iv, s.tag, s.wrappedDek, s.keyVersion],
        );
        if (r.rows[0]) {
          audit({ actor: "system", action: "hosted.escrow_created", target: agentId, detail: { address: s.address, keyVersion: s.keyVersion } });
          return s.address as string;
        }
        return await escrowAddressOf(agentId); // another caller won the race
      } catch (e) {
        // 23505 on `address` (astronomically unlikely) → one more fresh keypair.
        if ((e as { code?: string }).code !== "23505" || attempt === 1) throw e;
      }
    }
    return null;
  } catch (e) {
    console.error("[hosted] escrow creation failed:", (e as Error).message);
    return null;
  }
}

/** Re-wraps every row still on the previous master key. Returns counts; never touches seeds. */
export async function rewrapAll(actor: string): Promise<{ rewrapped: number; failed: number; remaining: number; current: string | null }> {
  const current = currentKeyVersion();
  if (!pool || !current) return { rewrapped: 0, failed: 0, remaining: 0, current };
  const rows = (
    await pool.query(`SELECT agent_id, address, enc_key, iv, tag, wrapped_dek, key_version FROM agent_wallets WHERE key_version <> $1`, [current])
  ).rows;
  let rewrapped = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const next = rewrapSealed(rowToSealed(r), r.agent_id);
      const u = await pool.query(
        `UPDATE agent_wallets SET wrapped_dek = $2, key_version = $3, rotated_at = now() WHERE agent_id = $1 AND key_version = $4`,
        [r.agent_id, next.wrappedDek, next.keyVersion, r.key_version],
      );
      rewrapped += u.rowCount ?? 0;
    } catch {
      failed += 1;
    }
  }
  audit({ actor, action: "hosted.vault_rewrap", severity: "high", detail: { rewrapped, failed, current } });
  return { rewrapped, failed, remaining: failed, current };
}
