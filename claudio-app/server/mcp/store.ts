// MCP + OAuth persistence (raw SQL over the shared pool; tables in server/migrations/400_mcp.sql).
// Only SHA-256 hashes of tokens, codes and keys are stored. Everything here needs DATABASE_URL.
import { createHash, randomBytes } from "crypto";
import { pool } from "../db";

export class McpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "McpError";
  }
}

function db() {
  if (!pool) throw new McpError(503, "database_required", "Signing in apps needs the site database (DATABASE_URL).");
  return pool;
}
export const hasDb = () => !!pool;

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query(sql, params)).rows as T[];
}
export async function q1<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const rand = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const SCOPES = ["read", "thread:write", "trade:quote", "trade:prepare", "launch"] as const;
export type Scope = (typeof SCOPES)[number];
export const isScope = (s: string): s is Scope => (SCOPES as readonly string[]).includes(s);

/** Whatever authenticated an MCP request: an OAuth access token or an MCP key. */
export interface Principal {
  kind: "oauth" | "key";
  id: string; // grant id or key id
  wallet: string;
  clientId: string | null;
  clientName: string;
  scopes: Scope[];
  agentId: string | null;
  resource: string | null;
}

// ─── clients ───────────────────────────────────────────────────────

export interface ClientRow {
  client_id: string;
  name: string;
  redirect_uris: string[];
  client_uri: string | null;
  logo_uri: string | null;
  application_type: string;
}

export async function insertClient(c: ClientRow, ip: string | null): Promise<void> {
  await q(
    `INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris, client_uri, logo_uri, application_type, created_ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.client_id, c.name, JSON.stringify(c.redirect_uris), c.client_uri, c.logo_uri, c.application_type, ip],
  );
}

export async function getClient(clientId: string): Promise<ClientRow | undefined> {
  return q1<ClientRow>(`SELECT client_id, name, redirect_uris, client_uri, logo_uri, application_type FROM mcp_oauth_clients WHERE client_id = $1`, [clientId]);
}

// ─── authorization requests + codes ────────────────────────────────

export interface AuthRequest {
  id: string;
  client_id: string;
  client_name: string;
  client_kind: string;
  redirect_uri: string;
  scopes: string[];
  state: string | null;
  code_challenge: string;
  resource: string | null;
  expires_at: Date;
  done_at: Date | null;
}

export async function insertRequest(r: Omit<AuthRequest, "done_at">): Promise<void> {
  await q(
    `INSERT INTO mcp_oauth_requests (id, client_id, client_name, client_kind, redirect_uri, scopes, state, code_challenge, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [r.id, r.client_id, r.client_name, r.client_kind, r.redirect_uri, r.scopes, r.state, r.code_challenge, r.resource, r.expires_at],
  );
  // Housekeeping: old requests, codes, expired tokens and prepared actions.
  if (Math.random() < 0.05) void cleanup().catch(() => {});
}

export async function getRequest(id: string): Promise<AuthRequest | undefined> {
  return q1<AuthRequest>(`SELECT * FROM mcp_oauth_requests WHERE id = $1 AND expires_at > now() AND done_at IS NULL`, [id]);
}

/** Marks the request used; false when someone else already finished it. */
export async function finishRequest(id: string): Promise<boolean> {
  return (await q(`UPDATE mcp_oauth_requests SET done_at = now() WHERE id = $1 AND done_at IS NULL AND expires_at > now() RETURNING id`, [id])).length === 1;
}

export async function insertGrant(g: { id: string; wallet: string; client_id: string; client_name: string; scopes: string[]; agent_id: string | null; resource: string | null }): Promise<void> {
  await q(`INSERT INTO mcp_grants (id, wallet, client_id, client_name, scopes, agent_id, resource) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    g.id, g.wallet, g.client_id, g.client_name, g.scopes, g.agent_id, g.resource,
  ]);
}

export async function insertCode(c: { code_hash: string; grant_id: string; client_id: string; redirect_uri: string; code_challenge: string; resource: string | null; expires_at: Date }): Promise<void> {
  await q(`INSERT INTO mcp_oauth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    c.code_hash, c.grant_id, c.client_id, c.redirect_uri, c.code_challenge, c.resource, c.expires_at,
  ]);
}

/** Single use: returns the code row once (and marks it used). */
export async function takeCode(codeHash: string): Promise<{ grant_id: string; client_id: string; redirect_uri: string; code_challenge: string; resource: string | null; expired: boolean } | undefined> {
  const r = await q1(
    `UPDATE mcp_oauth_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL RETURNING grant_id, client_id, redirect_uri, code_challenge, resource, expires_at`,
    [codeHash],
  );
  if (!r) return undefined;
  return { ...r, expired: new Date(r.expires_at).getTime() < Date.now() };
}

/** A code presented twice: OAuth 2.1 says revoke what it issued. */
export async function codeWasUsed(codeHash: string): Promise<string | undefined> {
  return (await q1<{ grant_id: string }>(`SELECT grant_id FROM mcp_oauth_codes WHERE code_hash = $1 AND used_at IS NOT NULL`, [codeHash]))?.grant_id;
}

export async function getGrant(id: string) {
  return q1<{ id: string; wallet: string; client_id: string; client_name: string; scopes: string[]; agent_id: string | null; resource: string | null; revoked_at: Date | null }>(
    `SELECT id, wallet, client_id, client_name, scopes, agent_id, resource, revoked_at FROM mcp_grants WHERE id = $1`,
    [id],
  );
}

export async function revokeGrant(id: string, wallet?: string): Promise<boolean> {
  const r = await q(`UPDATE mcp_grants SET revoked_at = now() WHERE id = $1 ${wallet ? "AND wallet = $2" : ""} AND revoked_at IS NULL RETURNING id`, wallet ? [id, wallet] : [id]);
  await q(`UPDATE mcp_tokens SET revoked_at = now() WHERE grant_id = $1 AND revoked_at IS NULL`, [id]);
  forgetCache();
  return r.length === 1;
}

// ─── tokens ────────────────────────────────────────────────────────

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86_400;

export interface Issued {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export async function issueTokens(g: { id: string; wallet: string; client_id: string; scopes: string[]; resource: string | null }): Promise<Issued> {
  const access = `cma_${rand()}`;
  const refresh = `cmr_${rand()}`;
  const now = Date.now();
  await q(
    `INSERT INTO mcp_tokens (token_hash, kind, grant_id, wallet, client_id, scopes, resource, expires_at) VALUES
       ($1,'access',$3,$4,$5,$6,$7,$8), ($2,'refresh',$3,$4,$5,$6,$7,$9)`,
    [sha256(access), sha256(refresh), g.id, g.wallet, g.client_id, g.scopes, g.resource, new Date(now + ACCESS_TTL_S * 1000), new Date(now + REFRESH_TTL_S * 1000)],
  );
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S, scope: g.scopes.join(" ") };
}

/** Rotation: the refresh token is spent; presenting a spent one again revokes the whole grant (token theft). */
export async function useRefresh(token: string, clientId: string): Promise<{ grant_id: string; scopes: string[]; resource: string | null } | { error: string }> {
  const h = sha256(token);
  const row = await q1(`SELECT grant_id, client_id, scopes, resource, expires_at, revoked_at, rotated_at FROM mcp_tokens WHERE token_hash = $1 AND kind = 'refresh'`, [h]);
  if (!row) return { error: "invalid_grant" };
  if (row.client_id !== clientId) return { error: "invalid_grant" };
  if (row.rotated_at || row.revoked_at) {
    if (row.rotated_at) await revokeGrant(row.grant_id);
    return { error: "invalid_grant" };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) return { error: "invalid_grant" };
  const spent = await q(`UPDATE mcp_tokens SET rotated_at = now() WHERE token_hash = $1 AND rotated_at IS NULL RETURNING token_hash`, [h]);
  if (!spent.length) return { error: "invalid_grant" };
  return { grant_id: row.grant_id, scopes: row.scopes, resource: row.resource };
}

/** RFC 7009: revoke an access or refresh token (and the grant's other tokens when it's a refresh token). */
export async function revokeToken(token: string): Promise<void> {
  const row = await q1(`UPDATE mcp_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING kind, grant_id`, [sha256(token)]);
  if (row?.kind === "refresh") await q(`UPDATE mcp_tokens SET revoked_at = now() WHERE grant_id = $1 AND revoked_at IS NULL`, [row.grant_id]);
  if (token.startsWith("cmk_")) await q(`UPDATE mcp_keys SET revoked_at = now() WHERE key_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
  forgetCache();
}

const cache = new Map<string, { p: Principal | null; at: number }>();
const forgetCache = () => cache.clear();

/** Bearer → principal (access token or MCP key). Cached 15 s; revocations clear the cache. */
export async function principalFor(bearer: string): Promise<Principal | null> {
  if (!pool) return null;
  const h = sha256(bearer);
  const hit = cache.get(h);
  if (hit && Date.now() - hit.at < 15_000) return hit.p;
  let p: Principal | null = null;
  if (bearer.startsWith("cma_")) {
    const r = await q1(
      `SELECT t.scopes, t.resource, t.wallet, t.client_id, g.id AS grant_id, g.client_name, g.agent_id
         FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id
        WHERE t.token_hash = $1 AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > now() AND g.revoked_at IS NULL`,
      [h],
    );
    if (r) {
      p = { kind: "oauth", id: r.grant_id, wallet: r.wallet, clientId: r.client_id, clientName: r.client_name, scopes: r.scopes.filter(isScope), agentId: r.agent_id, resource: r.resource };
      void q(`UPDATE mcp_grants SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [r.grant_id]).catch(() => {});
    }
  } else if (bearer.startsWith("cmk_")) {
    const r = await q1(`SELECT id, wallet, name, scopes, agent_id FROM mcp_keys WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [h]);
    if (r) {
      p = { kind: "key", id: r.id, wallet: r.wallet, clientId: null, clientName: `MCP key "${r.name}"`, scopes: r.scopes.filter(isScope), agentId: r.agent_id, resource: null };
      void q(`UPDATE mcp_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [r.id]).catch(() => {});
    }
  }
  if (cache.size > 5_000) cache.clear();
  cache.set(h, { p, at: Date.now() });
  return p;
}

// ─── MCP keys ──────────────────────────────────────────────────────

export const MAX_KEYS = 10;

export async function createKey(k: { wallet: string; name: string; scopes: string[]; agent_id: string | null; expires_at: Date | null }) {
  const n = await q1<{ n: string }>(`SELECT count(*)::text AS n FROM mcp_keys WHERE wallet = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [k.wallet]);
  if (Number(n?.n ?? 0) >= MAX_KEYS) throw new McpError(409, "too_many_keys", `You can have ${MAX_KEYS} active MCP keys. Revoke one first.`);
  const key = `cmk_${rand()}`;
  const id = `key_${rand(9)}`;
  const prefix = key.slice(0, 10);
  const row = await q1(
    `INSERT INTO mcp_keys (id, wallet, name, prefix, key_hash, scopes, agent_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at`,
    [id, k.wallet, k.name, prefix, sha256(key), k.scopes, k.agent_id, k.expires_at],
  );
  return { key, id, prefix, name: k.name, scopes: k.scopes, createdAt: new Date(row.created_at).toISOString(), expiresAt: k.expires_at ? k.expires_at.toISOString() : null };
}

export async function revokeKey(id: string, wallet: string): Promise<boolean> {
  const r = await q(`UPDATE mcp_keys SET revoked_at = now() WHERE id = $1 AND wallet = $2 AND revoked_at IS NULL RETURNING id`, [id, wallet]);
  forgetCache();
  return r.length === 1;
}

// ─── prepared actions ──────────────────────────────────────────────

export const PREPARED_TTL_MS = 2 * 60_000;
/** A wallet that started signing inside the 2 minutes may still report its signatures for this long afterwards. */
export const RESULT_GRACE_MS = 3 * 60_000;

/** pending past its expiry reads as expired (the row flips for good once the grace period is over too). */
export function effectiveStatus(p: Pick<PreparedRow, "status" | "expires_at">): PreparedRow["status"] {
  return p.status === "pending" && new Date(p.expires_at).getTime() < Date.now() ? "expired" : p.status;
}

export interface PreparedRow {
  id: string;
  wallet: string;
  kind: "trade" | "launch";
  params: Record<string, unknown>;
  summary: Record<string, unknown>;
  status: "pending" | "signed" | "confirmed" | "failed" | "expired";
  signatures: string[];
  mint: string | null;
  error: string | null;
  client_name: string | null;
  grant_id: string | null;
  key_id: string | null;
  expires_at: Date;
  signed_at: Date | null;
  confirmed_at: Date | null;
  checked_at: Date | null;
  created_at: Date;
}

export async function insertPrepared(p: { wallet: string; kind: "trade" | "launch"; params: unknown; summary: unknown; client_name: string; grant_id: string | null; key_id: string | null }): Promise<PreparedRow> {
  const id = rand(18);
  const row = await q1<PreparedRow>(
    `INSERT INTO mcp_prepared (id, wallet, kind, params, summary, client_name, grant_id, key_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, p.wallet, p.kind, JSON.stringify(p.params), JSON.stringify(p.summary), p.client_name, p.grant_id, p.key_id, new Date(Date.now() + PREPARED_TTL_MS)],
  );
  return row!;
}

export async function getPrepared(id: string): Promise<PreparedRow | undefined> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return undefined;
  const row = await q1<PreparedRow>(`SELECT * FROM mcp_prepared WHERE id = $1`, [id]);
  if (row && row.status === "pending" && new Date(row.expires_at).getTime() + RESULT_GRACE_MS < Date.now()) {
    await q(`UPDATE mcp_prepared SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [id]);
    row.status = "expired";
  }
  return row;
}

export async function updatePrepared(id: string, set: Partial<Pick<PreparedRow, "status" | "signatures" | "mint" | "error">> & { touch?: "signed" | "confirmed" | "checked" }, onlyIfStatus?: string): Promise<PreparedRow | undefined> {
  const cols: string[] = [];
  const vals: unknown[] = [id];
  for (const [k, v] of Object.entries(set)) {
    if (k === "touch") continue;
    vals.push(v);
    cols.push(`${k} = $${vals.length}`);
  }
  if (set.touch) cols.push(`${set.touch}_at = now()`);
  let where = "id = $1";
  if (onlyIfStatus) {
    vals.push(onlyIfStatus);
    where += ` AND status = $${vals.length} AND expires_at > now() - interval '${RESULT_GRACE_MS / 1000} seconds'`;
  }
  return q1<PreparedRow>(`UPDATE mcp_prepared SET ${cols.join(", ")} WHERE ${where} RETURNING *`, vals);
}

// ─── watchlist ─────────────────────────────────────────────────────

export async function getWatchlist(wallet: string): Promise<string[] | null> {
  const r = await q1<{ keys: string[] }>(`SELECT keys FROM mcp_watchlists WHERE wallet = $1`, [wallet]);
  return r ? (Array.isArray(r.keys) ? r.keys : []) : null;
}

export async function setWatchlist(wallet: string, keys: string[] | null): Promise<void> {
  if (keys === null) await q(`DELETE FROM mcp_watchlists WHERE wallet = $1`, [wallet]);
  else
    await q(`INSERT INTO mcp_watchlists (wallet, keys, updated_at) VALUES ($1,$2,now()) ON CONFLICT (wallet) DO UPDATE SET keys = EXCLUDED.keys, updated_at = now()`, [
      wallet, JSON.stringify(keys),
    ]);
}

// ─── housekeeping ──────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  await q(`DELETE FROM mcp_oauth_requests WHERE expires_at < now() - interval '1 day'`);
  await q(`DELETE FROM mcp_oauth_codes WHERE expires_at < now() - interval '1 day'`);
  await q(`DELETE FROM mcp_tokens WHERE expires_at < now() - interval '7 days'`);
  await q(`UPDATE mcp_prepared SET status = 'expired' WHERE status = 'pending' AND expires_at < now() - interval '${RESULT_GRACE_MS / 1000} seconds'`);
}

/**
 * For other modules that accept Claudio tokens (e.g. the media relay): an OAuth access token (cma_…) or MCP key (cmk_…)
 * → who it belongs to, or null. `tokenId` is the grant id (OAuth) or key id, prefixed "oauth:" / "key:".
 */
export async function verifyAccessToken(raw: string): Promise<{ tokenId: string; wallet: string; scopes: Scope[] } | null> {
  const t = String(raw ?? "").replace(/^bearer\s+/i, "").trim();
  if (!/^cm[ak]_[A-Za-z0-9_-]{20,80}$/.test(t)) return null;
  const p = await principalFor(t).catch(() => null);
  return p ? { tokenId: `${p.kind}:${p.id}`, wallet: p.wallet, scopes: p.scopes } : null;
}
