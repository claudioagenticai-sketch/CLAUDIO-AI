// Data hooks for the trade panel: route support, token balance, debounced live quote.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TokenSnapshot } from "@shared/types";
import { quoteEx, routeInfo, tokenBalance, TradeApiError, type RouteInfo, type TradeQuoteEx } from "@/lib/trade-impl";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useRouteInfo(token: TokenSnapshot) {
  return useQuery<RouteInfo, TradeApiError>({
    queryKey: ["trade-route", token.key, token.phase],
    queryFn: () => routeInfo(token),
    staleTime: 30_000,
    retry: (n, e) => e.status >= 500 && e.status !== 501 && n < 2,
  });
}

export function useTokenBalance(token: TokenSnapshot, owner: string | undefined) {
  return useQuery<number, TradeApiError>({
    queryKey: ["trade-balance", token.key, owner ?? ""],
    queryFn: () => tokenBalance(token, owner as string),
    enabled: !!owner,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useTradeQuote(opts: {
  token: TokenSnapshot;
  side: "buy" | "sell";
  amount: number;
  trader?: string;
  slippageBps: number;
  enabled: boolean;
}) {
  const { token, side, trader, slippageBps } = opts;
  const amount = useDebounced(opts.amount, 280);
  const enabled = opts.enabled && Number.isFinite(amount) && amount > 0 && (side === "buy" || !!trader);
  const q = useQuery<TradeQuoteEx, TradeApiError>({
    queryKey: ["trade-quote", token.key, side, amount, trader ?? "", slippageBps],
    queryFn: () => quoteEx(token, side, amount, trader, slippageBps),
    enabled,
    refetchInterval: 8_000,
    // Keep the previous quote while typing, but never show a buy quote under Sell (different units).
    placeholderData: (prev, prevQuery) => (prevQuery && prevQuery.queryKey[2] === side ? prev : undefined),
    retry: false,
  });
  return { ...q, debouncing: amount !== opts.amount, enabled };
}
