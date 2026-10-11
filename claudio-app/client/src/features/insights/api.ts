// Client for /api/insights/* (contract: shared/insights.ts + docs/API.md "Insights"). The server talks to GMGN; the browser
// never does. Every endpoint is optional: a 404 / 501 / 503 (or the SPA's HTML fallback while the module isn't deployed)
// resolves to `null`, so pages render with our own data and simply leave the GMGN parts out.
// Dev only: `localStorage.setItem("claudio.fixtures", "1")` serves recorded samples from ./fixtures (the import sits
// behind `import.meta.env.DEV`, so it never reaches a production bundle).
import { useQuery } from "@tanstack/react-query";
import type { ChainId } from "@shared/chains";
import type {
  DevProfile,
  FeedSignal,
  FeedTrade,
  HolderRow,
  InsightSource,
  InsightsStatus,
  TokenInsights,
  TokenScores,
  TraderRow,
  WalletProfile,
} from "@shared/insights";
import type { TokenSnapshot } from "@shared/types";

export interface ListResponse<T> {
  data: T[];
  updatedAt?: number;
  source?: InsightSource;
  partial?: string | null;
}

/** Wallet profile plus the optional recent activity some backends attach. */
export type WalletProfileView = WalletProfile & { recent?: FeedTrade[] | null; xFollowers?: number | null };

export function insightsFixturesOn(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem("claudio.fixtures") === "1";
  } catch {
    return false;
  }
}

type FixtureFn = (path: string) => unknown | null;
let fixtureFn: Promise<FixtureFn> | null = null;
function loadFixtures(): Promise<FixtureFn> {
  fixtureFn ??= import.meta.env.DEV
    ? import("./fixtures").then((m) => (path: string) => m.insightsFixture(path))
    : Promise.reject(new Error("fixtures are dev-only"));
  return fixtureFn;
}

/** GET an insights endpoint. `null` = not available (not deployed, unknown token, GMGN off). Throws only on network errors. */
export async function getInsights<T>(path: string): Promise<T | null> {
  if (import.meta.env.DEV && insightsFixturesOn()) {
    const fn = await loadFixtures();
    await new Promise((r) => setTimeout(r, 180));
    return (fn(path) as T | null) ?? null;
  }
  const res = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  // 404 / 501 / 503 / 429 or HTML: treat as "not available right now"; the page keeps our own data.
  if (!res.ok || !json) return null;
  return ((await res.json().catch(() => null)) as T | null) ?? null;
}

const enc = encodeURIComponent;
const base = { retry: 1, refetchOnWindowFocus: false } as const;

export const insightsKeys = {
  token: (key: string) => ["insights", "token", key] as const,
  holders: (key: string) => ["insights", "holders", key] as const,
  traders: (key: string) => ["insights", "traders", key] as const,
  dev: (key: string) => ["insights", "dev", key] as const,
  scores: (key: string) => ["insights", "scores", key] as const,
  wallet: (chain: string, address: string) => ["insights", "wallet", chain, address] as const,
};

/** Fast set: info + security + pool + signals + dev summary. */
export function useTokenInsights(key: string | undefined, enabled = true) {
  return useQuery<TokenInsights | null>({
    ...base,
    queryKey: insightsKeys.token(key ?? ""),
    queryFn: () => getInsights<TokenInsights>(`/api/insights/token/${enc(key!)}`),
    enabled: enabled && !!key,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useInsightHolders(key: string, enabled: boolean) {
  return useQuery<ListResponse<HolderRow> | null>({
    ...base,
    queryKey: insightsKeys.holders(key),
    queryFn: () => getInsights<ListResponse<HolderRow>>(`/api/insights/token/${enc(key)}/holders?limit=100`),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
  });
}

export function useInsightTraders(key: string, enabled: boolean) {
  return useQuery<ListResponse<TraderRow> | null>({
    ...base,
    queryKey: insightsKeys.traders(key),
    queryFn: () => getInsights<ListResponse<TraderRow>>(`/api/insights/token/${enc(key)}/traders?limit=100`),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
  });
}

export function useDevProfile(key: string, enabled: boolean) {
  return useQuery<DevProfile | null>({
    ...base,
    queryKey: insightsKeys.dev(key),
    queryFn: () => getInsights<DevProfile>(`/api/insights/token/${enc(key)}/dev`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Scores are shared by the safety panel, the holders tab and the chart-pattern chip; pass `enabled` from whoever needs it. */
export function useTokenScores(key: string, enabled: boolean) {
  return useQuery<TokenScores | null>({
    ...base,
    queryKey: insightsKeys.scores(key),
    queryFn: () => getInsights<TokenScores>(`/api/insights/token/${enc(key)}/scores`),
    enabled,
    staleTime: 2 * 60_000,
  });
}

export function useWalletProfile(chain: ChainId, address: string | undefined) {
  return useQuery<WalletProfileView | null>({
    ...base,
    queryKey: insightsKeys.wallet(chain, address ?? ""),
    queryFn: () => getInsights<WalletProfileView>(`/api/insights/wallet/${chain}/${enc(address!)}`),
    enabled: !!address,
    staleTime: 2 * 60_000,
  });
}

export function useTradeFeed(kind: "kol" | "smart", enabled = true, side?: "buy" | "sell") {
  return useQuery<ListResponse<FeedTrade> | null>({
    ...base,
    queryKey: ["insights", "feed", kind, side ?? "all"],
    queryFn: () => getInsights<ListResponse<FeedTrade>>(`/api/insights/feed/${kind}?chain=sol${side ? `&side=${side}` : ""}`),
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useSignalFeed(enabled = true) {
  return useQuery<ListResponse<FeedSignal> | null>({
    ...base,
    queryKey: ["insights", "feed", "signals"],
    queryFn: () => getInsights<ListResponse<FeedSignal>>(`/api/insights/feed/signals?chain=sol`),
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export type RankInterval = "5m" | "1h" | "6h" | "24h";

export function useRankBoard(kind: "trending" | "hot", interval: RankInterval, enabled: boolean) {
  return useQuery<TokenSnapshot[] | null>({
    ...base,
    queryKey: ["insights", kind, interval],
    queryFn: async () => (await getInsights<ListResponse<TokenSnapshot>>(`/api/insights/${kind}?chain=sol&interval=${interval}`))?.data ?? null,
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useInsightsStatus(enabled = true) {
  return useQuery<InsightsStatus | null>({
    ...base,
    queryKey: ["insights", "status"],
    queryFn: () => getInsights<InsightsStatus>(`/api/insights/status`),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}
