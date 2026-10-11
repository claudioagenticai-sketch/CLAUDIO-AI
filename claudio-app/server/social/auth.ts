// Verifies a signed-in user from Auth0 and/or Clerk (both at once is normal: X through Auth0, TikTok through Clerk)
// and returns the social accounts they have PROVEN control of.
//
// The client sends `X-Auth0-Token` and/or `X-Clerk-Token` (legacy: `Authorization: Bearer` + `X-Auth-Provider`).
// Only verified OAuth accounts count, keyed by the provider's immutable user id (username for HANDLE_KEYED socials).
// Each social is accepted ONLY from the service in SIGN_IN_VIA. Email/phone are never identities.
import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { HANDLE_KEYED, SIGN_IN_VIA } from "@shared/social";
import { isProvider, type SocialIdentity, type SocialProvider } from "./identity";
import type { AuthProviderId } from "./store";

export interface VerifiedAccount extends SocialIdentity {
  displayName?: string;
  avatarUrl?: string;
  /** Which sign-in session proved it. */
  via: AuthProviderId;
  subject: string;
}

export interface AuthSession {
  authProvider: AuthProviderId;
  subject: string;
}

export interface AuthedUser {
  sessions: AuthSession[];
  accounts: VerifiedAccount[];
}

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const env = (n: string) => process.env[n]?.trim() || undefined;

/** Which sign-in providers the server can verify (the client shows the same set). */
export function enabledAuthProviders(): AuthProviderId[] {
  const out: AuthProviderId[] = [];
  if (env("CLERK_SECRET_KEY")) out.push("clerk");
  if (env("AUTH0_DOMAIN") && env("AUTH0_AUDIENCE")) out.push("auth0");
  return out;
}

/** Auth0 connection names that differ from ours ("x:twitter-prod,discord:discord-oauth"), same format as the client. */
function auth0ConnectionAliases(): Map<string, SocialProvider> {
  const out = new Map<string, SocialProvider>();
  for (const pair of (env("AUTH0_CONNECTIONS") ?? env("VITE_AUTH0_CONNECTIONS") ?? "").split(",")) {
    const [k, v] = pair.split(":").map((x) => x.trim());
    if (k && v && isProvider(k)) out.set(v.toLowerCase(), k);
  }
  return out;
}

/** Provider names used by Auth0 connections/`sub` prefixes and Clerk `externalAccounts[].provider` → our providers. */
function mapProvider(raw: string): SocialProvider | null {
  const p = raw.toLowerCase().replace(/^oauth_/, "");
  const alias = auth0ConnectionAliases().get(p);
  if (alias) return alias;
  if (p === "twitter" || p === "x" || p === "twitter_v2" || p === "x_v2") return "x";
  if (p === "linkedin_oidc") return "linkedin";
  if (p === "hugging_face") return "huggingface";
  if (p === "google-oauth2") return "google";
  return isProvider(p) ? p : null;
}

/** Keep only accounts this service may vouch for, with the id form our vault keys use. */
function accept(via: AuthProviderId, a: Omit<VerifiedAccount, "via">): VerifiedAccount | null {
  if (SIGN_IN_VIA[a.provider] !== via) return null;
  if (HANDLE_KEYED.has(a.provider)) {
    // App-scoped ids can't be matched to a public handle: the username is the key, so it must be present.
    if (!a.handle) return null;
    return { ...a, via, providerUserId: a.handle.replace(/^@/, "").toLowerCase() };
  }
  return { ...a, via };
}

// ─── Clerk ──────────────────────────────────────────────────────────────────────────────────────

let clerk: ReturnType<typeof createClerkClient> | null = null;
function clerkClient() {
  if (!clerk) clerk = createClerkClient({ secretKey: env("CLERK_SECRET_KEY") });
  return clerk;
}

async function verifyClerk(token: string): Promise<AuthedUser> {
  const secretKey = env("CLERK_SECRET_KEY");
  if (!secretKey) throw new AuthError(501, "clerk_unconfigured", "Clerk sign-in is not configured");
  const parties = env("CLERK_AUTHORIZED_PARTIES")?.split(",").map((s) => s.trim()).filter(Boolean);
  let sub: string;
  try {
    const payload = await verifyToken(token, { secretKey, jwtKey: env("CLERK_JWT_KEY"), authorizedParties: parties });
    sub = String((payload as JWTPayload).sub ?? "");
  } catch {
    throw new AuthError(401, "bad_token", "Your session has expired — sign in again");
  }
  if (!sub) throw new AuthError(401, "bad_token", "Invalid session");
  // Social ids aren't in the session JWT: read the user's external accounts from Clerk's API.
  const user = await clerkClient().users.getUser(sub);
  const accounts: VerifiedAccount[] = [];
  for (const a of user.externalAccounts) {
    const provider = mapProvider(a.provider);
    if (!provider || !a.providerUserId) continue;
    // Only accounts whose OAuth round-trip completed: an unverified/pending connection proves nothing.
    if (a.verification?.status !== "verified") continue;
    const ok = accept("clerk", {
      provider,
      providerUserId: a.providerUserId,
      handle: a.username ?? undefined,
      displayName: [a.firstName, a.lastName].filter(Boolean).join(" ") || undefined,
      avatarUrl: a.imageUrl || undefined,
      subject: sub,
    });
    if (ok) accounts.push(ok);
  }
  return { sessions: [{ authProvider: "clerk", subject: sub }], accounts };
}

// ─── Auth0 ──────────────────────────────────────────────────────────────────────────────────────

/** Namespaced claims added by the Auth0 Post-Login Action. */
const AUTH0_NS = ["https://useclaudio.xyz/"];
const auth0Claim = (payload: Record<string, unknown>, name: string): unknown =>
  AUTH0_NS.map((ns) => payload[`${ns}${name}`]).find((v) => v !== undefined);
let auth0Jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function auth0Issuer(): string {
  const d = env("AUTH0_DOMAIN")!.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${d}/`;
}

/** Auth0 `sub` / identity ids: "twitter|12", "github|1024025", "oauth2|discord|8056…" → [connection, id]. */
function splitAuth0Id(provider: string, userId: string): { connection: string; id: string } {
  const parts = userId.split("|");
  if (provider === "oauth2" && parts.length >= 2) return { connection: parts[parts.length - 2], id: parts[parts.length - 1] };
  return { connection: provider, id: parts[parts.length - 1] };
}

async function verifyAuth0(token: string): Promise<AuthedUser> {
  if (!env("AUTH0_DOMAIN") || !env("AUTH0_AUDIENCE")) throw new AuthError(501, "auth0_unconfigured", "Auth0 sign-in is not configured");
  const issuer = auth0Issuer();
  if (!auth0Jwks) auth0Jwks = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, auth0Jwks, { issuer, audience: env("AUTH0_AUDIENCE"), algorithms: ["RS256"] }));
  } catch {
    throw new AuthError(401, "bad_token", "Your session has expired — sign in again");
  }
  // Only tokens issued to OUR app: another application in the same tenant (or an M2M client) can't be replayed here.
  const clientId = env("AUTH0_CLIENT_ID") ?? env("VITE_AUTH0_CLIENT_ID");
  if (clientId && payload.azp !== clientId) throw new AuthError(401, "bad_token", "This session belongs to another application");
  const sub = String(payload.sub ?? "");
  if (!sub || sub.endsWith("@clients")) throw new AuthError(401, "bad_token", "Invalid session");
  const accounts: VerifiedAccount[] = [];
  const add = (connection: string, id: string, handle?: string) => {
    const provider = mapProvider(connection);
    if (!provider || !id) return;
    const ok = accept("auth0", { provider, providerUserId: id, handle, subject: sub });
    if (ok && !accounts.some((a) => a.provider === ok.provider && a.providerUserId === ok.providerUserId)) accounts.push(ok);
  };
  // Preferred: every linked identity, exported by the Post-Login Action as [{provider, connection, user_id, username}].
  const identities = auth0Claim(payload, "identities");
  if (Array.isArray(identities)) {
    for (const i of identities as { provider?: string; connection?: string; user_id?: string | number; username?: string; isSocial?: boolean }[]) {
      if (!i.provider || i.user_id == null || i.isSocial === false) continue;
      const { connection, id } = splitAuth0Id(i.provider, String(i.user_id));
      add(i.provider === "oauth2" ? (i.connection ?? connection) : i.provider, id, i.username);
    }
  } else {
    // Fallback: the primary identity is in `sub` ("twitter|44196397", "github|1024025", "oauth2|discord|123").
    const parts = sub.split("|");
    if (parts.length >= 2) {
      const handle = auth0Claim(payload, "username");
      add(parts[parts.length - 2], parts[parts.length - 1], typeof handle === "string" ? handle : undefined);
    }
  }
  return { sessions: [{ authProvider: "auth0", subject: sub }], accounts };
}

// ─── Request entry point ────────────────────────────────────────────────────────────────────────

function bearer(req: Request): string {
  const h = req.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/**
 * Verifies every session the request carries and merges their accounts. One expired session doesn't sink the
 * other (its accounts just drop out); with none valid it's a 401.
 */
export async function authenticate(req: Request): Promise<AuthedUser> {
  const tokens: { via: AuthProviderId; token: string }[] = [];
  const a0 = req.get("x-auth0-token")?.trim();
  const ck = req.get("x-clerk-token")?.trim();
  if (a0) tokens.push({ via: "auth0", token: a0 });
  if (ck) tokens.push({ via: "clerk", token: ck });
  if (!tokens.length) {
    const legacy = (req.get("x-auth-provider") ?? "").toLowerCase();
    const t = bearer(req);
    if (t && (legacy === "auth0" || legacy === "clerk")) tokens.push({ via: legacy, token: t });
    else if (t) throw new AuthError(400, "bad_provider", "Unknown sign-in provider");
  }
  if (!tokens.length) throw new AuthError(401, "signed_out", "Sign in to continue");
  const results = await Promise.allSettled(tokens.map((t) => (t.via === "clerk" ? verifyClerk(t.token) : verifyAuth0(t.token))));
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  return { sessions: ok.flatMap((u) => u.sessions), accounts: ok.flatMap((u) => u.accounts) };
}

/** Pure helpers exposed for server/social/auth.check.ts. */
export const __authInternals = { mapProvider, accept, splitAuth0Id };
