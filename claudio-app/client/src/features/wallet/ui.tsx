// Shared building blocks for the wallet / portfolio / settings / tracker pages.

import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNative } from "@/lib/format";
import { CHAINS, type ChainId, type ChainKind } from "@shared/chains";
import { passcodeStrength } from "@/lib/wallet/crypto";
import { useNativeBalance } from "@/lib/wallet";
import { ChainBadge } from "@/components/kit";

// ─── Page layout ────────────────────────────────────────────────────

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div
        className={cn(
          "mx-auto w-full max-w-6xl px-4 pt-4 md:px-8 md:pt-7",
          "pb-8 md:pb-12",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Editorial page header: a mono breadcrumb (`Claudio / <eyebrow or title>`), a condensed uppercase title and a lede.
 * `icon` is accepted for older call sites but not drawn — titles are text only.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Replaces the last breadcrumb segment (defaults to the title). */
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 md:mb-8">
      <div className="mono-label flex min-w-0 items-center gap-2">
        <span className="text-brand" aria-hidden>
          /
        </span>
        <span>Claudio</span>
        <span aria-hidden>/</span>
        <span className="truncate text-text-2">{eyebrow ?? title}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5 md:mt-4 md:pb-6">
        <div className="min-w-0 max-w-3xl">
          <h1 className="display-page break-words text-text">{title}</h1>
          {subtitle && <div className="lede mt-3 md:mt-4">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("panel overflow-hidden", className)}>
      {(title || right) && (
        <header className="flex min-h-[44px] items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">
            <span className="truncate">{title}</span>
          </div>
          {right}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Action button: square, mono caps. `brand` = rose fill (primary CTA), `ghost` = hairline outline; ≥44px tall on phones. */
export const ActionButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; tone?: "brand" | "ghost" | "danger" | "soft" }
>(function ActionButton({ className, busy, tone = "brand", children, disabled, ...props }, ref) {
  const toneCls =
    tone === "brand"
      ? "bg-brand text-brand-ink hover:bg-brand/90"
      : tone === "danger"
        ? "border border-sell/45 text-sell hover:bg-sell hover:text-sell-ink"
        : tone === "soft"
          ? "border border-line-2 bg-panel-2 text-text hover:border-text-3"
          : "border border-line-2 text-text-2 hover:border-text-3 hover:text-text";
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-[3px] px-4 text-center font-mono text-[12px] font-medium uppercase leading-tight tracking-[0.1em] transition-colors disabled:pointer-events-none disabled:opacity-50 md:h-10 [&>svg]:h-4 [&>svg]:w-4",
        toneCls,
        className,
      )}
      {...props}
    >
      {busy && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
});

/** Compact segmented control (tabs without the Radix chrome). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  const reduce = useReducedMotion();
  return (
    <div role="tablist" className={cn("relative inline-flex rounded-[3px] p-[3px] ring-1 ring-inset ring-line-2", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 flex-1 whitespace-nowrap rounded-[2px] px-3 font-mono uppercase tracking-[0.1em] transition-colors",
              size === "sm" ? "h-8 text-[10.5px]" : "h-9 text-[11.5px]",
              on ? "text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            {on && (
              <motion.span
                layoutId={reduce ? undefined : `seg-${options.map((x) => x.value).join("-")}`}
                className="absolute inset-0 -z-10 rounded-[2px] bg-panel-3"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Identity ───────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic two-tone orb for an address (no image fetch). Muted so it reads as identity, not decoration. */
export function AddressOrb({ address, size = 36, className, kind }: { address: string; size?: number; className?: string; kind?: ChainKind }) {
  const h = hashStr(address);
  const a = h % 360;
  const b = (a + 60 + ((h >> 9) % 120)) % 360;
  const angle = (h >> 3) % 360;
  return (
    <span
      className={cn("relative inline-block shrink-0 rounded-full ring-1 ring-white/10", className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `conic-gradient(from ${angle}deg, hsl(${a} 32% 50%), hsl(${b} 34% 38%), hsl(${a} 32% 50%))`,
      }}
      aria-hidden
    >
      {kind && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-panel"
          style={{ background: kind === "evm" ? CHAINS.hood.color : CHAINS.sol.color }}
        />
      )}
    </span>
  );
}

export function kindName(kind: ChainKind): string {
  return kind === "evm" ? "EVM" : "Solana";
}

export function chainsForKind(kind: ChainKind): ChainId[] {
  return kind === "evm" ? (["hood", "bsc"] as ChainId[]).filter((c) => CHAINS[c].enabled) : ["sol"];
}

// ─── Balances ───────────────────────────────────────────────────────

export function NativeBalance({ chain, address, className, showChain = true }: { chain: ChainId; address?: string; className?: string; showChain?: boolean }) {
  const { balance, loading } = useNativeBalance(chain, address);
  const c = CHAINS[chain];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)} title={`${c.name} balance`}>
      {showChain && <ChainBadge chain={chain} />}
      {loading ? (
        <span className="sheen inline-block h-3 w-10 rounded bg-panel-3" />
      ) : (
        <span className="num text-text">{balance === undefined ? "—" : fmtNative(balance)}</span>
      )}
      <span className="text-text-3">{c.nativeSymbol}</span>
    </span>
  );
}

// ─── Passcode ───────────────────────────────────────────────────────

export const PasscodeInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    autoFocus?: boolean;
    autoComplete?: "current-password" | "new-password";
    invalid?: boolean;
    onEnter?: () => void;
    id?: string;
    disabled?: boolean;
  }
>(function PasscodeInput({ value, onChange, placeholder = "Passcode", autoFocus, autoComplete = "current-password", invalid, onEnter, id, disabled }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div
      className={cn(
        "flex h-12 items-center rounded-[3px] border bg-bg pl-3 transition-colors focus-within:border-brand focus-within:ring-1 focus-within:ring-brand",
        invalid ? "border-sell" : "border-line-2",
      )}
    >
      <input
        ref={ref}
        id={id}
        type={show ? "text" : "password"}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter?.();
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        className="num h-full min-w-0 flex-1 bg-transparent text-base tracking-wide text-text outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-text-3"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="flex h-12 w-12 shrink-0 items-center justify-center text-text-3 hover:text-text"
        aria-label={show ? "Hide passcode" : "Show passcode"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

export function StrengthMeter({ value }: { value: string }) {
  const s = passcodeStrength(value);
  const colors = ["var(--sell)", "var(--sell)", "var(--warn)", "var(--info)", "var(--buy)"];
  if (!value) return <div className="h-5" />;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden bg-line">
            <div
              className="h-full transition-all duration-300"
              style={{ width: s.score >= i ? "100%" : "0%", background: colors[s.score] }}
            />
          </div>
        ))}
      </div>
      <span className="w-[140px] shrink-0 text-right text-[11px]" style={{ color: colors[s.score] }}>
        {s.label}
        {s.hint ? <span className="text-text-3"> · {s.hint}</span> : null}
      </span>
    </div>
  );
}

/** Returns a countdown (ms) that ticks every second while > 0. */
export function useCountdown(getMs: () => number, deps: unknown[] = []): number {
  const [ms, setMs] = useState(() => getMs());
  useEffect(() => {
    setMs(getMs());
    const t = window.setInterval(() => setMs(getMs()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ms;
}

export function Toggle({ checked, onChange, label, hint, icon }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 py-2">
      <span className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 text-text-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <span className="min-w-0">
          <span className="block text-sm text-text">{label}</span>
          {hint && <span className="mt-0.5 block text-xs text-text-3">{hint}</span>}
        </span>
      </span>
      <SwitchLite checked={checked} onChange={onChange} />
    </label>
  );
}

/** Lightweight switch (bigger thumb on touch). */
export function SwitchLite({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        onChange(!checked);
      }}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-[3px] transition-colors disabled:opacity-50",
        checked ? "bg-brand" : "bg-panel-3 ring-1 ring-inset ring-line-2",
      )}
    >
      <motion.span
        className={cn("absolute top-1 h-5 w-5 rounded-[2px]", checked ? "bg-brand-ink" : "bg-text-2")}
        initial={false}
        animate={{ left: checked ? 24 : 4 }}
        transition={{ type: "spring", stiffness: 600, damping: 35 }}
      />
    </button>
  );
}
