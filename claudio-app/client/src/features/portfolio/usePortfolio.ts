// Portfolio model: on-chain balances for the ACTIVE wallets + PnL estimates from local trade history.

import { useMemo } from "react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { CHAINS, type ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import type { TokenSnapshot } from "@shared/types";
import { useBoard, useSettings } from "@/lib/store";
import { useHistory, type HistoryTrade } from "@/lib/history";
import { useActiveAccount, useNativeBalance } from "@/lib/wallet";
import { fetchEvmTokenBalances, fetchSolTokenBalances, type TokenBalances } from "@/lib/wallet/balance";
import { normAddr } from "@/lib/wallet/keys";
import { chainQueryable } from "@/lib/wallet/rpc";

export interface Position {
  key: string;
  chain: ChainId;
  address: string;
  symbol: string;
  name?: string;
  image?: string;
  launchpad?: LaunchpadId;
  watched: boolean;
  /** On-chain balance (undefined = not loaded / unreadable). */
  balance?: number;
  /** Balance used for valuation: on-chain if known, else net qty from history. */
  held: number;
  priceUsd: number;
  valueUsd: number;
  change1hPct?: number;
  // History-derived (estimates)
  buys: number;
  sells: number;
  avgCostUsd?: number;
  investedUsd: number;
  realizedUsd: number;
  unrealizedUsd?: number;
  unrealizedPct?: number;
  lastTradeAt?: number;
}

export interface NativeHolding {
  chain: ChainId;
  balance?: number;
  usd?: number;
}

function splitKey(key: string): { chain: ChainId; address: string } | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const chain = key.slice(0, i) as ChainId;
  if (!CHAINS[chain]) return null;
  return { chain, address: key.slice(i + 1) };
}

async function fetchToken(key: string): Promise<TokenSnapshot | null> {
  const res = await fetch(`/api/token/${encodeURIComponent(key)}`, { credentials: "include" });
  if (!res.ok) return null;
  const j = (await res.json()) as unknown;
  if (j && typeof j === "object" && "token" in j) return (j as { token: TokenSnapshot }).token ?? null;
  return (j as TokenSnapshot) ?? null;
}

interface Acc {
  qty: number;
  cost: number;
  realized: number;
  invested: number;
  buys: number;
  sells: number;
  last: number;
  symbol: string;
}

/** Average-cost PnL from local history (USD, using the token price recorded at send time). */
function pnlFromHistory(trades: HistoryTrade[]): Map<string, Acc> {
  const out = new Map<string, Acc>();
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);
  for (const t of sorted) {
    if (t.status === "failed") continue;
    const a = out.get(t.key) ?? { qty: 0, cost: 0, realized: 0, invested: 0, buys: 0, sells: 0, last: 0, symbol: t.symbol };
    const usd = t.amountToken * t.priceUsd;
    if (t.side === "buy") {
      a.qty += t.amountToken;
      a.cost += usd;
      a.invested += usd;
      a.buys++;
    } else {
      a.sells++;
      if (a.qty > 0) {
        const sold = Math.min(t.amountToken, a.qty);
        const avg = a.cost / a.qty;
        a.realized += sold * t.priceUsd - sold * avg;
        a.cost -= avg * sold;
        a.qty -= sold;
      }
    }
    a.last = Math.max(a.last, t.ts);
    a.symbol = t.symbol || a.symbol;
    out.set(t.key, a);
  }
  return out;
}

export function usePortfolio() {
  const evm = useActiveAccount("evm");
  const sol = useActiveAccount("svm");
  const history = useHistory((s) => s.trades);
  const watchlist = useSettings((s) => s.watchlist);
  const boardTokens = useBoard((s) => s.tokens);
  const status = useBoard((s) => s.status);

  const mine = useMemo(() => new Set([evm?.address, sol?.address].filter((x): x is string => !!x).map(normAddr)), [evm?.address, sol?.address]);
  const myTrades = useMemo(() => history.filter((t) => mine.has(normAddr(t.wallet))), [history, mine]);

  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const t of myTrades) set.add(t.key);
    for (const k of watchlist) set.add(k);
    return Array.from(set).filter((k) => {
      const p = splitKey(k);
      return !!p && CHAINS[p.chain].enabled;
    });
  }, [myTrades, watchlist]);

  // ── On-chain token balances ──
  const evmChains = useMemo(() => {
    const m = new Map<ChainId, string[]>();
    for (const k of keys) {
      const p = splitKey(k);
      if (!p || CHAINS[p.chain].kind !== "evm") continue;
      m.set(p.chain, [...(m.get(p.chain) ?? []), p.address]);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [keys]);

  const evmQueries = useQueries({
    queries: evmChains.map(([chain, tokens]) => ({
      queryKey: ["portfolio", "evm", chain, evm?.address ?? "", tokens.slice().sort().join(",")],
      queryFn: () => fetchEvmTokenBalances(chain, evm?.address as string, tokens),
      enabled: !!evm && chainQueryable(chain),
      refetchInterval: 30_000,
      staleTime: 20_000,
      retry: 1,
    })),
  });

  const hasSolKeys = keys.some((k) => k.startsWith("sol:"));
  const solQuery = useQuery({
    queryKey: ["portfolio", "sol", sol?.address ?? ""],
    queryFn: () => fetchSolTokenBalances(sol?.address as string),
    enabled: !!sol && hasSolKeys && chainQueryable("sol"),
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: 1,
  });

  const balances = new Map<ChainId, TokenBalances>();
  evmChains.forEach(([chain], i) => {
    const d = evmQueries[i]?.data;
    if (d) balances.set(chain, d);
  });
  if (solQuery.data) balances.set("sol", solQuery.data);

  // ── Prices: live board first, REST fallback for tokens the board isn't carrying ──
  const missing = useMemo(() => keys.filter((k) => !boardTokens[k]), [keys, boardTokens]);
  const fallback = useQueries({
    queries: missing.map((k) => ({
      queryKey: ["portfolio", "token", k],
      queryFn: () => fetchToken(k),
      staleTime: 30_000,
      refetchInterval: 60_000,
      retry: false,
    })),
  });
  const fallbackMap = new Map<string, TokenSnapshot>();
  missing.forEach((k, i) => {
    const d = fallback[i]?.data;
    if (d) fallbackMap.set(k, d);
  });

  const pnl = useMemo(() => pnlFromHistory(myTrades), [myTrades]);

  const positions: Position[] = keys.map((key) => {
    const p = splitKey(key) as { chain: ChainId; address: string };
    const tok = boardTokens[key] ?? fallbackMap.get(key);
    const acc = pnl.get(key);
    const bals = balances.get(p.chain);
    const balKey = CHAINS[p.chain].kind === "evm" ? p.address.toLowerCase() : p.address;
    const balance = bals ? (bals[balKey] ?? (CHAINS[p.chain].kind === "svm" ? 0 : undefined)) : undefined;
    const held = balance ?? Math.max(0, acc?.qty ?? 0);
    const priceUsd = tok?.priceUsd ?? 0;
    const avg = acc && acc.qty > 0 ? acc.cost / acc.qty : undefined;
    const unrealizedUsd = avg !== undefined && held > 0 && priceUsd > 0 ? held * priceUsd - held * avg : undefined;
    const basis = avg !== undefined ? avg * held : 0;
    return {
      key,
      chain: p.chain,
      address: p.address,
      symbol: tok?.symbol ?? acc?.symbol ?? p.address.slice(0, 4),
      name: tok?.name,
      image: tok?.image,
      launchpad: tok?.launchpad,
      watched: watchlist.includes(key),
      balance,
      held,
      priceUsd,
      valueUsd: held * priceUsd,
      change1hPct: tok?.change1hPct,
      buys: acc?.buys ?? 0,
      sells: acc?.sells ?? 0,
      avgCostUsd: avg,
      investedUsd: acc?.invested ?? 0,
      realizedUsd: acc?.realized ?? 0,
      unrealizedUsd,
      unrealizedPct: unrealizedUsd !== undefined && basis > 0 ? (unrealizedUsd / basis) * 100 : undefined,
      lastTradeAt: acc?.last,
    };
  });
  positions.sort((a, b) => b.valueUsd - a.valueUsd || (b.lastTradeAt ?? 0) - (a.lastTradeAt ?? 0));

  // ── Native balances ──
  const hood = useNativeBalance("hood", evm?.address);
  const bsc = useNativeBalance("bsc", evm?.address);
  const solBal = useNativeBalance("sol", sol?.address);
  const natives: NativeHolding[] = [
    { chain: "hood" as ChainId, balance: hood.balance },
    { chain: "bsc" as ChainId, balance: bsc.balance },
    { chain: "sol" as ChainId, balance: solBal.balance },
  ]
    .filter((n) => CHAINS[n.chain].enabled)
    .map((n) => {
      const px = status[n.chain]?.nativeUsd;
      return { ...n, usd: n.balance !== undefined && px ? n.balance * px : undefined };
    });

  const tokensUsd = positions.reduce((s, p) => s + p.valueUsd, 0);
  const nativeUsd = natives.reduce((s, n) => s + (n.usd ?? 0), 0);
  const realizedUsd = positions.reduce((s, p) => s + p.realizedUsd, 0);
  const unrealizedUsd = positions.reduce((s, p) => s + (p.unrealizedUsd ?? 0), 0);
  const investedUsd = positions.reduce((s, p) => s + p.investedUsd, 0);

  const loading = evmQueries.some((q: UseQueryResult<TokenBalances>) => q.isLoading && q.fetchStatus !== "idle") || (solQuery.isLoading && solQuery.fetchStatus !== "idle");
  const error = evmQueries.some((q: UseQueryResult<TokenBalances>) => q.isError) || solQuery.isError;

  return {
    evm,
    sol,
    positions,
    natives,
    totals: { tokensUsd, nativeUsd, totalUsd: tokensUsd + nativeUsd, realizedUsd, unrealizedUsd, pnlUsd: realizedUsd + unrealizedUsd, investedUsd },
    loading,
    error,
    refetch: () => {
      evmQueries.forEach((q: UseQueryResult<TokenBalances>) => void q.refetch());
      void solQuery.refetch();
    },
  };
}
