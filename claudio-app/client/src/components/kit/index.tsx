// Shared Claudio UI primitives. Every feature uses these for a consistent look.
// Add new primitives in new files under components/kit/; don't change these signatures.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtAge, fmtBps, fmtPrice, shortAddr } from "@/lib/format";
import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, SPLIT_LABEL, type LaunchpadId, type SplitSupport } from "@shared/launchpads";
import { useIsMobile } from "@/hooks/use-mobile";
import { CHAIN_LOGOS, LAUNCHPAD_LOGOS, isDarkMark, isSolidMark, venueLogo } from "@/lib/logos";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";

export * from "./brand";

// ─── Live clock (one shared interval for all ages) ──────────────────

const clockListeners = new Set<(n: number) => void>();
let clockTimer: number | undefined;
function subscribeClock(fn: (n: number) => void) {
  clockListeners.add(fn);
  if (clockTimer === undefined) {
    clockTimer = window.setInterval(() => {
      const n = Date.now();
      clockListeners.forEach((l) => l(n));
    }, 1000);
  }
  return () => {
    clockListeners.delete(fn);
    if (!clockListeners.size && clockTimer !== undefined) {
      window.clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => subscribeClock(setNow), []);
  return now;
}

/** Live-ticking age: 9s → 21s → 4m. Fresh tokens (<60s) glow. */
export function Age({ from, className }: { from: number; className?: string }) {
  const now = useNow();
  const fresh = now - from < 60_000;
  return <span className={cn("num", fresh ? "text-brand" : "text-text-2", className)}>{fmtAge(from, now)}</span>;
}

// ─── Identity ───────────────────────────────────────────────────────

/** Official logo image; renders `fallback` when there is no logo or it fails to load. */
export function BrandMark({
  src,
  alt,
  size,
  fallback,
  round = false,
  className,
}: {
  src?: string;
  alt: string;
  size: number;
  fallback: ReactNode;
  /** Clip to a circle (for marks that ship on a solid square background). */
  round?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBroken(true)}
      className={cn("shrink-0", round ? "rounded-full object-cover" : "object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function ChainLogo({ chain, size = 12, className }: { chain: ChainId; size?: number; className?: string }) {
  const c = CHAINS[chain];
  return (
    <BrandMark
      src={CHAIN_LOGOS[chain]}
      alt={c.name}
      size={size}
      className={className}
      fallback={<span className={cn("shrink-0 rounded-full", className)} style={{ width: Math.max(8, size * 0.66), height: Math.max(8, size * 0.66), background: c.color }} />}
    />
  );
}

export function ChainBadge({ chain, className, label = false, size = 12 }: { chain: ChainId; className?: string; label?: boolean; size?: number }) {
  const c = CHAINS[chain];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", className)} title={c.name}>
      <ChainLogo chain={chain} size={size} />
      {label && <span className="text-text-2">{c.short}</span>}
    </span>
  );
}

/** Launchpad mark without the badge ring — for chips, pickers and filter lists. */
export function LaunchpadLogo({ id, size = 16, className }: { id: LaunchpadId; size?: number; className?: string }) {
  const lp = LAUNCHPADS[id];
  return (
    <BrandMark
      src={LAUNCHPAD_LOGOS[id]}
      alt={lp.name}
      size={size}
      round={isSolidMark(id)}
      className={cn(isDarkMark(id) && "rounded-full bg-white p-[12%]", className)}
      fallback={
        <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size, fontSize: size * 0.8, lineHeight: 1 }}>
          {lp.glyph}
        </span>
      }
    />
  );
}

export function LaunchpadBadge({ id, size = 16, className }: { id: LaunchpadId; size?: number; className?: string }) {
  const lp = LAUNCHPADS[id];
  const logo = LAUNCHPAD_LOGOS[id];
  return (
    <span
      title={lp.name}
      className={cn("inline-flex items-center justify-center overflow-hidden rounded-full ring-2 ring-bg", className)}
      style={{ width: size, height: size, background: logo ? (isDarkMark(id) ? "#fff" : "var(--panel-2)") : lp.color, fontSize: size * 0.6, lineHeight: 1 }}
    >
      <BrandMark
        src={logo}
        alt={lp.name}
        size={isSolidMark(id) ? size : Math.round(size * 0.78)}
        round={isSolidMark(id)}
        fallback={<span aria-hidden>{lp.glyph}</span>}
      />
    </span>
  );
}

/** AMM venue name with its exchange mark, e.g. "uniswap-v4". */
export function VenueLabel({ venue, size = 14, className }: { venue: string; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <BrandMark src={venueLogo(venue)} alt="" size={size} fallback={null} />
      {venue}
    </span>
  );
}

/** Token image with launchpad badge and an optional bonding progress ring. */
export function TokenAvatar({
  image,
  symbol,
  launchpad,
  bondingPct,
  size = 56,
  className,
}: {
  image?: string;
  symbol: string;
  launchpad?: LaunchpadId;
  bondingPct?: number;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const r = size / 2 + 3;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, bondingPct ?? 0));
  const hue = pct > 85 ? "var(--brand)" : pct > 50 ? "var(--warn)" : "var(--info)";
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size + 8, height: size + 8 }}>
      {bondingPct !== undefined && (
        <svg className="absolute inset-0 -rotate-90" width={size + 8} height={size + 8}>
          <circle cx={size / 2 + 4} cy={size / 2 + 4} r={r} fill="none" stroke="var(--line)" strokeWidth={2} />
          <circle
            cx={size / 2 + 4}
            cy={size / 2 + 4}
            r={r}
            fill="none"
            stroke={hue}
            strokeWidth={2}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct / 100)}
            strokeLinecap="round"
          />
        </svg>
      )}
      <div
        className="absolute overflow-hidden rounded-[22%] bg-panel-3 ring-1 ring-inset ring-white/5"
        style={{ inset: 4, width: size, height: size }}
      >
        {image && !broken ? (
          <img src={image} alt={symbol} loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-text-3">
            {symbol.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      {launchpad && <LaunchpadBadge id={launchpad} size={Math.max(14, size * 0.3)} className="absolute bottom-0 right-0" />}
    </div>
  );
}

// ─── Data display ───────────────────────────────────────────────────

export function CopyAddress({ address, className, head = 4, tail = 4 }: { address: string; className?: string; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn("num inline-flex items-center gap-1 text-[11px] text-text-3 hover:text-text", className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(address).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copy address"
    >
      {shortAddr(address, head, tail)}
      {copied ? <Check className="h-3 w-3 text-buy" /> : <Copy className="h-3 w-3 opacity-60" />}
    </button>
  );
}

/** Tiny labelled stat used on cards: icon + value, colored by severity. */
export function Stat({
  icon,
  value,
  tone = "neutral",
  title,
  className,
}: {
  icon?: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
  title?: string;
  className?: string;
}) {
  const color =
    tone === "good" ? "text-buy" : tone === "bad" ? "text-sell" : tone === "warn" ? "text-warn" : tone === "info" ? "text-info" : "text-text-2";
  return (
    <span title={title} className={cn("inline-flex items-center gap-0.5 text-[11px]", color, className)}>
      {icon && <span className="opacity-80 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      <span className="num">{value}</span>
    </span>
  );
}

/** Price with subscript zeros; flashes green/red when it changes. */
export function Price({ value, prefix = "$", className }: { value: number; prefix?: string; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  useEffect(() => {
    if (value !== prev.current) {
      setFlash(value > prev.current ? "flash-up" : "flash-down");
      prev.current = value;
      const t = window.setTimeout(() => setFlash(""), 900);
      return () => window.clearTimeout(t);
    }
  }, [value]);
  return (
    <span className={cn("num rounded px-0.5", flash, className)}>
      {prefix}
      {fmtPrice(value)}
    </span>
  );
}

export function TaxBadge({ buyBps, sellBps, className }: { buyBps: number; sellBps: number; className?: string }) {
  if (!buyBps && !sellBps) return null;
  const same = buyBps === sellBps;
  return (
    <span className={cn("chip chip-info", className)} title={`Buy tax ${fmtBps(buyBps)} · Sell tax ${fmtBps(sellBps)}`}>
      Tax {same ? fmtBps(buyBps) : `${fmtBps(buyBps)}/${fmtBps(sellBps)}`}
    </span>
  );
}

export function SplitBadge({ kind, className }: { kind: SplitSupport; className?: string }) {
  const s = SPLIT_LABEL[kind];
  const cls = s.tone === "good" ? "chip-buy" : s.tone === "ok" ? "chip-info" : s.tone === "warn" ? "chip-warn" : "chip-sell";
  return <span className={cn("chip", cls, className)}>{s.label}</span>;
}

/** Thin progress bar (bonding curve): a flat rose fill on a hairline track. */
export function Progress({ pct, className }: { pct: number; className?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-none bg-line", className)}>
      <div className="h-full rounded-none bg-brand transition-[width] duration-500" style={{ width: `${p}%` }} />
    </div>
  );
}

export function LiveDot({ state }: { state: "live" | "simulated" | "offline" | "connecting" }) {
  const color = state === "live" ? "bg-buy" : state === "simulated" ? "bg-warn" : state === "connecting" ? "bg-info" : "bg-sell";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color, state !== "offline" && "animate-pulse-dot")} />;
}

/** Plain empty state: a mono caps line and a hint. `icon` is accepted for older call sites but not drawn. */
export function Empty({ title, hint }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">{title}</div>
      {hint && <div className="max-w-xs text-xs leading-relaxed text-text-3">{hint}</div>}
    </div>
  );
}

// ─── Responsive sheet: Dialog on desktop, bottom Drawer on phones ───

export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className={cn("max-h-[92dvh] rounded-t-[3px] border-line-2 bg-bg-elev", className)}>
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-[calc(16px+var(--safe-bottom))]">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[88vh] overflow-y-auto rounded-[4px] border-line-2 bg-bg-elev sm:max-w-lg sm:rounded-[4px]", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
