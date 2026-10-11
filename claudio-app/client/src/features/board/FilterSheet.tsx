// Per-column filter editor (Dialog on desktop, bottom drawer on phones).
import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { launchpadsForChain, type LaunchpadId } from "@shared/launchpads";
import type { TokenPhase } from "@shared/types";
import type { ChainId } from "@shared/chains";
import { LaunchpadLogo, ResponsiveSheet } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { haptic, useSettings, type ColumnFilters } from "@/lib/store";
import { activeFilterCount } from "./filters";
import { PHASES, PHASE_META } from "./prefs";
import { PHASE_ACCENT } from "./BoardColumn";

type NumKey =
  | "minMcap" | "maxMcap" | "minLiquidity" | "minHolders" | "maxTop10Pct" | "maxDevPct"
  | "maxSnipersPct" | "maxBundlersPct" | "maxInsidersPct" | "maxAgeMin";
type FlagKey = "requireSocials" | "requireTwitter" | "dexPaidOnly" | "stockPairedOnly" | "launchedHereOnly" | "hideDevSold";

function parseNum(s: string): number | undefined {
  const t = s.trim().replace(/[$,%\s]/g, "");
  if (!t) return undefined;
  const m = /^(-?\d*\.?\d+)([kmb])?$/i.exec(t);
  if (!m) return undefined;
  const mult = m[2] ? ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[m[2].toLowerCase()] : 1;
  const v = parseFloat(m[1]) * mult;
  return Number.isFinite(v) ? v : undefined;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="eyebrow">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Text input that accepts 10k / 1.5m and commits a number (or undefined when cleared). */
function NumField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-2">{label}</span>
      <span className="flex h-10 items-center gap-1 rounded-[3px] border border-line-2 bg-bg px-3 transition-colors hover:border-text-3/50 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
        {prefix && <span className="text-[12px] text-text-3">{prefix}</span>}
        <input
          inputMode="decimal"
          value={shown}
          placeholder={placeholder ?? "Any"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== null) onChange(parseNum(draft));
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="num w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-text-3"
        />
        {suffix && <span className="text-[12px] text-text-3">{suffix}</span>}
      </span>
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 rounded-[2px] px-3 py-1.5 transition-colors hover:bg-panel-2">
      <span className="flex flex-col">
        <span className="text-[13px] text-text">{label}</span>
        {hint && <span className="text-[11px] text-text-3">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={(v) => onChange(v === true)} />
    </label>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  phase: initialPhase,
  chain,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  phase: TokenPhase;
  chain: ChainId;
}) {
  const [phase, setPhase] = useState<TokenPhase>(initialPhase);
  // Re-sync the edited column each time the sheet opens (derived-state pattern, no effect flash).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && phase !== initialPhase) setPhase(initialPhase);
  }
  const allFilters = useSettings((s) => s.filters);
  const setFilters = useSettings((s) => s.setFilters);
  const f: ColumnFilters = allFilters[phase] ?? { launchpads: [] };
  const lps = launchpadsForChain(chain);
  const patch = (p: Partial<ColumnFilters>) => setFilters(phase, p);
  const numF = (k: NumKey) => ({
    value: f[k],
    onChange: (v: number | undefined) => {
      const p: Partial<ColumnFilters> = {};
      p[k] = v;
      patch(p);
    },
  });
  const flag = (k: FlagKey) => ({
    checked: f[k] === true,
    onChange: (v: boolean) => {
      const p: Partial<ColumnFilters> = {};
      p[k] = v ? true : undefined;
      patch(p);
    },
  });

  const toggleLp = (id: LaunchpadId) => {
    haptic();
    const cur = f.launchpads ?? [];
    patch({ launchpads: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const reset = () => {
    haptic(14);
    useSettings.getState().set({ filters: { ...useSettings.getState().filters, [phase]: { launchpads: [] } } });
  };
  const count = activeFilterCount(f);

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Column filters"
      description="Filters apply live to the board. Blocked devs and keywords from Settings always apply."
      className="sm:max-w-xl"
    >
      <div className="space-y-5 pb-2">
        {/* Column picker */}
        <div className="grid grid-cols-3 gap-1 rounded-[3px] border border-line-2 p-[3px]">
          {PHASES.map((p) => {
            const n = activeFilterCount(allFilters[p] ?? { launchpads: [] });
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPhase(p)}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-[2px] font-mono text-[11px] font-medium uppercase tracking-[0.1em] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand",
                  p === phase ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2",
                )}
              >
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", p !== phase && "opacity-50")} style={{ background: PHASE_ACCENT[p] }} aria-hidden />
                {PHASE_META[p].short}
                {n > 0 && <span className="num rounded-[2px] bg-brand px-1.5 py-px text-[10px] text-brand-ink">{n}</span>}
              </button>
            );
          })}
        </div>

        <Section
          title="Launchpads"
          aside={
            <span className={cn("font-mono text-[10.5px] uppercase tracking-[0.1em]", (f.launchpads ?? []).length ? "text-brand" : "text-text-3")}>
              {(f.launchpads ?? []).length ? `${(f.launchpads ?? []).length} selected` : "All"}
            </span>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {lps.map((lp) => {
              const on = (f.launchpads ?? []).includes(lp.id);
              return (
                <button
                  key={lp.id}
                  type="button"
                  onClick={() => toggleLp(lp.id)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[3px] border pl-2 pr-3 text-[12px] font-medium transition-colors",
                    on ? "border-brand/60 bg-brand-bg text-text" : "border-line text-text-2 hover:border-line-2 hover:text-text",
                  )}
                >
                  <LaunchpadLogo id={lp.id} size={16} />
                  {lp.name}
                  {lp.adapter === "planned" && <span className="text-[10px] text-text-3">soon</span>}
                </button>
              );
            })}
            {lps.length === 0 && <span className="text-[12px] text-text-3">No launchpads indexed on this chain yet.</span>}
          </div>
        </Section>

        <Section title="Market">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Min market cap" prefix="$" placeholder="e.g. 10k" {...numF("minMcap")} />
            <NumField label="Max market cap" prefix="$" placeholder="e.g. 1m" {...numF("maxMcap")} />
            <NumField label="Min liquidity" prefix="$" {...numF("minLiquidity")} />
            <NumField label="Min holders" {...numF("minHolders")} />
          </div>
        </Section>

        <Section title="Holder risk · max %">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <NumField label="Top 10" suffix="%" {...numF("maxTop10Pct")} />
            <NumField label="Dev" suffix="%" {...numF("maxDevPct")} />
            <NumField label="Snipers" suffix="%" {...numF("maxSnipersPct")} />
            <NumField label="Bundlers" suffix="%" {...numF("maxBundlersPct")} />
            <NumField label="Insiders" suffix="%" {...numF("maxInsidersPct")} />
          </div>
        </Section>

        <Section title="Age & tax">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Max age" suffix="min" {...numF("maxAgeMin")} />
            <NumField
              label="Max tax (buy or sell)"
              suffix="%"
              value={f.maxTaxBps === undefined ? undefined : f.maxTaxBps / 100}
              onChange={(v) => patch({ maxTaxBps: v === undefined ? undefined : Math.round(v * 100) })}
            />
          </div>
        </Section>

        <Section title="Must have">
          <div className="grid gap-x-1 rounded-[3px] border border-line p-1 sm:grid-cols-2">
            <Toggle label="Any socials" hint="X, Telegram or website" {...flag("requireSocials")} />
            <Toggle label="X / Twitter" {...flag("requireTwitter")} />
            <Toggle label="DEX Screener paid" {...flag("dexPaidOnly")} />
            <Toggle label="Stock-paired only" hint="Quote is a tokenized stock" {...flag("stockPairedOnly")} />
            <Toggle label="Launched on Claudio" hint="Locked 70/30 split" {...flag("launchedHereOnly")} />
            <Toggle label="Hide dev sold" {...flag("hideDevSold")} />
          </div>
        </Section>

        <Section title="Keywords">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-2">Include (any)</span>
              <input
                value={f.includeKeywords ?? ""}
                onChange={(e) => patch({ includeKeywords: e.target.value || undefined })}
                placeholder="pepe, cat, ai"
                className="h-10 rounded-[3px] border border-line-2 bg-bg px-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-3 hover:border-text-3/50 focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-2">Exclude</span>
              <input
                value={f.excludeKeywords ?? ""}
                onChange={(e) => patch({ excludeKeywords: e.target.value || undefined })}
                placeholder="rug, test"
                className="h-10 rounded-[3px] border border-line-2 bg-bg px-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-3 hover:border-text-3/50 focus:border-brand focus:ring-1 focus:ring-brand"
              />
            </label>
          </div>
        </Section>

        <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t border-line bg-bg-elev px-1 pb-1 pt-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-bg-elev">
          <button
            type="button"
            onClick={reset}
            disabled={count === 0}
            className="btn btn-secondary h-11 disabled:opacity-40 md:h-10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset {PHASE_META[phase].short}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="btn btn-primary ml-auto h-11 px-6 md:h-10"
          >
            Done{count > 0 ? ` · ${count} active` : ""}
          </button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
