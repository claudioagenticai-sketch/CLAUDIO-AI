// Phone board: underline phase tabs with counts + horizontally swipeable columns (CSS scroll-snap),
// pull-to-refresh per pane, and "pause while touching" so rows never shift under a thumb.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import type { ChainId } from "@shared/chains";
import type { TokenPhase } from "@shared/types";
import { haptic, useSettings, useUI } from "@/lib/store";
import { cn } from "@/lib/utils";
import { LaneEmpty, PHASE_ACCENT } from "./BoardColumn";
import { ColumnPresetToggle, FilterButton, PausedPill, QuickBuyChip, SoundToggle } from "./ColumnControls";
import { PHASES, PHASE_META, useBoardPrefs, useColumnAmount, useColumnPreset } from "./prefs";
import { TokenCard, TokenCardSkeleton } from "./TokenCard";
import { useArrivalSound, useColumn, useOpenToken, type ColumnData } from "./useColumn";
import { usePausable } from "./usePausable";
import type { QuickBuyFn } from "./useQuickBuy";

const PULL_TRIGGER = 64;
const PULL_MAX = 96;

function MobilePane({
  chain,
  phase,
  data,
  loading,
  onBuy,
  onRefresh,
}: {
  chain: ChainId;
  phase: TokenPhase;
  data: ColumnData;
  loading: boolean;
  onBuy: QuickBuyFn;
  onRefresh: () => Promise<void>;
}) {
  const pauseOnHover = useSettings((s) => s.pauseOnHover);
  const watchlist = useSettings((s) => s.watchlist);
  const soundOn = useBoardPrefs((s) => s.columns[phase]?.sound === true);
  const amount = useColumnAmount(phase, chain);
  const preset = useColumnPreset(phase);
  const onOpen = useOpenToken();
  const listRef = useRef<HTMLDivElement>(null);

  // Pause while a finger is on the list (and briefly after, to cover momentum scroll).
  const [touching, setTouching] = useState(false);
  const releaseTimer = useRef<number | undefined>(undefined);
  const { rows, paused, queued } = usePausable(data.rows, pauseOnHover && touching, data.tokens);
  useArrivalSound(data.rows, soundOn, `${chain}:${phase}`);

  // Pull to refresh.
  const start = useRef<{ x: number; y: number } | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const armed = useRef(false);

  useEffect(() => () => window.clearTimeout(releaseTimer.current), []);

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    window.clearTimeout(releaseTimer.current);
    setTouching(true);
    const el = listRef.current;
    const t = e.touches[0];
    start.current = el && el.scrollTop <= 0 && t ? { x: t.clientX, y: t.clientY } : null;
    armed.current = false;
  };
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const s = start.current;
    const t = e.touches[0];
    if (!s || !t || refreshing) return;
    const dy = t.clientY - s.y;
    const dx = t.clientX - s.x;
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      if (pull !== 0) setPull(0);
      return;
    }
    const next = Math.min(PULL_MAX, dy * 0.5);
    if (next >= PULL_TRIGGER && !armed.current) {
      armed.current = true;
      haptic(10);
    } else if (next < PULL_TRIGGER) armed.current = false;
    setPull(next);
  };
  const onTouchEnd = () => {
    releaseTimer.current = window.setTimeout(() => setTouching(false), 1200);
    const shouldRefresh = pull >= PULL_TRIGGER && !refreshing;
    start.current = null;
    armed.current = false;
    if (shouldRefresh) {
      setRefreshing(true);
      setPull(PULL_TRIGGER * 0.7);
      void onRefresh().finally(() => {
        setRefreshing(false);
        setPull(0);
      });
    } else setPull(0);
  };

  const meta = PHASE_META[phase];
  const watched = new Set(watchlist);
  const indicator = refreshing ? PULL_TRIGGER * 0.7 : pull;

  return (
    <div className="relative h-full w-full shrink-0 snap-start snap-always" aria-label={meta.title} role="tabpanel">
      <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
        <PausedPill paused={paused} queued={queued} />
      </div>
      <div
        ref={listRef}
        className="h-full overflow-y-auto overscroll-contain pb-4 [-webkit-overflow-scrolling:touch]"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className={cn("flex items-end justify-center overflow-hidden", pull === 0 && "transition-[height] duration-200")}
          style={{ height: indicator }}
          aria-hidden={!refreshing}
        >
          <span
            className={cn(
              "mb-2 inline-flex h-8 w-8 items-center justify-center rounded-[3px] border border-line-2 bg-bg-elev",
              pull >= PULL_TRIGGER || refreshing ? "text-brand" : "text-text-3",
            )}
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
              style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
            />
          </span>
        </div>
        <div className="pt-3">
          {loading && rows.length === 0 ? (
            Array.from({ length: 5 }, (_, i) => <TokenCardSkeleton key={i} variant="mobile" />)
          ) : rows.length === 0 ? (
            <LaneEmpty phase={phase} raw={data.raw} className="mx-3" />
          ) : (
            rows.map((t) => (
              <TokenCard
                key={t.key}
                token={t}
                amount={amount}
                preset={preset}
                variant="mobile"
                watched={watched.has(t.key)}
                onBuy={onBuy}
                onOpen={onOpen}
              />
            ))
          )}
          {data.total > rows.length && !paused && (
            <div className="mono-label flex items-center gap-3 px-4 py-3 !text-[10px]">
              <span className="h-px flex-1 bg-line" aria-hidden />
              Showing {rows.length} of {data.total}
              <span className="h-px flex-1 bg-line" aria-hidden />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MobileBoard({
  chain,
  loading,
  onBuy,
  onRefresh,
  onOpenFilters,
}: {
  chain: ChainId;
  loading: boolean;
  onBuy: QuickBuyFn;
  onRefresh: () => Promise<void>;
  onOpenFilters: (phase: TokenPhase) => void;
}) {
  const active = useUI((s) => s.mobileColumn);
  const setActive = useUI((s) => s.setMobileColumn);
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null);
  const targetTimer = useRef<number | undefined>(undefined);
  const raf = useRef(0);

  const cols: Record<TokenPhase, ColumnData> = {
    new: useColumn(chain, "new"),
    almost: useColumn(chain, "almost"),
    migrated: useColumn(chain, "migrated"),
  };

  // Restore the remembered column without animation on mount.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = PHASES.indexOf(useUI.getState().mobileColumn) * el.clientWidth;
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(targetTimer.current);
    },
    [],
  );

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = scroller.current;
      if (!el || el.clientWidth === 0) return;
      const pos = el.scrollLeft / el.clientWidth;
      if (target.current !== null) {
        if (Math.abs(pos - target.current) < 0.02) target.current = null;
        else return;
      }
      const i = Math.max(0, Math.min(PHASES.length - 1, Math.round(pos)));
      const p = PHASES[i];
      if (p !== useUI.getState().mobileColumn) {
        haptic(4);
        setActive(p);
      }
    });
  }, [setActive]);

  const go = (p: TokenPhase) => {
    const el = scroller.current;
    const i = PHASES.indexOf(p);
    haptic();
    setActive(p);
    if (!el) return;
    target.current = i;
    window.clearTimeout(targetTimer.current);
    targetTimer.current = window.setTimeout(() => {
      target.current = null;
    }, 700);
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Phase tabs + active column toolbar */}
      <div className="shrink-0 border-b border-line bg-bg">
        <div role="tablist" aria-label="Board columns" className="relative grid grid-cols-3 px-1.5">
          {PHASES.map((p) => {
            const on = p === active;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go(p)}
                className={cn(
                  "relative flex h-12 items-center justify-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors",
                  on ? "text-text" : "text-text-3 active:text-text-2",
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full transition-opacity", !on && "opacity-50")} style={{ background: PHASE_ACCENT[p] }} aria-hidden />
                {PHASE_META[p].short}
                <span
                  className={cn(
                    "num min-w-[18px] text-center text-[10.5px] leading-none transition-colors",
                    on ? "text-brand" : "text-text-3",
                  )}
                >
                  {cols[p].total}
                </span>
                {on && (
                  <motion.span
                    layoutId="mobile-col-underline"
                    className="absolute inset-x-4 bottom-0 h-[2px]"
                    style={{ background: PHASE_ACCENT[p] }}
                    transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-t border-line px-3 py-2">
          <QuickBuyChip phase={active} chain={chain} size="md" />
          <ColumnPresetToggle phase={active} size="md" />
          <div className="ml-auto flex items-center gap-2">
            <SoundToggle phase={active} size="md" />
            <FilterButton phase={active} size="md" onClick={() => onOpenFilters(active)} />
          </div>
        </div>
      </div>

      {/* Swipeable panes */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        {PHASES.map((p) => (
          <MobilePane key={p} chain={chain} phase={p} data={cols[p]} loading={loading} onBuy={onBuy} onRefresh={onRefresh} />
        ))}
      </div>
    </div>
  );
}
