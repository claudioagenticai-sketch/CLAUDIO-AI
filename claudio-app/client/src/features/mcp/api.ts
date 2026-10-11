// REST client for the /connect and /confirm pages (server: server/mcp). Same error shape as the rest of the site:
// `{ error, message }` → McpApiError.

export class McpApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "McpApiError";
    this.status = status;
    this.code = code;
  }
}

export async function mcpCall<T>(method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new McpApiError(0, "network", "Can't reach Claudio. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new McpApiError(res.status, json.error ?? `http_${res.status}`, json.message ?? `Request failed (${res.status})`);
  return json as T;
}

// ─── OAuth consent ─────────────────────────────────────────────────

export interface AuthRequestInfo {
  id: string;
  client: { id: string; name: string; uri: string | null; logoUri: string | null; kind: "first_party" | "metadata_document" | "registered"; redirectHost: string };
  scopes: string[];
  resource: string | null;
  expiresAt: string;
}

export const oauthApi = {
  request: (id: string) => mcpCall<AuthRequestInfo>("GET", `/api/oauth/request/${encodeURIComponent(id)}`),
  approve: (id: string, scopes: string[], agentSlug?: string) =>
    mcpCall<{ redirect: string }>("POST", `/api/oauth/request/${encodeURIComponent(id)}/approve`, { scopes, ...(agentSlug ? { agentSlug } : {}) }),
  deny: (id: string) => mcpCall<{ redirect: string }>("POST", `/api/oauth/request/${encodeURIComponent(id)}/deny`, {}),
};

// ─── connections + keys ────────────────────────────────────────────

export interface Grant {
  id: string;
  clientName: string;
  clientId: string;
  scopes: string[];
  agentSlug: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface McpKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  agentSlug: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface Connections {
  wallet: string;
  grants: Grant[];
  keys: McpKey[];
  watchlistShared: boolean;
  watchlistCount: number;
}

export const connectApi = {
  connections: () => mcpCall<Connections>("GET", "/api/mcp/connections"),
  createKey: (input: { name: string; scopes: string[]; agentSlug?: string; expiresInDays?: number }) =>
    mcpCall<McpKey & { key: string }>("POST", "/api/mcp/keys", input),
  revokeKey: (id: string) => mcpCall<{ ok: true }>("DELETE", `/api/mcp/keys/${encodeURIComponent(id)}`),
  revokeGrant: (id: string) => mcpCall<{ ok: true }>("DELETE", `/api/mcp/grants/${encodeURIComponent(id)}`),
  shareWatchlist: (keys: string[]) => mcpCall<{ ok: true; count: number }>("PUT", "/api/mcp/watchlist", { keys: keys.slice(0, 200) }),
  stopWatchlist: () => mcpCall<{ ok: true }>("DELETE", "/api/mcp/watchlist"),
};

// ─── prepared trades / launches ────────────────────────────────────

export type PreparedStatus = "pending" | "signed" | "confirmed" | "failed" | "expired";

export interface TradeParams {
  key: string;
  side: "buy" | "sell";
  amountSol?: number;
  percent?: number;
  slippageBps: number;
}

export interface LaunchParams {
  name: string;
  symbol: string;
  imageUri: string;
  description?: string;
  socials: { twitter?: string; telegram?: string; website?: string };
  devBuySol: number;
  slippageBps: number;
}

export interface Prepared {
  id: string;
  kind: "trade" | "launch";
  status: PreparedStatus;
  wallet: string;
  createdAt: string;
  expiresAt: string;
  clientName: string | null;
  params: TradeParams | LaunchParams;
  summary: { kind: string; side?: string; symbol?: string; lines: [string, string][] };
  signatures: string[];
  mint: string | null;
  error: string | null;
}

export const preparedApi = {
  get: (id: string) => mcpCall<Prepared>("GET", `/api/mcp/prepared/${encodeURIComponent(id)}`),
  result: (id: string, body: { signatures: string[]; mint?: string; launchId?: string; error?: string }) =>
    mcpCall<{ status: PreparedStatus }>("POST", `/api/mcp/prepared/${encodeURIComponent(id)}/result`, body),
};

export function mcpUrls(): { data: string; trade: string } {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://useclaudio.xyz";
  return { data: `${origin}/mcp/data`, trade: `${origin}/mcp/trade` };
}
