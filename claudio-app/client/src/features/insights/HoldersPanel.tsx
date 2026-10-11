// Holders and Top traders tabs backed by /api/insights (loaded when the tab opens). Without insights they fall back to
// our own holder list / tape (the original tabs), so the page always has something real to show.
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { HolderRow, WalletIdentity, WalletTag } from "@shared/insights";
import type { Holder, TokenSnapshot, Trade } from "@shared/types";
import { HoldersTab, TopTradersTab } from "@/features/token/HoldersTab";
import { insightsKeys, useInsightHolders, useInsightTraders, useTokenScores, type ListResponse } from "./api";
import { DataNote, ScoreBlock, BreakdownBar } from "./ui";
import { TagFilter, WalletTable } from "./WalletTable";

function Loading() {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="sheen h-9 rounded-[2px] bg-panel-2" />
      ))}
    </div>
  );
}

function Shell({ top, filter, children, note }: { top?: ReactNode; filter: ReactNode; children: ReactNode; note: ReactNode }) {
  return (
    <div>
      {top}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">{filter}</div>
      </div>
      {children}
      <div className="flex items-center justify-end px-3.5 py-2">{note}</div>
    </div>
  );
}

export function InsightHoldersTab({ token, holders, mine }: { token: TokenSnapshot; holders: Holder[]; mine: Set<string> }) {
  const q = useInsightHolders(token.key, true);
  const scores = useTokenScores(token.key, true);
  const [filter, setFilter] = useState<WalletTag | null>(null);
  const rows = q.data?.data ?? null;
  if (q.isLoading) return <Loading />;
  if (!rows?.length) return <HoldersTab token={token} holders={holders} mine={mine} />;
  const hs = scores.data?.holders;
  return (
    <Shell
      top={
        hs ? (
          <div className="space-y-3 border-b border-line px-3.5 py-3">
            <ScoreBlock score={hs} label="Holders" />
            <BreakdownBar items={hs.breakdown} />
          </div>
        ) : undefined
      }
      filter={<TagFilter rows={rows} value={filter} onChange={setFilter} />}
      note={<DataNote source={q.data?.source ?? "gmgn"} partial={q.data?.partial} />}
    >
      <WalletTable rows={rows} mine={mine} mode="holders" filter={filter} />
    </Shell>
  );
}

export function InsightTradersTab({ token, holders, trades, mine }: { token: TokenSnapshot; holders: Holder[]; trades: Trade[]; mine: Set<string> }) {
  const q = useInsightTraders(token.key, true);
  const [filter, setFilter] = useState<WalletTag | null>(null);
  const rows = useMemo<HolderRow[] | null>(() => {
    const d = q.data?.data;
    if (!d?.length) return null;
    const pnl = (r: HolderRow) => (r.realizedPnlUsd ?? 0) + (r.unrealizedPnlUsd ?? 0);
    return [...d].sort((a, b) => pnl(b) - pnl(a)).map((r, i) => ({ ...r, rank: i + 1 }));
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (!rows) return <TopTradersTab token={token} holders={holders} trades={trades} mine={mine} />;
  return (
    <Shell filter={<TagFilter rows={rows} value={filter} onChange={setFilter} />} note={<DataNote source={q.data?.source ?? "gmgn"} partial={q.data?.partial} />}>
      <WalletTable rows={rows} mine={mine} mode="traders" filter={filter} />
    </Shell>
  );
}

/** address → identity, from whatever holders / traders lists are already in the cache (no fetch of its own). */
export function useIdentityMap(key: string): Map<string, WalletIdentity> {
  const qc = useQueryClient();
  // Subscribe so the map rebuilds when either list lands.
  const h = useInsightHolders(key, false).data;
  const t = useInsightTraders(key, false).data;
  return useMemo(() => {
    const map = new Map<string, WalletIdentity>();
    const add = (list?: ListResponse<HolderRow> | null) => {
      for (const r of list?.data ?? []) {
        if (!r.tags.length && !r.name && !r.tools.length) continue;
        const prev = map.get(r.address);
        map.set(r.address, prev ? { ...prev, tags: Array.from(new Set([...prev.tags, ...r.tags])), name: prev.name ?? r.name } : r);
      }
    };
    add(h ?? qc.getQueryData(insightsKeys.holders(key)));
    add(t ?? qc.getQueryData(insightsKeys.traders(key)));
    return map;
  }, [h, t, qc, key]);
}
