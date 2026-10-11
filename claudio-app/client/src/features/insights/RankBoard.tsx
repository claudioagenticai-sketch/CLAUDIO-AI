// Trenches "Trending" and "Hot" views: board-shaped cards from /api/insights/trending | /hot (GMGN ranks), with a time
// window. Same TokenCard as the live lanes. Desktop: a dense 3-column grid; phones: the mobile card list.
import { useMemo } from "react";
import type { ChainId } from "@shared/chains";
import { Empty } from "@/components/kit";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useColumnAmount, useColumnPreset } from "@/features/board/prefs";
import { TokenCard, TokenCardSkeleton } from "@/features/board/TokenCard";
import { useOpenToken } from "@/features/board/useColumn";
import type { QuickBuyFn } from "@/features/board/useQuickBuy";
import { useRankBoard, type RankInterval } from "./api";
import { DataNote } from "./ui";

export type BoardView = "live" | "trending" | "hot";

export const VIEW_LABEL: Record<BoardView, string> = { live: "Live", trending: "Trending", hot: "Hot" };
const INTERVALS: RankInterval[] = ["5m", "1h", "6h", "24h"];

/** Segmented control: Live · Trending · Hot (+ window for the ranked views). */
export function BoardViewBar({
  view,
  onView,
  interval,
  onInterval,
  size = "sm",
  className,
}: {
  view: BoardView;
  onView: (v: BoardView) => void;
  interval: RankInterval;
  onInterval: (i: RankInterval) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const h = size === "md" ? "h-9 text-[11.5px]" : "h-8 text-[11px]";
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div role="tablist" aria-label="Board view" className="inline-flex shrink-0 rounded-[3px] p-[3px] ring-1 ring-inset ring-line-2">
        {(Object.keys(VIEW_LABEL) as BoardView[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onView(v)}
            className={cn("rounded-[2px] px-3 font-mono uppercase tracking-[0.1em] transition-colors", h, view === v ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2")}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      {view !== "live" && (
        <div role="group" aria-label="Time window" className="inline-flex shrink-0 rounded-[3px] p-[3px] ring-1 ring-inset ring-line-2">
          {INTERVALS.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => onInterval(i)}
              className={cn("num rounded-[2px] px-2 font-medium transition-colors", h, interval === i ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2")}
            >
              {i}
            </button>
          ))}
        </div>
      )}
      {view !== "live" && <DataNote className="ml-auto hidden shrink-0 sm:inline-flex" />}
    </div>
  );
}

export function RankBoard({
  kind,
  interval,
  chain,
  onBuy,
  mobile,
  onBack,
}: {
  kind: "trending" | "hot";
  interval: RankInterval;
  chain: ChainId;
  onBuy: QuickBuyFn;
  mobile: boolean;
  onBack: () => void;
}) {
  const q = useRankBoard(kind, interval, chain === "sol");
  const watchlist = useSettings((s) => s.watchlist);
  const watched = useMemo(() => new Set(watchlist), [watchlist]);
  const onOpen = useOpenToken();
  const amounts = { new: useColumnAmount("new", chain), almost: useColumnAmount("almost", chain), migrated: useColumnAmount("migrated", chain) };
  const presets = { new: useColumnPreset("new"), almost: useColumnPreset("almost"), migrated: useColumnPreset("migrated") };
  const rows = q.data ?? [];
  const variant = mobile ? "mobile" : "row";

  if (chain !== "sol" || (!q.isLoading && !rows.length)) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center", mobile ? "px-3" : "")}>
        <Empty
          title={chain !== "sol" ? `${kind === "hot" ? "Hot" : "Trending"} is Solana only for now` : `${kind === "hot" ? "Hot" : "Trending"} isn't available right now`}
          hint={chain !== "sol" ? "Switch the chain to Solana to see it." : "The live board keeps streaming new coins in the meantime."}
        />
        <button type="button" onClick={onBack} className="btn btn-secondary">
          Back to the live board
        </button>
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-y-auto overscroll-contain", mobile ? "pb-4 pt-3" : "pb-3")}>
      <div className={mobile ? "" : "grid grid-cols-2 gap-1.5 xl:grid-cols-3"}>
        {q.isLoading && !rows.length
          ? Array.from({ length: mobile ? 5 : 9 }, (_, i) => <TokenCardSkeleton key={i} variant={variant} />)
          : rows.map((t) => (
              <TokenCard
                key={t.key}
                token={t}
                amount={amounts[t.phase] ?? amounts.new}
                preset={presets[t.phase] ?? presets.new}
                variant={variant}
                watched={watched.has(t.key)}
                onBuy={onBuy}
                onOpen={onOpen}
              />
            ))}
      </div>
      {mobile && rows.length > 0 && <DataNote className="mt-1 flex justify-center" />}
    </div>
  );
}
