// Who may use /relay/media (upload + early delete). GET of a file is public: its id is the secret.
//
// Two kinds of credential, tried in this order by verifyRelayToken():
//
//   1. Extra verifiers registered with addRelayTokenVerifier() — the hook for bearer-only tokens, e.g. the online
//      MCP's OAuth access tokens (`claudio login`). A verifier returns null for "not mine" so the next one is tried.
//   2. A Claudio agent key (`Authorization: Bearer ck_live_…`) with the same request signature as /api/v1
//      (see server/agents/agentauth.ts):
//        X-Claudio-Timestamp  unix ms (±5 min)
//        X-Claudio-Nonce      16–128 of [A-Za-z0-9_-], single use
//        X-Claudio-Signature  ed25519 by the key's device key over
//                             METHOD \n PATH(+query, as sent) \n TIMESTAMP \n NONCE \n SHA256_HEX(raw body)
//      Uploads are streamed, so the headers and key are checked BEFORE the body is read, and the signature over the
//      body hash is checked AFTER (finish()). A bad signature deletes the upload. The nonce is recorded only once the
//      signature verifies, exactly like /api/v1.
import type { Request } from "express";
import { verifySolanaSignature } from "../auth";
import { KEY_PREFIX, SIGNATURE_WINDOW_MS, canonicalString, decodeSig, hashKey } from "../agents/agentauth";
import { crossed, sensor } from "../agents/security";
import { q, q1, rowToAgent } from "../agents/store";

export interface RelayPrincipal {
  /** Stable id used for rate limits and "same token" checks on DELETE (never the raw token). */
  id: string;
  kind: "agent_key" | "oauth" | (string & {});
  /** Short human label for logs/audit (never a secret). */
  label?: string;
}

export interface RelayDenied {
  ok: false;
  status: number;
  error: string;
  message: string;
}

export interface RelayAllowed {
  ok: true;
  principal: RelayPrincipal;
  /**
   * Present when the credential also signs the body (agent keys). Call with SHA-256 hex of the exact raw body
   * once it has been read; resolves to null when the signature is good, or a denial.
   */
  finish?: (bodySha256Hex: string) => Promise<RelayDenied | null>;
}

export type RelayCheck = RelayAllowed | RelayDenied;

/** A pluggable verifier: return null when the token isn't its kind, so the next verifier runs. */
export type RelayTokenVerifier = (token: string, req: Request) => Promise<RelayCheck | null> | RelayCheck | null;

const verifiers: RelayTokenVerifier[] = [];

/**
 * Integration hook: register another bearer-token kind (e.g. the MCP OAuth access tokens, stored as SHA-256 hashes).
 *
 *   addRelayTokenVerifier(async (token) => {
 *     const row = await findAccessToken(sha256(token));          // your table
 *     if (!row) return null;                                     // not an OAuth token → fall through
 *     if (row.expired) return { ok: false, status: 401, error: "token_expired", message: "Log in again" };
 *     return { ok: true, principal: { id: `oauth:${row.id}`, kind: "oauth", label: row.wallet } };
 *   });
 */
export function addRelayTokenVerifier(v: RelayTokenVerifier): void {
  verifiers.push(v);
}

const deny = (status: number, error: string, message: string): RelayDenied => ({ ok: false, status, error, message });

export function bearerOf(req: Request): string {
  const auth = req.get("authorization") ?? "";
  return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
}

/** Checks the request's credential. For agent keys this does everything except the body-hash signature (finish()). */
export async function verifyRelayToken(req: Request): Promise<RelayCheck> {
  const token = bearerOf(req);
  if (!token) return deny(401, "unauthorized", "Send Authorization: Bearer <Claudio token>");
  if (token.length > 512) return deny(401, "invalid_token", "Token is too long");

  for (const v of verifiers) {
    const r = await v(token, req);
    if (r) return r;
  }
  if (token.startsWith(KEY_PREFIX)) return checkAgentKey(token, req);
  return deny(401, "invalid_token", "Unknown token. Use a Claudio agent key (signed) or a Claudio login token.");
}

async function checkAgentKey(key: string, req: Request): Promise<RelayCheck> {
  const ip = req.ip ?? null;
  if (key.length < 40 || key.length > 80) return deny(401, "invalid_key", "Malformed ck_live_… key");
  const row = await q1(
    `SELECT k.id AS key_id, k.device_pubkey, k.revoked_at, a.* FROM agent_keys k JOIN agents a ON a.id = k.agent_id WHERE k.key_hash = $1`,
    [hashKey(key)],
  );
  if (!row) {
    if (crossed(`unknown_key:${ip}`, 10, 10 * 60_000)) await sensor({ kind: "unknown_key", severity: "high", ip, detail: { prefix: key.slice(0, 14), via: "relay" } });
    return deny(401, "invalid_key", "Unknown API key");
  }
  if (row.revoked_at) return deny(401, "key_revoked", "This API key was revoked");
  const agent = rowToAgent(row);
  if (agent.status === "banned") return deny(403, "agent_banned", "This agent is banned");

  const ts = String(req.get("x-claudio-timestamp") ?? "");
  const nonce = String(req.get("x-claudio-nonce") ?? "");
  const sigRaw = String(req.get("x-claudio-signature") ?? "");
  if (!ts || !nonce || !sigRaw) return deny(401, "signature_required", "X-Claudio-Timestamp, X-Claudio-Nonce and X-Claudio-Signature are required");
  if (!/^\d{12,14}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > SIGNATURE_WINDOW_MS) {
    return deny(401, "stale_timestamp", "Timestamp (unix ms) must be within 5 minutes of server time");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return deny(401, "bad_nonce", "Nonce must be 16–128 characters of [A-Za-z0-9_-]");
  const sig = decodeSig(sigRaw);
  if (!sig) return deny(401, "bad_signature", "Signature must be 64 bytes, base58 or base64");

  const method = req.method;
  const path = req.originalUrl;
  const base = { agentId: agent.id, ownerWallet: agent.ownerWallet, ip };
  return {
    ok: true,
    principal: { id: `key:${row.key_id}`, kind: "agent_key", label: agent.slug },
    finish: async (bodyHash: string) => {
      const canonical = [method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
      if (!verifySolanaSignature(row.device_pubkey, canonical, sig)) {
        const many = crossed(`sigfail:${row.key_id}`, 5, 10 * 60_000);
        await sensor({ ...base, kind: "signature_failure", severity: many ? "high" : "info", strike: many ? 1 : 0, detail: { keyId: row.key_id, path: req.path, via: "relay" } });
        return deny(401, "bad_signature", "Signature does not verify for this key's device public key");
      }
      const fresh = await q(`INSERT INTO agent_nonces (agent_id, nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce`, [agent.id, nonce]);
      if (!fresh.length) {
        await sensor({ ...base, kind: "nonce_replay", severity: "high", strike: 1, detail: { keyId: row.key_id, path: req.path, via: "relay" } });
        return deny(401, "replayed_nonce", "Nonce already used");
      }
      void q(`UPDATE agent_keys SET last_used_at = now() WHERE id = $1`, [row.key_id]).catch(() => {});
      return null;
    },
  };
}

/** Same canonical string as /api/v1, exported for docs/tests that build signatures. */
export { canonicalString };
