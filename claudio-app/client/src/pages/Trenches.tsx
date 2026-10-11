// Trenches: the live board. Three resizable lanes on desktop, swipeable panes on phones.
import { useCallback, useState, type ReactNode } from "react";
import type { TokenPhase } from "@shared/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/lib/store";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { BoardColumn } from "@/features/board/BoardColumn";
import { FeedBanner } from "@/features/board/FeedBanner";
import { FilterSheet } from "@/features/board/FilterSheet";
import { MobileBoard } from "@/features/board/MobileBoard";
import { PHASES } from "@/features/board/prefs";
import { useBoardFeed } from "@/features/board/useBoardFeed";
import { useQuickBuy } from "@/features/board/useQuickBuy";
import { BoardViewBar, RankBoard, type BoardView } from "@/features/insights/RankBoard";
import type { RankInterval } from "@/features/insights/api";

export default function Trenches() {
  const chain = useSettings((s) => s.chain);
  const mobile = useIsMobile();
  const feed = useBoardFeed(chain);
  const onBuy = useQuickBuy();
  const [filterPhase, setFilterPhase] = useState<TokenPhase>("new");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<BoardView>("live");
  const [rankWindow, setRankWindow] = useState<RankInterval>("1h");
  const openFilters = useCallback((p: TokenPhase) => {
    setFilterPhase(p);
    setFiltersOpen(true);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FeedBanner chain={chain} error={feed.error} />
      {mobile ? (
        <BoardViewBar view={view} onView={setView} interval={rankWindow} onInterval={setRankWindow} className="no-scrollbar shrink-0 overflow-x-auto border-b border-line bg-bg-elev px-3 py-2" />
      ) : (
        <BoardViewBar view={view} onView={setView} interval={rankWindow} onInterval={setRankWindow} className="shrink-0 px-3 pt-3" />
      )}
      <div className="min-h-0 flex-1">
        {view !== "live" ? (
          <div className={mobile ? "h-full" : "h-full px-3 pt-2"}>
            <RankBoard kind={view} interval={rankWindow} chain={chain} onBuy={onBuy} mobile={mobile} onBack={() => setView("live")} />
          </div>
        ) : mobile ? (
          <MobileBoard chain={chain} loading={feed.loading} onBuy={onBuy} onRefresh={feed.refresh} onOpenFilters={openFilters} />
        ) : (
          <div className="h-full overflow-x-auto">
            <div className="h-full min-w-[1080px] px-3 pt-2">
              <ResizablePanelGroup direction="horizontal" autoSaveId="claudio.board.columns">
                {PHASES.map((p, i) => (
                  <PanelWithHandle key={p} index={i} id={p}>
                    <BoardColumn chain={chain} phase={p} loading={feed.loading} onBuy={onBuy} onOpenFilters={openFilters} />
                  </PanelWithHandle>
                ))}
              </ResizablePanelGroup>
            </div>
          </div>
        )}
      </div>
      <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} phase={filterPhase} chain={chain} />
    </div>
  );
}

function PanelWithHandle({ index, id, children }: { index: number; id: string; children: ReactNode }) {
  return (
    <>
      {index > 0 && (
        <ResizableHandle
          className={
            "w-3 bg-transparent before:absolute before:inset-y-10 before:left-1/2 before:w-[2px] before:-translate-x-1/2 before:rounded-full before:bg-transparent before:transition-colors " +
            "data-[resize-handle-state=hover]:before:bg-line-2 data-[resize-handle-state=drag]:before:bg-brand"
          }
        />
      )}
      <ResizablePanel id={id} order={index} defaultSize={100 / 3} minSize={22}>
        {children}
      </ResizablePanel>
    </>
  );
}
