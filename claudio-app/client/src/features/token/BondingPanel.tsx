// Bonding progress, drawn as an arrow in flight towards a target: the trail fills the track and the arrowhead
// moves with it; the target lights up as the curve nears graduation.
// Curve launchpads show native raised vs graduation target and the migration venue; instant-pool launchpads
// show their synthetic milestone; migrated tokens show where they trade now (arrow in the target).
// Stacked on phones and narrow desktops, one row on wide desktops (xl+).
import { motion, useReducedMotion } from "framer-motion";
import { CHAINS } from "@shared/chains";
import { deploymentOf, LAUNCHPADS } from "@shared/launchpads";
import type { TokenDetail, TokenSnapshot } from "@shared/types";
import { Age, ClaudioSpark } from "@/components/kit";
import { fmtNative, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Concentric-ring target. `hit` fills the bull's-eye. */
function Target({ tone, size = 18 }: { tone: "idle" | "near" | "hit"; size?: number }) {
  const ring = tone === "hit" ? "ring-buy/60" : tone === "near" ? "ring-brand/70" : "ring-line-2";
  const mid = tone === "hit" ? "ring-buy/40" : tone === "near" ? "ring-brand/50" : "ring-line-2/70";
  const eye = tone === "hit" ? "bg-buy" : tone === "near" ? "bg-brand" : "bg-line-2";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full bg-panel ring-1", ring)} style={{ width: size, height: size }} aria-hidden>
      <span className={cn("absolute rounded-full ring-1", mid)} style={{ inset: size * 0.2 }} />
      <span className={cn("relative rounded-full", eye)} style={{ width: size * 0.22, height: size * 0.22 }} />
      {tone === "near" && <span className="absolute inset-0 animate-ping rounded-full ring-1 ring-brand/40 [animation-duration:2.2s]" />}
    </span>
  );
}

/** The flight path: hairline track with distance ticks, a glowing trail and an arrowhead at `pct`. */
function FlightTrack({ pct, tone, className }: { pct: number; tone: "idle" | "near" | "hit"; className?: string }) {
  const reduce = useReducedMotion();
  const p = Math.max(0, Math.min(100, pct));
  const hit = tone === "hit";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-4 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-line" />
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line-2" style={{ left: `${t}%` }} aria-hidden />
        ))}
        <motion.div
          className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${p}%` }}
          transition={{ duration: reduce ? 0 : 0.9, ease: [0.2, 0.9, 0.3, 1] }}
          style={{
            backgroundImage: hit
              ? "linear-gradient(var(--buy), var(--buy))"
              : "linear-gradient(var(--brand), var(--brand))",
            boxShadow: tone === "near" ? "0 0 12px var(--brand-glow)" : undefined,
          }}
        >
          {!hit && (
            <svg viewBox="0 0 10 12" width={10} height={12} className="absolute -right-[7px] top-1/2 -translate-y-1/2 text-brand-2" aria-hidden>
              <path d="M0 0l10 6-10 6 3-6z" fill="currentColor" />
            </svg>
          )}
        </motion.div>
      </div>
      <Target tone={tone} />
    </div>
  );
}

export function BondingPanel({ token, meta, className }: { token: TokenSnapshot; meta?: TokenDetail["launchpadMeta"]; className?: string }) {
  const reduce = useReducedMotion();
  const lp = LAUNCHPADS[token.launchpad];
  const dep = deploymentOf(token.launchpad, token.chain);
  const native = CHAINS[token.chain].nativeSymbol;
  const pct = Math.max(0, Math.min(100, token.bondingPct));
  const migratesTo = meta?.migratesTo ?? dep?.migratesTo ?? token.venue;

  if (token.phase === "migrated") {
    return (
      <div className={cn("panel flex flex-col gap-2.5 px-4 py-3 xl:flex-row xl:items-center xl:gap-5", className)}>
        <div className="flex shrink-0 items-center gap-2">
          <ClaudioSpark className="text-buy" />
          <span className="eyebrow">Graduated</span>
        </div>
        <FlightTrack pct={100} tone="hit" className="xl:max-w-[240px] xl:flex-1" />
        <div className="min-w-0 flex-1 text-xs">
          <div className="truncate font-semibold text-text">
            Trading on {token.venue ?? migratesTo ?? "the AMM"}
          </div>
          <div className="truncate text-text-3">
            {token.migratedAt ? (
              <>
                Migrated <Age from={token.migratedAt} className="text-text-3" /> ago
              </>
            ) : (
              "Trading on the AMM"
            )}
            {token.pool && <span className="num"> · pool {token.pool.slice(0, 6)}…{token.pool.slice(-4)}</span>}
          </div>
        </div>
        <span className="chip chip-buy hidden shrink-0 py-1 font-semibold xl:inline-flex">100%</span>
      </div>
    );
  }

  // `progress` is the measured part, `dest` where the arrow lands.
  let progress: string;
  let dest: string | undefined;
  if (lp.model === "instant" && dep?.milestone) {
    const m = dep.milestone;
    const target = m.unit === "native-liquidity" ? `${fmtNative(m.value)} ${native} liquidity` : `${fmtUsd(m.value, 0)} ${m.unit === "usd-fdv" ? "FDV" : "MC"}`;
    progress = `Milestone: ${target}`;
  } else {
    const grad = meta?.graduationQuote ?? dep?.graduationQuote;
    progress = grad ? `${fmtNative((pct / 100) * grad)} / ${fmtNative(grad)} ${native}` : "Bonding curve";
    dest = migratesTo ? `migrates to ${migratesTo}` : undefined;
  }
  const hot = pct >= 85;
  const title = lp.model === "instant" ? "Milestone" : "Bonding curve";
  const detail = dest ? `${progress} → ${dest}` : progress;

  return (
    <div className={cn("panel flex flex-col gap-2 px-4 py-3 xl:flex-row xl:items-center xl:gap-5", className)}>
      <div className="flex items-center justify-between gap-2 xl:shrink-0 xl:justify-start">
        <span className="flex items-center gap-2">
          <ClaudioSpark className={hot ? "text-brand" : "text-text-3"} />
          <span className="eyebrow">{title}</span>
        </span>
        <motion.span
          key={Math.round(pct)}
          initial={reduce ? false : { y: -4, opacity: 0.4 }}
          animate={{ y: 0, opacity: 1 }}
          className={cn("num text-[15px] font-medium xl:hidden", hot ? "brand-text" : "text-text")}
        >
          {pct.toFixed(pct < 10 ? 1 : 0)}%
        </motion.span>
      </div>

      <FlightTrack pct={pct} tone={hot ? "near" : "idle"} className="xl:flex-1" />

      <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] text-text-3 xl:max-w-[48%] xl:shrink-0 xl:justify-end" title={detail}>
        <span className="num shrink-0 text-text-2">{progress}</span>
        {dest && <span className="min-w-0 truncate xl:max-w-[260px]">→ {dest}</span>}
      </div>

      <motion.span
        key={`d-${Math.round(pct)}`}
        initial={reduce ? false : { y: -4, opacity: 0.4 }}
        animate={{ y: 0, opacity: 1 }}
        className={cn("num hidden min-w-[52px] shrink-0 text-right text-[16px] font-medium xl:block", hot ? "brand-text" : "text-text")}
      >
        {pct.toFixed(pct < 10 ? 1 : 0)}%
      </motion.span>
    </div>
  );
}
