// Desktop Trenches lane: a header card (phase identity, live count, column controls)
// above a pausable, capped stack of token cards.
import { useState, type ReactNode } from "react";
import { Flame, Rocket, Sparkles } from "lucide-react";
import type { ChainId } from "@shared/chains";
import type { TokenPhase } from "@shared/types";
import { Empty } from "@/components/kit";
import { useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ColumnPresetToggle, FilterButton, PausedPill, QuickBuyChip, SoundToggle } from "./ColumnControls";
import { PHASE_META, useBoardPrefs, useColumnAmount, useColumnPreset } from "./prefs";
import { TokenCard, TokenCardSkeleton } from "./TokenCard";
import { useArrivalSound, useColumn, useOpenToken } from "./useColumn";
import { usePausable } from "./usePausable";
import type { QuickBuyFn } from "./useQuickBuy";

export const PHASE_ICON: Record<TokenPhase, ReactNode> = {
  new: <Sparkles className="h-3.5 w-3.5" />,
  almost: <Flame className="h-3.5 w-3.5" />,
  migrated: <Rocket className="h-3.5 w-3.5" />,
};

/** Phase identity colour: fresh launches carry the flight orange, near-graduation amber, graduated blue. */
export const PHASE_ACCENT: Record<TokenPhase, string> = {
  new: "var(--brand)",
  almost: "var(--brand-2)",
  migrated: "var(--info)",
};

const EMPTY_HINT: Record<TokenPhase, string> = {
  new: "New tokens stream in live — this column updates by itself.",
  almost: "Tokens show up here as their bonding curve nears completion.",
  migrated: "Tokens land here once they graduate to an AMM pool.",
};

/** Phase icon in a tinted squircle. */
export function PhaseGlyph({ phase, size = 32, className }: { phase: TokenPhase; size?: number; className?: string }) {
  const accent = PHASE_ACCENT[phase];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)} style={{ width: Math.min(size, 12), height: Math.min(size, 12) }} aria-hidden>
      <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
    </span>
  );
}

/** Empty lane: kit Empty on a faint dot grid inside a dashed target area. */
export function LaneEmpty({ phase, raw, className }: { phase: TokenPhase; raw: number; className?: string }) {
  const meta = PHASE_META[phase];
  return (
    <div className={cn("rounded-[3px] border border-dashed border-line", className)}>
      <Empty
        icon={<span className="[&>svg]:h-6 [&>svg]:w-6" style={{ color: PHASE_ACCENT[phase] }}>{PHASE_ICON[phase]}</span>}
        title={raw > 0 ? "Everything is filtered out" : `No ${meta.short.toLowerCase()} tokens yet`}
        hint={raw > 0 ? `${raw} tokens hidden by this column's filters.` : EMPTY_HINT[phase]}
      />
    </div>
  );
}

export function BoardColumn({
  chain,
  phase,
  loading,
  onBuy,
  onOpenFilters,
}: {
  chain: ChainId;
  phase: TokenPhase;
  loading: boolean;
  onBuy: QuickBuyFn;
  onOpenFilters: (phase: TokenPhase) => void;
}) {
  const { rows: live, total, raw, tokens } = useColumn(chain, phase);
  const pauseOnHover = useSettings((s) => s.pauseOnHover);
  const watchlist = useSettings((s) => s.watchlist);
  const soundOn = useBoardPrefs((s) => s.columns[phase]?.sound === true);
  const amount = useColumnAmount(phase, chain);
  const preset = useColumnPreset(phase);
  const onOpen = useOpenToken();
  const [hover, setHover] = useState(false);
  const { rows, paused, queued } = usePausable(live, pauseOnHover && hover, tokens);
  useArrivalSound(live, soundOn, `${chain}:${phase}`);
  const watched = new Set(watchlist);
  const meta = PHASE_META[phase];
  const accent = PHASE_ACCENT[phase];
  const filtered = total !== raw;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-2" aria-label={meta.title}>
      <header className="relative shrink-0 overflow-hidden rounded-[3px] border border-line bg-bg-elev">
        {/* phase edge: a flat hairline in the phase colour */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: accent }} />
        <div className="flex items-center gap-3 px-3 pb-2.5 pt-3">
          <PhaseGlyph phase={phase} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-[11.5px] font-medium uppercase leading-tight tracking-[0.12em] text-text">{meta.title}</h2>
            <p className="mt-1 truncate text-[11.5px] leading-tight text-text-3">
              {paused ? <span className="font-semibold text-warn">Paused while you read</span> : meta.hint}
            </p>
          </div>
          <div
            className="flex shrink-0 flex-col items-end leading-none"
            data-tip={total === raw ? `${total} tokens` : `${total} shown of ${raw} (filters active)`}
          >
            <span className="num text-[20px] font-medium text-text">
              {total}
              {filtered && <span className="text-[12px] font-medium text-text-3">/{raw}</span>}
            </span>
            <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-3">{filtered ? "Shown" : "Tokens"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-t border-line px-2 py-2">
          <QuickBuyChip phase={phase} chain={chain} />
          <ColumnPresetToggle phase={phase} />
          <div className="ml-auto flex items-center gap-1.5">
            <FilterButton phase={phase} onClick={() => onOpenFilters(phase)} />
            <SoundToggle phase={phase} />
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <PausedPill paused={paused} queued={queued} />
        </div>
        <div
          className={cn(
            "flex h-full flex-col gap-1.5 overflow-y-auto overscroll-contain pb-2 pr-0.5",
            paused && "[scrollbar-color:var(--warn)_transparent]",
          )}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setHover(true);
          }}
          onPointerLeave={() => setHover(false)}
        >
          {loading && rows.length === 0 ? (
            Array.from({ length: 6 }, (_, i) => <TokenCardSkeleton key={i} variant="row" />)
          ) : rows.length === 0 ? (
            <LaneEmpty phase={phase} raw={raw} />
          ) : (
            rows.map((t) => (
              <TokenCard
                key={t.key}
                token={t}
                amount={amount}
                preset={preset}
                variant="row"
                watched={watched.has(t.key)}
                onBuy={onBuy}
                onOpen={onOpen}
              />
            ))
          )}
          {total > rows.length && !paused && (
            <div className="mono-label flex items-center gap-3 px-2 py-3 !text-[10px]">
              <span className="h-px flex-1 bg-line" aria-hidden />
              Showing newest {rows.length} of {total} · tighten filters to see more
              <span className="h-px flex-1 bg-line" aria-hidden />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
