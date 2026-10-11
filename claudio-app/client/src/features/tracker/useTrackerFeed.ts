// Live feed of tracked wallets' trades, drawn from the board's trade tapes (tokens Claudio is indexing).

import { useDeferredValue, useMemo } from "react";
import type { Trade } from "@shared/types";
import { useBoard } from "@/lib/store";
import { normAddr } from "@/lib/wallet/keys";
import { trackedIndex, useTracker, type TrackedWallet } from "./store";

export interface WalletStats {
  trades: number;
  buys: number;
  sells: number;
  buyUsd: number;
  sellUsd: number;
  lastTs?: number;
  tokens: number;
}

export interface FeedItem {
  trade: Trade;
  wallet: TrackedWallet;
}

const FEED_LIMIT = 300;

export function useTrackerFeed() {
  const wallets = useTracker((s) => s.wallets);
  const trades = useBoard((s) => s.trades);
  const deferred = useDeferredValue(trades);
  const idx = useMemo(() => trackedIndex(wallets), [wallets]);

  return useMemo(() => {
    const items: FeedItem[] = [];
    const stats = new Map<string, WalletStats>();
    const tokensPer = new Map<string, Set<string>>();
    if (idx.size === 0) return { items, stats };
    for (const key of Object.keys(deferred)) {
      for (const t of deferred[key]) {
        const n = normAddr(t.trader);
        const w = idx.get(n);
        if (!w) continue;
        items.push({ trade: t, wallet: w });
        const s = stats.get(n) ?? { trades: 0, buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, tokens: 0 };
        s.trades++;
        if (t.side === "buy") {
          s.buys++;
          s.buyUsd += t.amountUsd;
        } else {
          s.sells++;
          s.sellUsd += t.amountUsd;
        }
        s.lastTs = Math.max(s.lastTs ?? 0, t.ts);
        const set = tokensPer.get(n) ?? new Set<string>();
        set.add(t.key);
        tokensPer.set(n, set);
        s.tokens = set.size;
        stats.set(n, s);
      }
    }
    items.sort((a, b) => b.trade.ts - a.trade.ts);
    return { items: items.slice(0, FEED_LIMIT), stats };
  }, [deferred, idx]);
}
