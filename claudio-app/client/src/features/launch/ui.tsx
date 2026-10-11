// Form primitives for the launch flow (Claudio theme tokens, ≥40px touch targets on phones).
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "todo" | "warn" | "optional" | "active";

/** Numbered step marker: a square mono number, a check once complete. */
export function StepMarker({ step, state = "todo", size = "md" }: { step: number | string; state?: StepState; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-6 w-6 text-[10.5px]" : "h-7 w-7 text-[11px]";
  return (
    <span
      className={cn(
        "num relative flex shrink-0 items-center justify-center rounded-[2px] font-medium transition-colors",
        dim,
        state === "done"
          ? "text-brand ring-1 ring-inset ring-brand/45"
          : state === "active"
            ? "bg-brand text-brand-ink"
            : state === "warn"
              ? "text-warn ring-1 ring-inset ring-warn/40"
              : "bg-bg text-text-2 ring-1 ring-inset ring-line-2",
      )}
    >
      {state === "done" ? <Check className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={3} /> : step}
    </span>
  );
}

export function Section({
  title,
  icon,
  step,
  right,
  children,
  className,
  id,
  subtitle,
  state,
}: {
  title: string;
  icon?: ReactNode;
  step?: number;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  /** One line under the title. */
  subtitle?: ReactNode;
  /** Completion state for the step marker. */
  state?: StepState;
}) {
  return (
    <section id={id} className={cn("scroll-mt-4 rounded-[4px] border border-line bg-bg-elev", className)}>
      <header className="flex min-h-[56px] items-center gap-3 px-4 pb-1 pt-4 md:px-5">
        {step !== undefined && <StepMarker step={step} state={state} />}
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2.5">
            <span className="display-section text-text">{title}</span>
            {state === "optional" && <span className="chip text-text-3">Optional</span>}
          </h2>
          {subtitle && <p className="mt-1 text-[12.5px] leading-snug text-text-3">{subtitle}</p>}
        </div>
        {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
      </header>
      <div className="px-4 pb-4 pt-3 md:px-5 md:pb-5">{children}</div>
    </section>
  );
}

/** A labelled block inside a section (e.g. "Options" under the platform). */
export function SubBlock({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-5 border-t border-line pt-4", className)}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="eyebrow">{label}</span>
        {hint && <span className="text-[11px] text-text-3">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function FieldLabel({
  label,
  htmlFor,
  hint,
  count,
  max,
  required,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  count?: number;
  max?: number;
  required?: boolean;
}) {
  const over = count !== undefined && max !== undefined && count > max;
  const near = count !== undefined && max !== undefined && count > max * 0.85;
  return (
    <div className="mb-1.5 flex min-h-[16px] items-baseline gap-2">
      <label htmlFor={htmlFor} className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-text-2">
        {label}
        {required && <span className="ml-0.5 text-brand">*</span>}
      </label>
      {hint && <span className="text-[11px] text-text-3">{hint}</span>}
      {count !== undefined && max !== undefined && (
        <span className={cn("num ml-auto text-[10.5px]", over ? "text-sell" : near ? "text-warn" : "text-text-3")}>
          {count}/{max}
        </span>
      )}
    </div>
  );
}

export const inputCls =
  "w-full rounded-[3px] border border-line-2 bg-bg px-3 text-[15px] text-text outline-none transition-[border-color,box-shadow] placeholder:text-text-3 hover:border-text-3/60 focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-60 md:text-[13.5px]";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode }>(
  function TextInput({ className, invalid, leading, ...props }, ref) {
    if (leading) {
      return (
        <div className={cn("relative", className)}>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3 [&>svg]:h-4 [&>svg]:w-4">{leading}</span>
          <input ref={ref} {...props} className={cn(inputCls, "h-11 pl-9 md:h-10", invalid && "border-sell focus:border-sell focus:ring-sell/20")} />
        </div>
      );
    }
    return <input ref={ref} {...props} className={cn(inputCls, "h-11 md:h-10", invalid && "border-sell focus:border-sell focus:ring-sell/20", className)} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} {...props} className={cn(inputCls, "min-h-[92px] resize-y py-2.5 leading-relaxed", className)} />;
});

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Segmented control with a sliding highlight (layoutId per instance). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId,
  className,
  size = "md",
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  layoutId: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={cn("flex rounded-[3px] border border-line-2 p-[3px]", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] px-2.5 font-mono font-medium uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-8 text-[10.5px]" : "h-10 text-[11.5px] md:h-9",
              active ? "text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-[2px] bg-panel-3"
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Large selectable cards (radio semantics) — used for "who gets the fees". */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("grid gap-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex min-h-[56px] items-center gap-3 rounded-[3px] border px-3 py-2.5 text-left transition-[border-color,background-color]",
              active ? "border-brand/70 bg-brand-bg/60" : "border-line hover:border-line-2",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[13px] font-bold", active ? "text-text" : "text-text-2")}>{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-[11px] leading-snug text-text-3">{o.hint}</span>}
            </span>
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                active ? "border-brand bg-brand" : "border-line-2",
              )}
              aria-hidden
            >
              {active && <span className="h-1.5 w-1.5 rounded-full bg-brand-ink" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function KV({ label, value, tone, className }: { label: ReactNode; value: ReactNode; tone?: "good" | "warn" | "bad" | "muted"; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5 text-[12.5px]", className)}>
      <span className="shrink-0 text-text-3">{label}</span>
      <span
        className={cn(
          "num min-w-0 text-right",
          tone === "good" ? "text-buy" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-sell" : tone === "muted" ? "text-text-3" : "text-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function Callout({ tone = "warn", children, className }: { tone?: "warn" | "bad" | "info" | "good"; children: ReactNode; icon?: ReactNode; className?: string }) {
  const cls =
    tone === "bad"
      ? "text-sell border-l-sell"
      : tone === "info"
        ? "text-info border-l-info"
        : tone === "good"
          ? "text-buy border-l-buy"
          : "text-warn border-l-warn";
  return (
    <div className={cn("flex gap-2 rounded-[3px] border border-l-2 border-line bg-bg px-3 py-2.5 text-[12px] leading-snug", cls, className)}>
      <div className="min-w-0 text-text-2 [&_b]:font-semibold [&_b]:text-current">{children}</div>
    </div>
  );
}

/** Small stat tile: eyebrow label, mono value, optional sub-line. */
export function Tile({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad"; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-[3px] border border-line px-2.5 py-2", className)}>
      <div className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{label}</div>
      <div
        className={cn(
          "num mt-1 truncate text-[14px] font-semibold",
          tone === "good" ? "text-buy" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-sell" : "text-text",
        )}
      >
        {value}
      </div>
      {sub && <div className="num mt-0.5 truncate text-[10.5px] text-text-3">{sub}</div>}
    </div>
  );
}

/** Retired ornament (concentric rings). Kept as a no-op so older call sites compile; renders nothing. */
export function TargetRings(_props: { className?: string; rings?: number }) {
  return null;
}
