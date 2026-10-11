// Shared building blocks for insights UI: the "Data: GMGN" note, score readouts with expandable reasons, a breakdown bar.
import { useState, type ReactNode } from "react";
import { Check as CheckIcon, ChevronDown, Copy } from "lucide-react";
import type { InsightSource, Score, WalletTag } from "@shared/insights";
import { cn } from "@/lib/utils";
import { WalletTagIcon } from "./WalletTags";
import { ratioPct } from "./format";

const SOURCE_LABEL: Record<InsightSource, string> = { gmgn: "GMGN", claudio: "Claudio", dexscreener: "DexScreener", rpc: "on-chain" };

/** Small attribution line for third-party data. */
export function DataNote({ source = "gmgn", partial, className }: { source?: InsightSource | null; partial?: string | null; className?: string }) {
  if (!source || source === "claudio" || source === "rpc") {
    return partial ? <span className={cn("font-mono text-[10px] text-warn", className)}>{partial}</span> : null;
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3", className)}>
      <span className="shrink-0">Data: {SOURCE_LABEL[source]}</span>
      {partial && (
        <span className="truncate text-warn" title={partial}>
          · {partial}
        </span>
      )}
    </span>
  );
}

export const GRADE_TEXT: Record<Score["grade"], string> = { good: "text-buy", mixed: "text-warn", risky: "text-sell", unknown: "text-text-3" };
const GRADE_BG: Record<Score["grade"], string> = { good: "bg-buy", mixed: "bg-warn", risky: "bg-sell", unknown: "bg-text-3" };
export const GRADE_LABEL: Record<Score["grade"], string> = { good: "Good", mixed: "Mixed", risky: "Risky", unknown: "Unknown" };

/** Compact score chip: "62 · Basing". */
export function ScoreChip({ score, label, className }: { score: Pick<Score, "value" | "grade" | "title">; label?: string; className?: string }) {
  return (
    <span
      className={cn("chip shrink-0 whitespace-nowrap py-1", className)}
      data-tip={`${label ?? score.title}: ${Math.round(score.value)} / 100 (${GRADE_LABEL[score.grade].toLowerCase()})`}
    >
      <span className="text-text-2">{label ?? score.title}</span>
      <span className={cn("num", GRADE_TEXT[score.grade])}>{Math.round(score.value)}</span>
    </span>
  );
}

/** Score block: big number, grade, title, summary; reasons expand below with signed points. */
export function ScoreBlock({ score, label, className, defaultOpen = false }: { score: Score; label: string; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const v = Math.max(0, Math.min(100, score.value));
  const hasReasons = score.reasons.length > 0;
  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        disabled={!hasReasons}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={hasReasons ? open : undefined}
        className="flex w-full min-w-0 items-center gap-3 text-left disabled:cursor-default"
      >
        <span className="flex w-11 shrink-0 flex-col items-center">
          <span className={cn("num text-[20px] font-medium leading-none", GRADE_TEXT[score.grade])}>{Math.round(v)}</span>
          <span className="mt-1 h-[2px] w-full overflow-hidden bg-line" aria-hidden>
            <span className={cn("block h-full", GRADE_BG[score.grade])} style={{ width: `${v}%` }} />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{label}</span>
            <span className={cn("font-mono text-[10.5px] uppercase tracking-[0.06em]", GRADE_TEXT[score.grade])}>{score.title}</span>
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-text-2">{score.summary}</span>
        </span>
        {hasReasons && <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden />}
      </button>
      {open && hasReasons && (
        <ul className="mt-2 space-y-0.5 border-l border-line pl-3">
          {score.reasons.map((r, i) => (
            <li key={`${r.label}-${i}`} className="flex items-baseline justify-between gap-3 text-[11.5px]">
              <span className="min-w-0 text-text-2">{r.label}</span>
              <span className={cn("num shrink-0 font-medium", r.points > 0 ? "text-buy" : r.points < 0 ? "text-sell" : "text-text-3")}>
                {r.points > 0 ? "+" : ""}
                {r.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TAG_FILL: Partial<Record<WalletTag, string>> = {
  top10: "bg-text-2",
  fresh: "bg-buy",
  bot: "bg-text-3",
  bundler: "bg-warn",
  sniper: "bg-sell",
  insider: "bg-sell/70",
  kol: "bg-info",
  smart: "bg-gold",
  whale: "bg-info/70",
  rat: "bg-warn/70",
  dev: "bg-copper",
};

/** Holder mix as labelled readouts with tiny bars (shares can overlap, so no stacked 100% bar). */
export function BreakdownBar({ items, className }: { items: { label: string; pct: number; tag?: WalletTag }[]; className?: string }) {
  if (!items.length) return null;
  const max = Math.max(0.3, ...items.map((i) => i.pct));
  return (
    <div className={cn("grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-7", className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
            {i.tag && <WalletTagIcon tag={i.tag} size={11} />}
            <span className="truncate">{i.label}</span>
          </div>
          <div className="num mt-0.5 text-[12.5px] font-medium text-text">{ratioPct(i.pct)}</div>
          <div className="mt-1 h-[2px] overflow-hidden bg-line" aria-hidden>
            <div className={cn("h-full", (i.tag && TAG_FILL[i.tag]) || "bg-text-3")} style={{ width: `${Math.max(3, (i.pct / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Label / value row used in the safety and dev panels. */
export function Row({ label, children, tip }: { label: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="flex min-h-[28px] items-center justify-between gap-3 border-b border-line py-0.5 text-[12px] last:border-b-0" data-tip={tip}>
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 truncate text-right text-text-2">{children}</span>
    </div>
  );
}

/** Yes / no / unknown value with meaning-coloured text. */
export function Check({ ok, yes = "Yes", no = "No", unknown = "—" }: { ok: boolean | null | undefined; yes?: string; no?: string; unknown?: string }) {
  if (ok === null || ok === undefined) return <span className="text-text-3">{unknown}</span>;
  return <span className={ok ? "text-buy" : "text-sell"}>{ok ? yes : no}</span>;
}

/** Panel shell with a slim title row. */
export function InsightPanel({ title, right, children, className, footer }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode }) {
  return (
    <section className={cn("panel flex min-w-0 flex-col overflow-hidden", className)}>
      <header className="flex min-h-[40px] items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <h3 className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2">{title}</h3>
        {right}
      </header>
      <div className="min-w-0 flex-1 px-3.5 py-2.5">{children}</div>
      {footer && <div className="border-t border-line px-3.5 py-1.5">{footer}</div>}
    </section>
  );
}

/** Icon-only copy button (32 px hit area on phones). */
export function CopyButton({ value, label = "Copy address" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={done ? "Copied" : label}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="-my-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] text-text-3 hover:bg-panel-3 hover:text-text"
    >
      {done ? <CheckIcon className="h-3 w-3 text-buy" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
