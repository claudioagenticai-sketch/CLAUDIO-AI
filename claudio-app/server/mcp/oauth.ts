// OAuth 2.1 authorization server for the online MCP endpoints (MCP authorization spec 2026-07-28).
//
//   GET  /.well-known/oauth-authorization-server         RFC 8414 metadata (PKCE S256 only, public clients, RFC 9207 iss)
//   GET  /.well-known/oauth-protected-resource[/mcp/data|/mcp/trade]   RFC 9728 protected resource metadata
//   POST /oauth/register                                 RFC 7591 dynamic client registration (public clients only)
//   GET  /oauth/authorize                                → 302 /connect?request=<id> (wallet sign-in + consent in the SPA)
//   POST /oauth/token                                    authorization_code (+PKCE) and refresh_token (rotated), RFC 8707 resource
//   POST /oauth/revoke                                   RFC 7009
//   GET  /api/oauth/request/:id · POST …/approve · POST …/deny     (the /connect page; wallet session cookie)
//
// Client ids: the pre-registered public client `claudio-cli` (any http://127.0.0.1:<port>/callback), https URLs
// (OAuth Client ID Metadata Documents, fetched and validated), or ids issued by /oauth/register.
import type { Express, NextFunction, Request, Response } from "express";
import { createHash } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { audit, getSession, hit } from "../auth";
import { agentBySlug } from "../agents/store";
import {
  McpError, SCOPES, codeWasUsed, finishRequest, getClient, getGrant, getRequest, insertClient, insertCode, insertGrant, insertRequest, isScope,
  issueTokens, rand, revokeGrant, revokeToken, sha256, takeCode, useRefresh, type Scope,
} from "./store";

// ─── base URL + resources ──────────────────────────────────────────

/** Public origin of this site (issuer + resource base). PUBLIC_BASE_URL wins; otherwise the request's own origin. */
export function baseUrl(req: Request): string {
  const env = process.env.PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host") ?? "useclaudio.xyz"}`;
}

export type McpServerId = "data" | "trade";
export const resourceUrl = (req: Request, s: McpServerId) => `${baseUrl(req)}/mcp/${s}`;
export const prmUrl = (req: Request, s: McpServerId) => `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp/${s}`;

export const SERVER_SCOPES: Record<McpServerId, Scope[]> = {
  data: ["read"],
  trade: ["trade:quote", "trade:prepare", "launch", "thread:write"],
};

/** RFC 8707 resource → canonical form we bind tokens to (null = every Claudio MCP endpoint). Throws on foreign targets. */
function canonicalResource(req: Request, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new OAuthFail("invalid_target", "resource must be an absolute URL");
  }
  if (u.hash) throw new OAuthFail("invalid_target", "resource must not have a fragment");
  const base = new URL(baseUrl(req));
  if (u.protocol !== base.protocol || u.host.toLowerCase() !== base.host.toLowerCase()) throw new OAuthFail("invalid_target", `resource must be on ${base.host}`);
  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/mcp") return null;
  if (path === "/mcp/data" || path === "/mcp/trade") return `${base.origin}${path}`;
  throw new OAuthFail("invalid_target", "Unknown resource; use /mcp/data or /mcp/trade");
}

/** True when a token bound to `resource` may be used at server `s`. */
export function resourceAllows(resource: string | null, req: Request, s: McpServerId): boolean {
  return !resource || resource === resourceUrl(req, s);
}

class OAuthFail extends Error {
  constructor(public error: string, public description: string, public status = 400) {
    super(description);
  }
}

// ─── clients ───────────────────────────────────────────────────────

export interface ResolvedClient {
  id: string;
  name: string;
  uri: string | null;
  logoUri: string | null;
  kind: "first_party" | "metadata_document" | "registered";
  redirectUris: string[];
}

const FIRST_PARTY: Record<string, ResolvedClient> = {
  "claudio-cli": {
    id: "claudio-cli",
    name: "Claudio CLI",
    uri: "https://www.npmjs.com/package/@useclaudio/cli",
    logoUri: null,
    kind: "first_party",
    redirectUris: ["http://127.0.0.1/callback", "http://localhost/callback", "http://[::1]/callback"],
  },
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BAD_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ws:", "wss:", "ftp:"]);

/** A redirect URI we'll register: https anywhere, http only on loopback, or a private-use app scheme. */
export function validRedirectUri(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 500) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return !!u.hostname;
  if (u.protocol === "http:") return LOOPBACK_HOSTS.has(u.hostname);
  if (BAD_SCHEMES.has(u.protocol)) return false;
  return /^[a-z][a-z0-9+.-]{1,40}:$/.test(u.protocol);
}

/** Exact match, except loopback http URIs where any port is allowed (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], given: string): boolean {
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  return registered.some((r) => {
    if (r === given) return true;
    try {
      const u = new URL(r);
      return u.protocol === "http:" && g.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname) && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch {
      return false;
    }
  });
}

const cimdCache = new Map<string, { c: ResolvedClient | null; at: number }>();

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

/** OAuth Client ID Metadata Document: https URL client_id → fetched JSON (SSRF-guarded, ≤ 32 KB, 5 s, no redirects). */
async function fetchMetadataDocument(url: string): Promise<ResolvedClient | null> {
  const cached = cimdCache.get(url);
  if (cached && Date.now() - cached.at < 3600_000) return cached.c;
  let out: ResolvedClient | null = null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.pathname === "/" || u.hash || u.username || u.password) throw new Error("bad url");
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("private address");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5_000);
    const res = await fetch(url, { redirect: "manual", signal: ctl.signal, headers: { accept: "application/json" } }).finally(() => clearTimeout(t));
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 32_768) throw new Error("too large");
    const d = JSON.parse(text);
    if (d?.client_id !== url) throw new Error("client_id mismatch");
    const uris = Array.isArray(d.redirect_uris) ? d.redirect_uris.filter(validRedirectUri).slice(0, 20) : [];
    if (!uris.length) throw new Error("no redirect_uris");
    if (d.token_endpoint_auth_method && d.token_endpoint_auth_method !== "none") throw new Error("only public clients");
    out = {
      id: url,
      name: String(d.client_name ?? u.hostname).replace(/[\u0000-\u001f]/g, "").slice(0, 80) || u.hostname,
      uri: typeof d.client_uri === "string" && /^https:\/\//.test(d.client_uri) ? d.client_uri.slice(0, 300) : null,
      logoUri: typeof d.logo_uri === "string" && /^https:\/\//.test(d.logo_uri) ? d.logo_uri.slice(0, 300) : null,
      kind: "metadata_document",
      redirectUris: uris,
    };
  } catch {
    out = null;
  }
  if (cimdCache.size > 500) cimdCache.clear();
  cimdCache.set(url, { c: out, at: Date.now() });
  return out;
}

export async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  if (!clientId || clientId.length > 500) return null;
  if (FIRST_PARTY[clientId]) return FIRST_PARTY[clientId];
  if (/^https:\/\//.test(clientId)) return fetchMetadataDocument(clientId);
  if (!/^mcpc_[A-Za-z0-9_-]{10,60}$/.test(clientId)) return null;
  const row = await getClient(clientId);
  if (!row) return null;
  return { id: row.client_id, name: row.name, uri: row.client_uri, logoUri: row.logo_uri, kind: "registered", redirectUris: row.redirect_uris };
}

// ─── helpers ───────────────────────────────────────────────────────

const cors = (req: Request, res: Response, next: NextFunction) => {
  // Discovery, registration, token and revocation never use cookies: any origin may call them.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, mcp-protocol-version");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
};

const noStore = (res: Response) => res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });

function oauthError(res: Response, e: unknown): void {
  noStore(res);
  if (e instanceof OAuthFail) return void res.status(e.status).json({ error: e.error, error_description: e.description });
  if (e instanceof McpError) return void res.status(e.status).json({ error: e.status === 503 ? "temporarily_unavailable" : "server_error", error_description: e.message });
  console.error("[oauth]", (e as Error)?.message ?? e);
  res.status(500).json({ error: "server_error", error_description: "Something went wrong" });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function errorPage(res: Response, title: string, detail: string): void {
  res.status(400).type("html").send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Claudio</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#120b10;color:#f8ece8;font:15px/1.5 system-ui,sans-serif">` +
      `<main style="max-width:440px;padding:28px;border:1px solid #34222e;border-radius:16px;background:#1b1118"><img src="/claudio/face-128.webp" alt="Claudio" width="44" height="44" style="border-radius:12px">` +
      `<h1 style="font-size:19px;margin:14px 0 6px">${esc(title)}</h1><p style="color:#d6bfc7;margin:0">${esc(detail)}</p>` +
      `<p style="color:#a48b96;font-size:13px;margin-top:18px">Go back to the app you came from and try connecting again.</p></main></body>`,
  );
}

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

function parseScopes(raw: unknown): Scope[] {
  const asked = String(raw ?? "").split(/[\s+]+/).filter(Boolean);
  const out = new Set<Scope>(["read"]);
  for (const s of asked) if (isScope(s)) out.add(s);
  return SCOPES.filter((s) => out.has(s));
}

const ip = (req: Request) => req.ip ?? "unknown";
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown) => (typeof one(v) === "string" ? (one(v) as string) : undefined);

function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

// ─── metadata documents ────────────────────────────────────────────

export function authServerMetadata(req: Request) {
  const base = baseUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/docs`,
    op_policy_uri: `${base}/privacy`,
    op_tos_uri: `${base}/terms`,
  };
}

function protectedResource(req: Request, s: McpServerId | null) {
  const base = baseUrl(req);
  return {
    resource: s ? resourceUrl(req, s) : base,
    authorization_servers: [base],
    scopes_supported: s ? SERVER_SCOPES[s] : [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: s === "trade" ? "Claudio Trade" : s === "data" ? "Claudio Data" : "Claudio MCP",
    resource_documentation: `${base}/docs`,
    resource_policy_uri: `${base}/privacy`,
    resource_tos_uri: `${base}/terms`,
  };
}

// ─── routes ────────────────────────────────────────────────────────

const AUTH_REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 2 * 60_000;

export function registerOAuthRoutes(app: Express): void {
  app.use(["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/oauth/register", "/oauth/token", "/oauth/revoke"], cors);

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.set("Cache-Control", "public, max-age=300").json(authServerMetadata(req));
  });
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.set("Cache-Control", "public, max-age=300").json(protectedResource(req, null));
  });
  for (const s of ["data", "trade"] as const) {
    app.get(`/.well-known/oauth-protected-resource/mcp/${s}`, (req, res) => {
      res.set("Cache-Control", "public, max-age=300").json(protectedResource(req, s));
    });
  }
  // Official MCP Registry domain proof (`mcp-publisher login http`): set MCP_REGISTRY_AUTH to "v=MCPv1; k=ed25519; p=…".
  app.get("/.well-known/mcp-registry-auth", (_req, res) => {
    const v = process.env.MCP_REGISTRY_AUTH?.trim();
    if (!v) return void res.status(404).type("text").send("not configured");
    res.type("text/plain").send(v);
  });

  // ── dynamic client registration (RFC 7591) ──
  app.post("/oauth/register", async (req, res) => {
    try {
      if (!hit(`oauth-register:${ip(req)}`, 10, 3600_000)) throw new OAuthFail("invalid_client_metadata", "Too many registrations from this address; try again later", 429);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
      if (!uris.length || uris.length > 10) throw new OAuthFail("invalid_redirect_uri", "redirect_uris must list 1–10 URIs");
      for (const u of uris) if (!validRedirectUri(u)) throw new OAuthFail("invalid_redirect_uri", `Not allowed as a redirect URI: ${String(u).slice(0, 120)} (https, http://127.0.0.1 / localhost, or an app scheme)`);
      const grants = Array.isArray(b.grant_types) ? b.grant_types.map(String) : ["authorization_code", "refresh_token"];
      if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) throw new OAuthFail("invalid_client_metadata", "Only authorization_code and refresh_token are supported");
      const rtypes = Array.isArray(b.response_types) ? b.response_types.map(String) : ["code"];
      if (rtypes.some((r) => r !== "code")) throw new OAuthFail("invalid_client_metadata", "Only response_type code is supported");
      const name = String(b.client_name ?? "MCP client").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "MCP client";
      const appType = b.application_type === "native" ? "native" : "web";
      const clientUri = typeof b.client_uri === "string" && /^https:\/\//.test(b.client_uri) ? b.client_uri.slice(0, 300) : null;
      const logoUri = typeof b.logo_uri === "string" && /^https:\/\//.test(b.logo_uri) ? b.logo_uri.slice(0, 300) : null;
      const clientId = `mcpc_${rand(18)}`;
      await insertClient({ client_id: clientId, name, redirect_uris: uris as string[], client_uri: clientUri, logo_uri: logoUri, application_type: appType }, ip(req));
      noStore(res).status(201).json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: grants.length ? grants : ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: appType,
        ...(clientUri ? { client_uri: clientUri } : {}),
        ...(logoUri ? { logo_uri: logoUri } : {}),
        scope: SCOPES.join(" "),
      });
    } catch (e) {
      oauthError(res, e);
    }
  });

  // ── authorization endpoint ──
  app.get("/oauth/authorize", async (req, res) => {
    const clientId = str(req.query.client_id) ?? "";
    const client = await resolveClient(clientId).catch(() => null);
    if (!client) return errorPage(res, "Unknown app", "This app isn't registered with Claudio, or its client metadata couldn't be read.");
    let redirectUri = str(req.query.redirect_uri);
    if (!redirectUri) {
      const fixed = client.redirectUris.filter((u) => !LOOPBACK_HOSTS.has(new URL(u).hostname));
      if (client.redirectUris.length === 1 && fixed.length === 1) redirectUri = fixed[0];
    }
    if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return errorPage(res, "Wrong return address", "The redirect_uri doesn't match what this app registered.");
    const state = str(req.query.state);
    const iss = baseUrl(req);
    const back = (error: string, description: string) => res.redirect(302, withParams(redirectUri!, { error, error_description: description, state, iss }));
    if (str(req.query.response_type) !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
    const challenge = str(req.query.code_challenge) ?? "";
    if (str(req.query.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
    let resource: string | null;
    try {
      resource = canonicalResource(req, req.query.resource);
    } catch (e) {
      return back("invalid_target", (e as Error).message);
    }
    try {
      if (!hit(`oauth-authorize:${ip(req)}`, 30, 600_000)) return back("temporarily_unavailable", "Too many sign-in attempts; try again in a few minutes");
      const id = rand(18);
      await insertRequest({
        id, client_id: client.id, client_name: client.name, client_kind: client.kind, redirect_uri: redirectUri, scopes: parseScopes(req.query.scope),
        state: state ?? null, code_challenge: challenge, resource, expires_at: new Date(Date.now() + AUTH_REQUEST_TTL_MS),
      });
      res.redirect(302, `/connect?request=${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof McpError) return back("temporarily_unavailable", e.message);
      console.error("[oauth] authorize:", (e as Error).message);
      back("server_error", "Something went wrong");
    }
  });

  // ── consent API used by the /connect page ──
  app.get("/api/oauth/request/:id", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const r = await getRequest(String(req.params.id));
      if (!r) return void res.status(404).json({ error: "expired", message: "This sign-in request expired. Start again from the app." });
      let redirectHost = r.redirect_uri;
      try {
        const u = new URL(r.redirect_uri);
        redirectHost = u.protocol === "http:" || u.protocol === "https:" ? u.host : u.protocol.replace(/:$/, "");
      } catch {
        /* keep the raw value */
      }
      const c = await resolveClient(r.client_id).catch(() => null);
      res.json({
        id: r.id,
        client: { id: r.client_id, name: r.client_name, uri: c?.uri ?? null, logoUri: c?.logoUri ?? null, kind: r.client_kind, redirectHost },
        scopes: r.scopes,
        resource: r.resource,
        expiresAt: new Date(r.expires_at).toISOString(),
      });
    } catch (e) {
      res.status(e instanceof McpError ? e.status : 500).json({ error: (e as McpError).code ?? "internal", message: (e as Error).message });
    }
  });

  const sameOrigin = (req: Request) => {
    const o = req.get("origin");
    return !o || o === baseUrl(req) || o === `${req.protocol}://${req.get("host")}`;
  };

  app.post("/api/oauth/request/:id/:action(approve|deny)", async (req, res) => {
    try {
      if (!sameOrigin(req)) return void res.status(403).json({ error: "bad_origin", message: "Cross-site request refused" });
      const s = await getSession(req);
      if (!s) return void res.status(401).json({ error: "sign_in_required", message: "Sign in with your wallet first" });
      const r = await getRequest(String(req.params.id));
      if (!r) return void res.status(404).json({ error: "expired", message: "This sign-in request expired. Start again from the app." });
      const iss = baseUrl(req);
      if (req.params.action === "deny") {
        await finishRequest(r.id);
        audit({ actor: s.wallet, action: "mcp.oauth_denied", target: r.client_id, ip: req.ip });
        return void res.json({ redirect: withParams(r.redirect_uri, { error: "access_denied", error_description: "The user declined", state: r.state ?? undefined, iss }) });
      }
      const wanted = Array.isArray(req.body?.scopes) ? (req.body.scopes as unknown[]).map(String) : r.scopes;
      const scopes = SCOPES.filter((sc) => sc === "read" || (wanted.includes(sc) && r.scopes.includes(sc)));
      let agentId: string | null = null;
      if (scopes.includes("thread:write")) {
        const slug = String(req.body?.agentSlug ?? "").trim();
        const a = slug ? await agentBySlug(slug).catch(() => undefined) : undefined;
        if (!a || a.ownerWallet !== s.wallet) return void res.status(400).json({ error: "agent_required", message: "Pick one of your agents to post as, or untick posting." });
        if (a.status !== "active") return void res.status(400).json({ error: "agent_inactive", message: `That agent is ${a.status}.` });
        agentId = a.id;
      }
      if (!(await finishRequest(r.id))) return void res.status(409).json({ error: "already_used", message: "This request was already answered." });
      const grantId = `grt_${rand(12)}`;
      await insertGrant({ id: grantId, wallet: s.wallet, client_id: r.client_id, client_name: r.client_name, scopes, agent_id: agentId, resource: r.resource });
      const code = `cmc_${rand()}`;
      await insertCode({ code_hash: sha256(code), grant_id: grantId, client_id: r.client_id, redirect_uri: r.redirect_uri, code_challenge: r.code_challenge, resource: r.resource, expires_at: new Date(Date.now() + CODE_TTL_MS) });
      audit({ actor: s.wallet, action: "mcp.oauth_granted", target: r.client_id, ip: req.ip, detail: { scopes, grantId } });
      res.json({ redirect: withParams(r.redirect_uri, { code, state: r.state ?? undefined, iss }) });
    } catch (e) {
      res.status(e instanceof McpError ? e.status : 500).json({ error: (e as McpError).code ?? "internal", message: (e as Error).message });
    }
  });

  // ── token endpoint ──
  app.post("/oauth/token", async (req, res) => {
    try {
      if (!hit(`oauth-token:${ip(req)}`, 60, 60_000)) throw new OAuthFail("slow_down", "Too many token requests", 429);
      const b = (req.body ?? {}) as Record<string, unknown>;
      let clientId = str(b.client_id) ?? "";
      const basic = /^basic\s+(.+)$/i.exec(req.get("authorization") ?? "");
      if (basic) clientId ||= decodeURIComponent(Buffer.from(basic[1], "base64").toString("utf8").split(":")[0] ?? "");
      const client = await resolveClient(clientId);
      if (!client) throw new OAuthFail("invalid_client", "Unknown client_id", 401);
      const grantType = str(b.grant_type);

      if (grantType === "authorization_code") {
        const code = str(b.code) ?? "";
        const verifier = str(b.code_verifier) ?? "";
        const row = code.startsWith("cmc_") ? await takeCode(sha256(code)) : undefined;
        if (!row) {
          const reused = code.startsWith("cmc_") ? await codeWasUsed(sha256(code)) : undefined;
          if (reused) await revokeGrant(reused);
          throw new OAuthFail("invalid_grant", "The authorization code is invalid, expired or already used");
        }
        if (row.expired) throw new OAuthFail("invalid_grant", "The authorization code expired");
        if (row.client_id !== client.id) throw new OAuthFail("invalid_grant", "The code was issued to another client");
        if ((str(b.redirect_uri) ?? row.redirect_uri) !== row.redirect_uri) throw new OAuthFail("invalid_grant", "redirect_uri doesn't match the authorization request");
        if (!pkceOk(verifier, row.code_challenge)) throw new OAuthFail("invalid_grant", "PKCE verification failed");
        const asked = canonicalResource(req, b.resource);
        if (asked && row.resource && asked !== row.resource) throw new OAuthFail("invalid_target", "resource differs from the authorization request");
        const g = await getGrant(row.grant_id);
        if (!g || g.revoked_at) throw new OAuthFail("invalid_grant", "This connection was revoked");
        const out = await issueTokens({ id: g.id, wallet: g.wallet, client_id: g.client_id, scopes: g.scopes, resource: asked ?? row.resource });
        return void noStore(res).json({ access_token: out.access_token, token_type: "Bearer", expires_in: out.expires_in, refresh_token: out.refresh_token, scope: out.scope });
      }

      if (grantType === "refresh_token") {
        const token = str(b.refresh_token) ?? "";
        if (!token.startsWith("cmr_")) throw new OAuthFail("invalid_grant", "Invalid refresh token");
        const r = await useRefresh(token, client.id);
        if ("error" in r) throw new OAuthFail(r.error, "The refresh token is invalid, expired or already used");
        const g = await getGrant(r.grant_id);
        if (!g || g.revoked_at) throw new OAuthFail("invalid_grant", "This connection was revoked");
        const narrowed = str(b.scope) ? r.scopes.filter((sc) => String(b.scope).split(/\s+/).includes(sc)) : r.scopes;
        const asked = canonicalResource(req, b.resource);
        if (asked && r.resource && asked !== r.resource) throw new OAuthFail("invalid_target", "resource differs from the original grant");
        const out = await issueTokens({ id: g.id, wallet: g.wallet, client_id: g.client_id, scopes: narrowed.length ? narrowed : ["read"], resource: asked ?? r.resource });
        return void noStore(res).json({ access_token: out.access_token, token_type: "Bearer", expires_in: out.expires_in, refresh_token: out.refresh_token, scope: out.scope });
      }

      throw new OAuthFail("unsupported_grant_type", "Use authorization_code or refresh_token");
    } catch (e) {
      oauthError(res, e);
    }
  });

  app.post("/oauth/revoke", async (req, res) => {
    try {
      const token = str(req.body?.token) ?? "";
      if (token) await revokeToken(token);
      noStore(res).status(200).json({});
    } catch (e) {
      oauthError(res, e);
    }
  });
}
