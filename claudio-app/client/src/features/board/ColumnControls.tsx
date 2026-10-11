// Small controls shared by desktop column headers and the mobile board toolbar.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, Pause, SlidersHorizontal, Zap } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import type { TokenPhase } from "@shared/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtNative } from "@/lib/format";
import { haptic, useSettings, type ExecPreset } from "@/lib/store";
import { activeFilterCount } from "./filters";
import { useBoardPrefs, useColumnAmount, useColumnPreset } from "./prefs";
import { playBlip } from "@/features/alerts/sound";

const PRESETS: ExecPreset[] = ["P1", "P2", "P3"];

export function PresetToggle({
  value,
  onChange,
  size = "sm",
  layoutKey,
}: {
  value: ExecPreset;
  onChange: (p: ExecPreset) => void;
  size?: "sm" | "md";
  /** Unique per instance so framer's shared layout animation doesn't jump between toggles. */
  layoutKey: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Execution preset"
      className="relative inline-flex shrink-0 items-center rounded-[3px] border border-line p-[3px]"
    >
      {PRESETS.map((p) => {
        const on = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={(e) => {
              e.stopPropagation();
              haptic();
              onChange(p);
            }}
            className={cn(
              "num relative z-0 rounded-[2px] font-medium transition-colors",
              size === "sm" ? "h-7 px-2 text-[10.5px]" : "h-8 px-2.5 text-[12px]",
              on ? "text-brand" : "text-text-3 hover:text-text-2",
            )}
            data-tip={`Execution preset ${p}`}
          >
            {on && (
              <motion.span
                layoutId={`preset-${layoutKey}`}
                className="absolute inset-0 -z-10 rounded-[2px] bg-brand-bg ring-1 ring-inset ring-brand/40"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            {p}
          </button>
        );
      })}
    </div>
  );
}

/** Column preset (falls back to the global preset when not overridden). */
export function ColumnPresetToggle({ phase, size }: { phase: TokenPhase; size?: "sm" | "md" }) {
  const value = useColumnPreset(phase);
  const setColumn = useBoardPrefs((s) => s.setColumn);
  return <PresetToggle value={value} onChange={(p) => setColumn(phase, { preset: p })} size={size} layoutKey={`col-${phase}`} />;
}

/** "⚡ 0.01 ETH" chip; opens a popover to set this column's amount. */
export function QuickBuyChip({ phase, chain, size = "sm" }: { phase: TokenPhase; chain: ChainId; size?: "sm" | "md" }) {
  const amount = useColumnAmount(phase, chain);
  const override = useBoardPrefs((s) => s.columns[phase]?.quickBuy?.[chain]);
  const setAmount = useBoardPrefs((s) => s.setColumnQuickBuy);
  const presets = useSettings((s) => s.quickBuyPresets[chain]) ?? [];
  const sym = CHAINS[chain].nativeSymbol;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = (v: number | undefined) => {
    haptic();
    setAmount(phase, chain, v);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(String(amount || ""));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "num inline-flex shrink-0 items-center gap-1.5 rounded-[3px] border font-medium transition-colors",
            size === "sm" ? "h-9 px-2.5 text-[11.5px]" : "h-10 px-3 text-[12.5px]",
            override !== undefined
              ? "border-buy/30 bg-buy-bg text-buy"
              : "border-line text-text hover:border-line-2",
          )}
          data-tip={override !== undefined ? "Column quick-buy amount" : "Using global quick-buy amount — click to override"}
        >
          <Zap className={cn("h-3 w-3", override === undefined && "text-buy")} fill="currentColor" />
          {fmtNative(amount)}
          <span className={override !== undefined ? "text-buy/70" : "text-text-3"}>{sym}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-[4px] border-line-2 bg-bg-elev p-3">
        <div className="eyebrow mb-2.5">Quick buy · {CHAINS[chain].short}</div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = parseFloat(draft);
            commit(Number.isFinite(v) && v > 0 ? v : undefined);
          }}
        >
          <div className="flex h-10 flex-1 items-center gap-1 rounded-[3px] border border-line-2 bg-bg px-3 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
            <input
              autoFocus
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="num w-full min-w-0 bg-transparent text-[14px] text-text outline-none"
              aria-label={`Amount in ${sym}`}
            />
            <span className="text-[12px] text-text-3">{sym}</span>
          </div>
          <button type="submit" className="btn-buy h-10 px-4 font-mono text-[11px] uppercase tracking-[0.1em]">
            Set
          </button>
        </form>
        <div className="mt-2 grid grid-cols-5 gap-1">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => commit(p)}
              className={cn(
                "num h-9 rounded-[2px] border text-[11px] transition-colors",
                p === amount ? "border-buy/50 bg-buy-bg text-buy" : "border-line text-text-2 hover:border-line-2 hover:text-text",
              )}
            >
              {fmtNative(p)}
            </button>
          ))}
        </div>
        {override !== undefined && (
          <button type="button" onClick={() => commit(undefined)} className="mt-2.5 h-9 w-full rounded-[2px] text-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3 transition-colors hover:bg-panel-3 hover:text-text">
            Use global amount
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterButton({ phase, onClick, size = "sm" }: { phase: TokenPhase; onClick: () => void; size?: "sm" | "md" }) {
  const f = useSettings((s) => s.filters[phase]);
  const n = f ? activeFilterCount(f) : 0;
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[3px] border transition-colors",
        size === "sm" ? "h-9 min-w-9 px-2.5" : "h-10 min-w-10 px-3",
        n > 0 ? "border-brand/50 bg-brand-bg text-brand" : "border-line text-text-2 hover:border-line-2 hover:text-text",
      )}
      aria-label="Filters"
      data-tip="Filters"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {n > 0 && <span className="num text-[11px] font-bold">{n}</span>}
    </button>
  );
}

export function SoundToggle({ phase, size = "sm" }: { phase: TokenPhase; size?: "sm" | "md" }) {
  const on = useBoardPrefs((s) => s.columns[phase]?.sound === true);
  const setColumn = useBoardPrefs((s) => s.setColumn);
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        const next = !on;
        setColumn(phase, { sound: next });
        if (next) playBlip("new", 0);
      }}
      aria-pressed={on}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[3px] border transition-colors",
        size === "sm" ? "h-9 w-9" : "h-10 w-10",
        on ? "border-info/50 bg-info-bg text-info" : "border-line text-text-3 hover:border-line-2 hover:text-text",
      )}
      aria-label={on ? "Mute new-token sound" : "Play a sound for new tokens"}
      data-tip={on ? "Sound on for new tokens" : "Sound off"}
    >
      {on ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
    </button>
  );
}

export function PausedPill({ paused, queued, className }: { paused: boolean; queued: number; className?: string }) {
  return (
    <AnimatePresence>
      {paused && (
        <motion.span
          key="paused"
          initial={{ opacity: 0, y: -6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.95 }}
          transition={{ duration: 0.16 }}
          className={cn(
            "pointer-events-none inline-flex items-center gap-1.5 rounded-[2px] bg-bg-elev/95 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-warn ring-1 ring-warn/40 backdrop-blur",
            className,
          )}
          role="status"
        >
          <Pause className="h-3 w-3" fill="currentColor" />
          Paused
          {queued > 0 && <span className="num">· {queued} new</span>}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
