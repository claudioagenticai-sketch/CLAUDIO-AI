// Presentation helpers shared by the account pages (Portfolio, Tracker, Creator, Claim, 404).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Target rings ───────────────────────────────────────────────────

/** Retired ornament (concentric rings). Kept as a no-op so older call sites compile; renders nothing. */
export function TargetRings(_props: { size?: number; className?: string; quiet?: boolean; bullseye?: boolean }) {
  return null;
}

/** Retired ornament (icon medallion). Kept as a no-op so older call sites compile; renders nothing. */
export function TargetIcon(_props: { icon: ReactNode; size?: number; className?: string }) {
  return null;
}

// ─── Headings & tiles ───────────────────────────────────────────────

/**
 * Editorial section title: optional mono number in the accent (`01`), a condensed uppercase title, an optional count
 * and right-aligned meta. Sits on a top hairline when `rule` is set.
 */
export function SectionTitle({
  title,
  count,
  right,
  className,
  num,
  rule = false,
}: {
  title: ReactNode;
  count?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** Mono section number, e.g. "01". */
  num?: ReactNode;
  /** Draw a hairline above (numbered editorial sections). */
  rule?: boolean;
}) {
  return (
    <div className={cn("flex min-h-9 flex-wrap items-end justify-between gap-2", rule && "border-t border-line pt-4", className)}>
      <h2 className="flex min-w-0 items-baseline gap-2.5">
        {num !== undefined && <span className="section-num shrink-0 self-start pt-0.5">{num}</span>}
        <span className="display-section truncate text-text">{title}</span>
        {count !== undefined && <span className="num shrink-0 text-[12px] text-text-3">{count}</span>}
      </h2>
      {right}
    </div>
  );
}

export type Tone = "neutral" | "buy" | "sell" | "warn" | "info" | "brand";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-text",
  buy: "text-buy",
  sell: "text-sell",
  warn: "text-warn",
  info: "text-info",
  brand: "text-brand",
};

/** KPI tile: eyebrow label, big tabular value, optional sub line / footer. */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
  className,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("panel relative flex min-w-0 flex-col p-3 md:p-4", className)}>
      <span className="mono-label truncate !text-[10.5px]">{label}</span>
      <div className={cn("num mt-1.5 truncate text-[20px] font-medium leading-tight md:text-[24px]", TONE_TEXT[tone])}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-text-3 md:mt-1 md:text-[11.5px]">{sub}</div>}
      {children}
    </div>
  );
}

// ─── Callouts ───────────────────────────────────────────────────────

const CALLOUT: Record<Exclude<Tone, "neutral">, { box: string; icon: string }> = {
  buy: { box: "border-l-buy", icon: "text-buy" },
  sell: { box: "border-l-sell", icon: "text-sell" },
  warn: { box: "border-l-warn", icon: "text-warn" },
  info: { box: "border-l-info", icon: "text-info" },
  brand: { box: "border-l-brand", icon: "text-brand" },
};

export function Callout({ tone = "info", icon, title, children, className }: { tone?: Exclude<Tone, "neutral">; icon?: ReactNode; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = CALLOUT[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-[3px] border border-l-2 border-line bg-bg-elev px-3.5 py-3 text-[12.5px] leading-relaxed", t.box, className)}>
      {icon && <span className={cn("mt-[2px] shrink-0 [&>svg]:h-4 [&>svg]:w-4", t.icon)}>{icon}</span>}
      <div className="min-w-0 text-text-2">
        {title && <div className="mb-0.5 text-[12.5px] font-bold text-text">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────

/** Numbered steps: a muted number, a bold line, an optional explanation. */
export function Steps({ steps, direction = "row", className }: { steps: { title: ReactNode; body?: ReactNode; icon?: ReactNode }[]; direction?: "row" | "column"; className?: string }) {
  return (
    <ol className={cn("grid gap-4", direction === "row" && "sm:grid-flow-col sm:auto-cols-fr sm:gap-6", className)}>
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="section-num w-5 shrink-0 pt-px">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text">{s.title}</div>
            {s.body && <div className="mt-0.5 text-[12px] leading-relaxed text-text-3">{s.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Empty state ────────────────────────────────────────────────────

/**
 * Large empty state: a clear title, one line of help and the next action. `icon` / `eyebrow` are accepted for older
 * call sites; the icon isn't drawn. `split` left-aligns the copy on desktop.
 */
export function HeroEmpty({
  eyebrow,
  title,
  hint,
  actions,
  children,
  className,
  compact = false,
  split = false,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
  split?: boolean;
}) {
  const actionsCls = "mt-4 flex w-full flex-col gap-2 xs:w-auto xs:flex-row xs:flex-wrap [&>*]:w-full xs:[&>*]:w-auto";
  return (
    <section className={cn("panel overflow-hidden", className)}>
      <div className={cn("flex flex-col px-5", split ? "items-center text-center md:items-start md:px-8 md:text-left" : "items-center text-center", compact ? "py-7" : "py-9 md:py-10")}>
        {eyebrow && <div className="mono-label mb-2">{eyebrow}</div>}
        <h3 className={cn("display text-text", compact ? "text-[22px]" : "text-[28px] md:text-[34px]")}>{title}</h3>
        {hint && <p className={cn("mt-2.5 max-w-lg leading-relaxed text-text-2", compact ? "text-[12.5px]" : "text-[14px]")}>{hint}</p>}
        {actions && <div className={cn(actionsCls, split ? "items-center md:items-start" : "items-center justify-center")}>{actions}</div>}
      </div>
      {children && <div className="border-t border-line p-4 md:p-5">{children}</div>}
    </section>
  );
}

/** Class names that make a wouter <Link> look like an ActionButton. */
export function linkButton(tone: "brand" | "soft" | "ghost" = "brand", className?: string): string {
  return cn(
    "inline-flex h-11 items-center justify-center gap-2 rounded-[3px] px-4 text-center font-mono text-[12px] font-medium uppercase leading-tight tracking-[0.1em] transition-colors md:h-10 [&>svg]:h-4 [&>svg]:w-4",
    tone === "brand"
      ? "bg-brand text-brand-ink hover:bg-brand/90"
      : tone === "soft"
        ? "border border-line-2 bg-panel-2 text-text hover:border-text-3"
        : "border border-line-2 text-text-2 hover:border-text-3 hover:text-text",
    className,
  );
}
