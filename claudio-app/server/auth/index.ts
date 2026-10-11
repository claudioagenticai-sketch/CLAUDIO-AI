// Wallet sign-in (Sign-In With Solana style) + the admin password step.
//
//   POST /api/auth/nonce   { wallet }                     → { nonce, message, expiresAt }
//   POST /api/auth/verify  { wallet, nonce, signature }   → sets the httpOnly `claudio_session` cookie
//   GET  /api/auth/me                                     → { wallet, isAdminWallet, admin } | { wallet: null }
//   POST /api/auth/logout
//   POST /api/admin/login  { password }   (needs a wallet session for a wallet in ADMIN_WALLETS)
//   POST /api/admin/logout
//
// The server only ever verifies signatures over messages IT stored (one-time nonce, 10 min). Session tokens are
// random 32 bytes; only their SHA-256 is stored. Admin = wallet in ADMIN_WALLETS + ADMIN_PASSWORD, valid 2 h,
// 5 wrong passwords per wallet/IP per 15 min → locked. Works without a database (in-memory, single instance).
import type { Express, NextFunction, Request, Response } from "express";
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as edVerify } from "crypto";
import bs58 from "bs58";
import { pool } from "../db";
import { audit } from "./audit";

export { audit } from "./audit";

const COOKIE = "claudio_session";
const SESSION_TTL_MS = 7 * 24 * 3600_000;
const NONCE_TTL_MS = 10 * 60_000;
const ADMIN_TTL_MS = 2 * 3600_000;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface Session {
  wallet: string;
  tokenHash: string;
  adminUntil: number | null;
  expiresAt: number;
}

// ─── storage (Postgres when available, memory otherwise) ─────────────

interface NonceRow { wallet: string; message: string; expiresAt: number; used: boolean }
const memNonces = new Map<string, NonceRow>();
const memSessions = new Map<string, Session>();
const sessionCache = new Map<string, { s: Session | null; at: number }>();

async function putNonce(nonce: string, row: NonceRow): Promise<void> {
  if (pool) {
    await pool.query(`INSERT INTO auth_nonces (nonce, wallet, message, expires_at) VALUES ($1,$2,$3,$4)`, [
      nonce, row.wallet, row.message, new Date(row.expiresAt),
    ]);
    return;
  }
  if (memNonces.size > 20_000) memNonces.clear();
  memNonces.set(nonce, row);
}

/** Atomically marks the nonce used and returns it (null if unknown, used, expired or for another wallet). */
async function takeNonce(nonce: string, wallet: string): Promise<NonceRow | null> {
  if (pool) {
    const r = await pool.query(
      `UPDATE auth_nonces SET used_at = now() WHERE nonce = $1 AND wallet = $2 AND used_at IS NULL AND expires_at > now() RETURNING message, expires_at`,
      [nonce, wallet],
    );
    const row = r.rows[0];
    return row ? { wallet, message: row.message, expiresAt: new Date(row.expires_at).getTime(), used: true } : null;
  }
  const row = memNonces.get(nonce);
  if (!row || row.used || row.wallet !== wallet || row.expiresAt < Date.now()) return null;
  row.used = true;
  return row;
}

async function putSession(s: Session, ip?: string, ua?: string): Promise<void> {
  if (pool) {
    await pool.query(
      `INSERT INTO auth_sessions (token_hash, wallet, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [s.tokenHash, s.wallet, ip ?? null, (ua ?? "").slice(0, 300), new Date(s.expiresAt)],
    );
  } else {
    memSessions.set(s.tokenHash, s);
  }
  sessionCache.delete(s.tokenHash);
}

async function loadSession(tokenHash: string): Promise<Session | null> {
  const hit = sessionCache.get(tokenHash);
  if (hit && Date.now() - hit.at < 15_000) return hit.s;
  let s: Session | null = null;
  if (pool) {
    const r = await pool.query(
      `UPDATE auth_sessions SET last_seen_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING wallet, admin_until, expires_at`,
      [tokenHash],
    );
    const row = r.rows[0];
    if (row) {
      s = {
        wallet: row.wallet,
        tokenHash,
        adminUntil: row.admin_until ? new Date(row.admin_until).getTime() : null,
        expiresAt: new Date(row.expires_at).getTime(),
      };
    }
  } else {
    const m = memSessions.get(tokenHash);
    s = m && m.expiresAt > Date.now() ? m : null;
  }
  if (sessionCache.size > 5_000) sessionCache.clear();
  sessionCache.set(tokenHash, { s, at: Date.now() });
  return s;
}

async function setAdminUntil(tokenHash: string, until: number | null): Promise<void> {
  if (pool) await pool.query(`UPDATE auth_sessions SET admin_until = $2 WHERE token_hash = $1`, [tokenHash, until ? new Date(until) : null]);
  const m = memSessions.get(tokenHash);
  if (m) m.adminUntil = until;
  sessionCache.delete(tokenHash);
}

async function revokeSession(tokenHash: string): Promise<void> {
  if (pool) await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1`, [tokenHash]);
  memSessions.delete(tokenHash);
  sessionCache.delete(tokenHash);
}

// ─── helpers ─────────────────────────────────────────────────────────

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
export { readCookie };

function secureRequest(req: Request): boolean {
  return req.secure || req.get("x-forwarded-proto") === "https";
}

function setCookie(req: Request, res: Response, name: string, value: string, maxAgeMs: number): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secureRequest(req)) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verifies a raw ed25519 signature by a Solana address over `message` (UTF-8). */
export function verifySolanaSignature(wallet: string, message: string | Uint8Array, signature: Uint8Array): boolean {
  try {
    const pub = bs58.decode(wallet);
    if (pub.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]), format: "der", type: "spki" });
    const msg = typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
    return edVerify(null, msg, key, Buffer.from(signature));
  } catch {
    return false;
  }
}

function decodeSignature(sig: unknown): Uint8Array | null {
  if (typeof sig !== "string" || sig.length > 200) return null;
  try {
    const b = bs58.decode(sig);
    if (b.length === 64) return b;
  } catch {
    /* not base58 */
  }
  try {
    const b = Buffer.from(sig, "base64");
    if (b.length === 64) return b;
  } catch {
    /* not base64 */
  }
  return null;
}

export function adminWallets(): Set<string> {
  return new Set(
    (process.env.ADMIN_WALLETS ?? process.env.ADMIN_ADDRESSES ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => SOL_ADDR.test(s)),
  );
}

export function adminLoginConfigured(): boolean {
  return adminWallets().size > 0 && (process.env.ADMIN_PASSWORD ?? "").length >= 8;
}

// ─── request-scoped session ──────────────────────────────────────────

const SESSION_KEY = Symbol("claudioSession");

/** The caller's wallet session, or null. Cached on the request. */
export async function getSession(req: Request): Promise<Session | null> {
  const cached = (req as any)[SESSION_KEY] as Session | null | undefined;
  if (cached !== undefined) return cached;
  const token = readCookie(req, COOKIE);
  const s = token && token.length >= 40 && token.length <= 100 ? await loadSession(sha256(token)).catch(() => null) : null;
  (req as any)[SESSION_KEY] = s;
  return s;
}

export function isAdminSession(s: Session | null): boolean {
  return !!s && !!s.adminUntil && s.adminUntil > Date.now() && adminWallets().has(s.wallet);
}

/** Express guard: any signed-in wallet. Puts the session on res.locals.session. */
export async function requireWallet(req: Request, res: Response, next: NextFunction) {
  const s = await getSession(req);
  if (!s) return res.status(401).json({ error: "sign_in_required", message: "Sign in with your wallet first" });
  res.locals.session = s;
  next();
}

/** Express guard: admin wallet + password step done within the last 2 hours. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const s = await getSession(req);
  if (!isAdminSession(s)) {
    if (s) audit({ actor: s.wallet, action: "admin.denied", target: req.path, severity: "warn", ip: req.ip });
    return res.status(403).json({ error: "admin_required", message: "Admin sign-in required" });
  }
  res.locals.session = s;
  next();
}

// ─── simple fixed-window limiter (per key) ───────────────────────────

const windows = new Map<string, { n: number; reset: number }>();
export function hit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.reset < now) {
    if (windows.size > 50_000) for (const [k, v] of windows) if (v.reset < now) windows.delete(k);
    windows.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  w.n += 1;
  return w.n <= max;
}

// ─── routes ──────────────────────────────────────────────────────────

function signInMessage(host: string, wallet: string, nonce: string, issued: Date, expires: Date): string {
  return [
    `${host} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Sign in to Claudio. This request does not trigger a transaction or cost any fees.",
    "",
    `URI: https://${host}`,
    "Version: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${issued.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join("\n");
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/nonce", async (req, res) => {
    const wallet = String(req.body?.wallet ?? "").trim();
    if (!SOL_ADDR.test(wallet)) return res.status(400).json({ error: "bad_wallet", message: "A Solana address is required" });
    if (!hit(`nonce:${req.ip}`, 20, 60_000)) return res.status(429).json({ error: "rate_limited", message: "Too many sign-in attempts" });
    const nonce = randomBytes(16).toString("hex");
    const issued = new Date();
    const expires = new Date(issued.getTime() + NONCE_TTL_MS);
    const host = (process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).host : req.get("host")) ?? "useclaudio.xyz";
    const message = signInMessage(host, wallet, nonce, issued, expires);
    try {
      await putNonce(nonce, { wallet, message, expiresAt: expires.getTime(), used: false });
    } catch (e) {
      return res.status(500).json({ error: "internal", message: (e as Error).message });
    }
    res.json({ nonce, message, expiresAt: expires.toISOString() });
  });

  app.post("/api/auth/verify", async (req, res) => {
    const wallet = String(req.body?.wallet ?? "").trim();
    const nonce = String(req.body?.nonce ?? "").trim();
    const signature = decodeSignature(req.body?.signature);
    if (!SOL_ADDR.test(wallet) || !/^[0-9a-f]{32}$/.test(nonce) || !signature) {
      return res.status(400).json({ error: "bad_request", message: "wallet, nonce and a 64-byte signature are required" });
    }
    if (!hit(`verify:${req.ip}`, 20, 60_000)) return res.status(429).json({ error: "rate_limited", message: "Too many sign-in attempts" });
    const row = await takeNonce(nonce, wallet).catch(() => null);
    if (!row) return res.status(401).json({ error: "bad_nonce", message: "Sign-in request expired — try again" });
    if (!verifySolanaSignature(wallet, row.message, signature)) {
      audit({ actor: wallet, action: "auth.bad_signature", severity: "warn", ip: req.ip });
      return res.status(401).json({ error: "bad_signature", message: "Signature does not match this wallet" });
    }
    const token = randomBytes(32).toString("base64url");
    const s: Session = { wallet, tokenHash: sha256(token), adminUntil: null, expiresAt: Date.now() + SESSION_TTL_MS };
    try {
      await putSession(s, req.ip, req.get("user-agent"));
    } catch (e) {
      return res.status(500).json({ error: "internal", message: (e as Error).message });
    }
    setCookie(req, res, COOKIE, token, SESSION_TTL_MS);
    audit({ actor: wallet, action: "auth.sign_in", ip: req.ip });
    res.json({ wallet, isAdminWallet: adminWallets().has(wallet), admin: false });
  });

  app.get("/api/auth/me", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const s = await getSession(req);
    if (!s) return res.json({ wallet: null, isAdminWallet: false, admin: false });
    res.json({
      wallet: s.wallet,
      isAdminWallet: adminWallets().has(s.wallet),
      admin: isAdminSession(s),
      adminUntil: isAdminSession(s) ? new Date(s.adminUntil!).toISOString() : null,
      adminLoginConfigured: adminLoginConfigured(),
    });
  });

  app.post("/api/auth/logout", async (req, res) => {
    const s = await getSession(req);
    if (s) await revokeSession(s.tokenHash).catch(() => {});
    setCookie(req, res, COOKIE, "", 0);
    res.json({ ok: true });
  });

  // Admin step 2: the password from the ADMIN_PASSWORD secret, only for a signed-in admin wallet.
  app.post("/api/admin/login", async (req, res) => {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "sign_in_required", message: "Sign in with your wallet first" });
    if (!adminLoginConfigured()) return res.status(501).json({ error: "admin_unconfigured", message: "Set ADMIN_WALLETS and ADMIN_PASSWORD (8+ chars)" });
    if (!adminWallets().has(s.wallet)) {
      audit({ actor: s.wallet, action: "admin.login_not_admin", severity: "warn", ip: req.ip });
      return res.status(403).json({ error: "not_admin", message: "This wallet is not an admin" });
    }
    const lockKey = `adminpw:${s.wallet}:${req.ip}`;
    if (!hit(lockKey, 5, 15 * 60_000)) {
      audit({ actor: s.wallet, action: "admin.locked", severity: "high", ip: req.ip });
      return res.status(429).json({ error: "locked", message: "Too many wrong passwords — locked for 15 minutes" });
    }
    const given = String(req.body?.password ?? "");
    const ok = timingSafeEqual(Buffer.from(sha256(given), "hex"), Buffer.from(sha256(process.env.ADMIN_PASSWORD ?? ""), "hex"));
    if (!ok) {
      audit({ actor: s.wallet, action: "admin.bad_password", severity: "warn", ip: req.ip });
      return res.status(401).json({ error: "bad_password", message: "Wrong password" });
    }
    windows.delete(lockKey);
    const until = Date.now() + ADMIN_TTL_MS;
    await setAdminUntil(s.tokenHash, until);
    audit({ actor: s.wallet, action: "admin.login", severity: "info", ip: req.ip });
    res.json({ admin: true, adminUntil: new Date(until).toISOString() });
  });

  app.post("/api/admin/logout", async (req, res) => {
    const s = await getSession(req);
    if (s) await setAdminUntil(s.tokenHash, null).catch(() => {});
    res.json({ ok: true });
  });
}
