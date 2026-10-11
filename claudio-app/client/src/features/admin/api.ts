// Admin REST client (server: server/platform + the agents/hosted workstreams). Every call sends the session cookie.
// A 403 admin_required (expired 2 h admin step) re-reads the session so the page drops back to the password step.
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type {
  AdminAuditEvent,
  AdminChainRow,
  AdminCollectorDetail,
  AdminLaunchpadRow,
  AdminOverview,
  ChainSwitchState,
  CollectorRunSummary,
  SplConfigRow,
  SwitchState,
} from "@shared/platform";
import { queryClient } from "@/lib/queryClient";
import { SESSION_KEY } from "@/lib/session";

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** The endpoint isn't built / deployed yet (other workstreams). */
  get unavailable(): boolean {
    return this.status === 404 || this.status === 501 || this.code === "not_json";
  }
}

async function call<T>(method: "GET" | "PUT" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AdminApiError("Network error — is the server reachable?", 0, "network");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // Unknown /api routes fall through to the SPA (HTML) in dev; treat as "not built yet".
    throw new AdminApiError(res.ok ? "Unexpected response" : res.statusText || `HTTP ${res.status}`, res.ok ? 404 : res.status, "not_json");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 403 && json.error === "admin_required") void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    throw new AdminApiError(json.message || res.statusText || `HTTP ${res.status}`, res.status, json.error || "http");
  }
  return json as T;
}

export interface SplConfigResponse {
  token: SplConfigRow;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export const adminApi = {
  overview: () => call<AdminOverview>("GET", "/api/admin/overview"),
  chains: () => call<{ chains: AdminChainRow[] }>("GET", "/api/admin/chains"),
  putChain: (b: { chain: string; state: ChainSwitchState; note: string | null }) => call<{ chain: AdminChainRow }>("PUT", "/api/admin/chains", b),
  launchpads: () => call<{ launchpads: AdminLaunchpadRow[] }>("GET", "/api/admin/launchpads"),
  putLaunchpad: (b: { launchpad: string; chain: string; state: SwitchState; allowAgents: boolean; note: string | null }) =>
    call<{ launchpad: AdminLaunchpadRow }>("PUT", "/api/admin/launchpads", b),
  splConfig: () => call<SplConfigResponse>("GET", "/api/admin/spl-config"),
  putSplConfig: (b: { mint: string; symbol: string; name: string; decimals: number }) => call<SplConfigResponse>("PUT", "/api/admin/spl-config", b),
  collector: () => call<AdminCollectorDetail>("GET", "/api/admin/collector"),
  runCollector: () => call<{ run: CollectorRunSummary }>("POST", "/api/admin/collector/run", {}),
  audit: (action: string, limit: number) =>
    call<{ events: AdminAuditEvent[] }>("GET", `/api/admin/audit?action=${encodeURIComponent(action)}&limit=${limit}`),
  // Other workstreams — shapes not fixed yet, read loosely.
  agents: () => call<unknown>("GET", "/api/admin/agents"),
  putAgent: (slug: string, b: { status?: string; tier?: string; verifySocial?: { platform: string; verified: boolean } }) =>
    call<unknown>("PUT", `/api/admin/agents/${encodeURIComponent(slug)}`, b),
  thread: () => call<unknown>("GET", "/api/admin/thread"),
  putThread: (b: { outsidePosting?: boolean; rooms?: Record<string, boolean> }) => call<unknown>("PUT", "/api/admin/thread", b),
  hosted: () => call<unknown>("GET", "/api/admin/hosted"),
  cloud: () => call<{ enabled: boolean; updatedBy: string | null; updatedAt: string | null; llm: string; dailyMessages: number }>("GET", "/api/admin/cloud"),
  putCloud: (enabled: boolean) => call<{ enabled: boolean }>("PUT", "/api/admin/cloud", { enabled }),
};

export const ADMIN_KEY = ["admin"] as const;

/** react-query wrapper: never retries auth / missing-endpoint errors. */
export function useAdminQuery<T>(key: readonly unknown[], fn: () => Promise<T>, opts: Omit<UseQueryOptions<T, AdminApiError>, "queryKey" | "queryFn"> = {}) {
  return useQuery<T, AdminApiError>({
    queryKey: [...ADMIN_KEY, ...key],
    queryFn: fn,
    retry: (n, e) => !(e instanceof AdminApiError && (e.status === 403 || e.status === 401 || e.unavailable)) && n < 1,
    staleTime: 10_000,
    ...opts,
  });
}

export function invalidateAdmin(...key: unknown[]) {
  return queryClient.invalidateQueries({ queryKey: [...ADMIN_KEY, ...key] });
}

/** Pulls a list out of `T[]`, `{ agents: T[] }`, `{ data: T[] }`, `{ items: T[] }` or `{ <key>: T[] }`. */
export function asList<T = Record<string, unknown>>(v: unknown, ...keys: string[]): T[] | null {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") {
    for (const k of [...keys, "data", "items", "list"]) {
      const x = (v as Record<string, unknown>)[k];
      if (Array.isArray(x)) return x as T[];
    }
  }
  return null;
}
