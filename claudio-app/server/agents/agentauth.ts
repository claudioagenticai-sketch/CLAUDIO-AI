// Agent-key auth for /api/v1 (external agents).
//
//   Authorization: Bearer ck_live_…        (only its SHA-256 is stored; shown once at creation)
//   X-Claudio-Timestamp: <unix ms>         (±5 min)
//   X-Claudio-Nonce: <16–128 of [A-Za-z0-9_-]>   (single use per agent; replay → 401 + strike)
//   X-Claudio-Signature: base58 (or base64) ed25519 signature by the key's registered device public key over
//       METHOD \n PATH \n TIMESTAMP \n NONCE \n SHA256_HEX(raw body)
//     PATH is the request path as sent, including the query string (e.g. /api/v1/rooms/general/messages?limit=20).
//     An empty body hashes as SHA256("") = e3b0c442…b855.
//
// Order matters: the signature is verified BEFORE the nonce is recorded, so someone without the device key can't
// burn nonces. Failures feed the sensors (signature failures, replays, unknown/revoked keys).
import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import bs58 from "bs58";
import { hit, verifySolanaSignature } from "../auth";
import { crossed, sensor } from "./security";
import { q, q1, rowToAgent, type AgentRecord } from "./store";

export const KEY_PREFIX = "ck_live_";
export const SIGNATURE_WINDOW_MS = 5 * 60_000;

export function makeAgentKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `${KEY_PREFIX}${bs58.encode(randomBytes(32))}`;
  return { plaintext, prefix: plaintext.slice(0, 14), hash: hashKey(plaintext) };
}

export function hashKey(k: string): string {
  return createHash("sha256").update(k).digest("hex");
}

export const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function canonicalString(method: string, path: string, ts: string, nonce: string, body: Buffer | string): string {
  return [method.toUpperCase(), path, ts, nonce, sha256Hex(body)].join("\n");
}

export function decodeSig(s: string): Uint8Array | null {
  if (!s || s.length > 200) return null;
  try {
    const b = bs58.decode(s);
    if (b.length === 64) return b;
  } catch {
    /* not base58 */
  }
  try {
    const b = Buffer.from(s, "base64");
    if (b.length === 64) return b;
  } catch {
    /* not base64 */
  }
  return null;
}

export function validDevicePubkey(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

const deny = (res: Response, status: number, error: string, message: string) => res.status(status).json({ error, message });

export interface AgentLocals {
  agent: AgentRecord;
  keyId: string;
}

export function agentOf(res: Response): AgentRecord {
  return (res.locals as AgentLocals).agent;
}

export async function requireAgentKey(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? null;
  try {
    if (!hit(`v1ip:${ip}`, 120, 60_000)) return deny(res, 429, "rate_limited", "Too many requests from this address");
    const auth = req.get("authorization") ?? "";
    const key = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
    if (!key.startsWith(KEY_PREFIX) || key.length < 40 || key.length > 80) return deny(res, 401, "invalid_key", "Missing or malformed Authorization: Bearer ck_live_… key");
    const row = await q1(
      `SELECT k.id AS key_id, k.device_pubkey, k.revoked_at, a.* FROM agent_keys k JOIN agents a ON a.id = k.agent_id WHERE k.key_hash = $1`,
      [hashKey(key)],
    );
    if (!row) {
      if (crossed(`unknown_key:${ip}`, 10, 10 * 60_000)) await sensor({ kind: "unknown_key", severity: "high", ip, detail: { prefix: key.slice(0, 14) } });
      return deny(res, 401, "invalid_key", "Unknown API key");
    }
    const agent = rowToAgent(row);
    const base = { agentId: agent.id, ownerWallet: agent.ownerWallet, ip };
    if (row.revoked_at) {
      if (crossed(`revoked:${row.key_id}`, 3, 3600_000)) await sensor({ ...base, kind: "revoked_key_use", severity: "warn", detail: { keyId: row.key_id } });
      return deny(res, 401, "key_revoked", "This API key was revoked");
    }
    if (agent.status === "banned") {
      if (crossed(`banned:${agent.id}`, 5, 3600_000)) await sensor({ ...base, kind: "banned_agent_request", severity: "warn" });
      return deny(res, 403, "agent_banned", "This agent is banned");
    }

    const ts = String(req.get("x-claudio-timestamp") ?? "");
    const nonce = String(req.get("x-claudio-nonce") ?? "");
    const sigRaw = String(req.get("x-claudio-signature") ?? "");
    if (!ts || !nonce || !sigRaw) return deny(res, 401, "signature_required", "X-Claudio-Timestamp, X-Claudio-Nonce and X-Claudio-Signature are required");
    if (!/^\d{12,14}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > SIGNATURE_WINDOW_MS) {
      if (crossed(`stale:${agent.id}`, 5, 10 * 60_000)) await sensor({ ...base, kind: "stale_timestamp", severity: "warn", detail: { ts } });
      return deny(res, 401, "stale_timestamp", "Timestamp (unix ms) must be within 5 minutes of server time");
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return deny(res, 401, "bad_nonce", "Nonce must be 16–128 characters of [A-Za-z0-9_-]");
    const sig = decodeSig(sigRaw);
    const body: Buffer = (req as any).rawBody ?? (req.body && Object.keys(req.body).length ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0));
    const canonical = canonicalString(req.method, req.originalUrl, ts, nonce, body);
    if (!sig || !verifySolanaSignature(row.device_pubkey, canonical, sig)) {
      const many = crossed(`sigfail:${row.key_id}`, 5, 10 * 60_000);
      await sensor({ ...base, kind: "signature_failure", severity: many ? "high" : "info", strike: many ? 1 : 0, detail: { keyId: row.key_id, path: req.path } });
      return deny(res, 401, "bad_signature", "Signature does not verify for this key's device public key");
    }
    const fresh = await q(`INSERT INTO agent_nonces (agent_id, nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce`, [agent.id, nonce]);
    if (!fresh.length) {
      await sensor({ ...base, kind: "nonce_replay", severity: "high", strike: 1, detail: { keyId: row.key_id, path: req.path } });
      return deny(res, 401, "replayed_nonce", "Nonce already used");
    }
    if (!hit(`v1key:${row.key_id}`, 60, 60_000)) return deny(res, 429, "rate_limited", "Too many requests for this key (60/min)");
    void q(`UPDATE agent_keys SET last_used_at = now() WHERE id = $1`, [row.key_id]).catch(() => {});
    if (!agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() > 30_000) {
      void q(`UPDATE agents SET last_seen_at = now() WHERE id = $1`, [agent.id]).catch(() => {});
    }
    (res.locals as AgentLocals).agent = agent;
    (res.locals as AgentLocals).keyId = row.key_id;
    next();
  } catch (e) {
    const err = e as { status?: number; code?: string; message: string };
    res.status(err.status ?? 500).json({ error: err.code ?? "internal", message: err.message });
  }
}
