// Token page data: REST detail (react-query) + live WS snapshot/trades merged on top.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChainId } from "@shared/chains";
import { CHAINS } from "@shared/chains";
import type { TokenDetail, TokenSnapshot, Trade, TraderTag } from "@shared/types";
import { useBoard } from "@/lib/store";
import { socket } from "@/lib/ws";
import { useWallet } from "@/lib/wallet";
import { useHistory, type HistoryTrade } from "@/lib/history";

export class TokenNotFoundError extends Error {
  constructor() {
    super("Token not found");
    this.name = "TokenNotFoundError";
  }
}

const EMPTY_TRADES: Trade[] = [];

async function fetchDetail(key: string): Promise<TokenDetail> {
  const res = await fetch(`/api/token/${encodeURIComponent(key)}`, { credentials: "include" });
  if (res.status === 404) throw new TokenNotFoundError();
  if (!res.ok) throw new Error(`Failed to load token (${res.status})`);
  return (await res.json()) as TokenDetail;
}

/** Normalizes an address for comparisons (EVM is case-insensitive, base58 is not). */
export function addrKey(chain: ChainId, a: string): string {
  return CHAINS[chain].kind === "evm" ? a.toLowerCase() : a;
}

/** Addresses of the user's own wallets for this chain kind (for "you" tags). */
export function useMyAddresses(chain: ChainId): Set<string> {
  const accounts = useWallet((s) => s.accounts);
  return useMemo(() => {
    const kind = CHAINS[chain].kind;
    return new Set(accounts.filter((a) => a.kind === kind).map((a) => addrKey(chain, a.address)));
  }, [accounts, chain]);
}

export interface TokenData {
  key: string;
  token?: TokenSnapshot;
  detail?: TokenDetail;
  trades: Trade[];
  myTrades: HistoryTrade[];
  mine: Set<string>;
  isLoading: boolean;
  notFound: boolean;
  error?: Error;
  refetch: () => void;
}

export function useTokenData(chain: ChainId, address: string, enabled = true): TokenData {
  // Server keys are `${chain}:${address}` with EVM addresses lowercased.
  const key = `${chain}:${addrKey(chain, address)}`;

  const q = useQuery<TokenDetail, Error>({
    queryKey: ["token-detail", key],
    queryFn: () => fetchDetail(key),
    refetchInterval: (query) => (query.state.error instanceof TokenNotFoundError ? 8_000 : 30_000),
    retry: (count, err) => !(err instanceof TokenNotFoundError) && count < 2,
    enabled: enabled && !!address,
  });

  useEffect(() => (enabled ? socket.subscribe([`token:${key}`, `trades:${key}`]) : undefined), [key, enabled]);

  const live = useBoard((s) => s.tokens[key]);
  const liveTrades = useBoard((s) => s.trades[key]) ?? EMPTY_TRADES;
  const mine = useMyAddresses(chain);
  const allHistory = useHistory((s) => s.trades);
  const myTrades = useMemo(() => allHistory.filter((t) => t.key === key), [allHistory, key]);

  const token = useMemo<TokenSnapshot | undefined>(() => {
    const d = q.data;
    if (!d && !live) return undefined;
    if (!d) return live;
    if (!live) return d;
    // Live snapshot wins when it's at least as fresh; detail-only fields survive the spread.
    return live.updatedAt >= d.updatedAt ? { ...d, ...live } : d;
  }, [q.data, live]);

  const trades = useMemo<Trade[]>(() => {
    const seen = new Set<string>();
    const out: Trade[] = [];
    const push = (t: Trade) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      const isMine = mine.has(addrKey(chain, t.trader));
      out.push(isMine && !t.tags.includes("you") ? { ...t, tags: ["you" as TraderTag, ...t.tags] } : t);
    };
    liveTrades.forEach(push);
    (q.data?.recentTrades ?? EMPTY_TRADES).forEach(push);
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [liveTrades, q.data?.recentTrades, mine, chain]);

  return {
    key,
    token,
    detail: q.data,
    trades,
    myTrades,
    mine,
    isLoading: q.isLoading && !live,
    notFound: q.error instanceof TokenNotFoundError && !live,
    error: q.error && !(q.error instanceof TokenNotFoundError) ? q.error : undefined,
    refetch: () => void q.refetch(),
  };
}

/** `(min-width: …)` media query as state. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState<boolean>(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}
