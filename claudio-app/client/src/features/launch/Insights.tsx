// Live insight cards: coin preview (as it will appear on the board), dev-buy simulator and the creator-rewards card.
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Bot, Globe, Send, ShieldCheck, Timer, Wallet } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, type LaunchpadId } from "@shared/launchpads";
import { BRAND } from "@shared/brand";
import { ChainBadge, CopyAddress, LaunchpadBadge, Progress, SplitBadge, TaxBadge, TokenAvatar } from "@/components/kit";
import { fmtCompact, fmtNative, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { XLogo } from "./CoinFields";
import type { DevBuySim } from "./sim";
import { useLaunchDraft } from "./draft";
import { SocialIcon } from "@/features/social/ui";
import { Tile } from "./ui";

// ─── Preview ────────────────────────────────────────────────────────

export function CoinPreview({
  name,
  symbol,
  image,
  launchpad,
  chain,
  sim,
  nativeUsd,
  socials,
  taxBps,
}: {
  name: string;
  symbol: string;
  image?: string;
  launchpad?: LaunchpadId;
  chain: ChainId;
  sim: DevBuySim;
  nativeUsd?: number;
  socials: { twitter?: string; telegram?: string; website?: string };
  taxBps?: { buy: number; sell: number };
}) {
  const lp = launchpad ? LAUNCHPADS[launchpad] : undefined;
  const mcapNative = sim.mcapAfterNative;
  const devTone = sim.supplyPct > 10 ? "text-sell" : sim.supplyPct > 5 ? "text-warn" : "text-buy";
  const hasSocials = !!(socials.twitter || socials.telegram || socials.website);
  return (
    <div className="relative overflow-hidden rounded-[4px] border border-line bg-bg-elev">
      {/* Board-card header band */}
      <div className="relative flex items-center gap-2 border-b border-line px-3.5 py-2">
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-brand" />
        <span className="eyebrow">New pair · preview</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-3">
          <ChainBadge chain={chain} />
          {CHAINS[chain].short}
        </span>
      </div>
      <div className="relative p-3">
        <div className="flex gap-3">
          <TokenAvatar image={image} symbol={symbol || "??"} launchpad={launchpad} bondingPct={lp?.model === "curve" ? sim.curveProgressPct ?? 0 : undefined} size={60} />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-baseline gap-2">
              <span className={cn("truncate text-[17px] font-bold tracking-tight", !symbol && "text-text-3")}>{symbol ? `$${symbol}` : "$TICKER"}</span>
              <span className="num shrink-0 text-[11px] text-brand">0s</span>
            </div>
            <div className={cn("truncate text-[12.5px]", name ? "text-text-2" : "text-text-3")}>{name || "Coin name"}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-3">
              {launchpad && (
                <span className="chip">
                  <LaunchpadBadge id={launchpad} size={12} />
                  {lp?.name}
                </span>
              )}
              {taxBps && (taxBps.buy > 0 || taxBps.sell > 0) && <TaxBadge buyBps={taxBps.buy} sellBps={taxBps.sell} />}
              {hasSocials && (
                <span className="chip gap-1.5">
                  {socials.twitter && <XLogo className="h-3 w-3" />}
                  {socials.telegram && <Send className="h-3 w-3" />}
                  {socials.website && <Globe className="h-3 w-3" />}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 border-y border-line py-2 text-[12px]">
          <span className="min-w-0 truncate">
            <span className="text-text-3">MC </span>
            <span className="num font-semibold">{nativeUsd ? fmtUsd(mcapNative * nativeUsd) : `${fmtNative(mcapNative)} ${CHAINS[chain].nativeSymbol}`}</span>
          </span>
          <span title="Dev holding shown by other terminals" className="ml-auto shrink-0">
            <span className="text-text-3">DEV </span>
            <span className={cn("num font-semibold", devTone)}>{fmtPct(sim.supplyPct, 1)}</span>
          </span>
        </div>
        {lp?.model === "curve" && sim.curveProgressPct !== undefined && (
          <div className="mt-2.5">
            <Progress pct={sim.curveProgressPct} className="h-1.5" />
            <div className="num mt-1 flex justify-between text-[10.5px] text-text-3">
              <span>bonding {fmtPct(sim.curveProgressPct, 1)}</span>
              <span>after your dev buy</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Simulator ──────────────────────────────────────────────────────

const MODEL_LABEL: Record<DevBuySim["model"], string> = {
  pons: "Pons V2 curve",
  pump: "pump.fun curve",
  clanker: "Clanker v4 pool",
  estimate: "Generic curve",
  none: "No model",
};

export function SimulatorCard({ sim, chain, amount, symbol, nativeUsd }: { sim: DevBuySim; chain: ChainId; amount: number; symbol: string; nativeUsd?: number }) {
  const native = CHAINS[chain].nativeSymbol;
  const reduce = useReducedMotion();
  const devTone = sim.supplyPct > 10 ? "bad" : sim.supplyPct > 5 ? "warn" : "good";
  const toneText = devTone === "bad" ? "text-sell" : devTone === "warn" ? "text-warn" : "text-buy";
  const maxSnipe = Math.max(1, ...sim.snipe.map((s) => s.pct));
  // Supply gauge: 0–20% maps onto the bar, with the 5% "filter" line marked.
  const gaugePct = Math.min(100, (sim.supplyPct / 20) * 100);
  return (
    <div className="rounded-[4px] border border-line bg-bg-elev">
      <div className="flex min-h-[44px] items-center gap-2 border-b border-line px-3.5 py-2.5">
        <h3 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">Dev-buy simulator</h3>
        <span className={cn("chip ml-auto", sim.exact ? "chip-buy" : "chip-warn")}>
          {MODEL_LABEL[sim.model]} · {sim.exact ? "exact" : "estimate"}
        </span>
      </div>
      <div className="p-3.5">
        {sim.model === "none" ? (
          <p className="text-[12px] text-text-3">{sim.snipeNote}</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="eyebrow">You receive</div>
                <motion.div
                  key={Math.round(sim.tokensOut)}
                  initial={reduce ? false : { opacity: 0.4, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="num mt-1 truncate text-[28px] font-medium leading-none tracking-tight"
                >
                  {amount > 0 ? fmtCompact(sim.tokensOut, 2) : "0"}
                  <span className="ml-1.5 font-sans text-[13px] font-semibold tracking-normal text-text-3">{symbol ? `$${symbol}` : "tokens"}</span>
                </motion.div>
              </div>
              <div className="shrink-0 text-right">
                <div className="eyebrow">Of supply</div>
                <div className={cn("num mt-1 text-[22px] font-medium leading-none", toneText)}>{fmtPct(sim.supplyPct, 2)}</div>
              </div>
            </div>

            {/* Supply gauge with the 5% line many traders filter on */}
            <div className="relative mt-3">
              <div className="h-1 overflow-hidden bg-line">
                <motion.div
                  className={cn("h-full", devTone === "bad" ? "bg-sell" : devTone === "warn" ? "bg-warn" : "bg-buy")}
                  initial={false}
                  animate={{ width: `${Math.max(1.5, gaugePct)}%` }}
                  transition={{ type: "spring", stiffness: 200, damping: 30 }}
                />
              </div>
              <span className="absolute -top-0.5 h-2.5 w-px bg-text-3" style={{ left: "25%" }} aria-hidden />
              <div className="num relative mt-1 h-3 text-[10px] text-text-3">
                <span className="absolute left-0">0%</span>
                <span className="absolute -translate-x-1/2" style={{ left: "25%" }}>
                  5% filter
                </span>
                <span className="absolute right-0">20%+</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Tile label="Impact" value={fmtPct(sim.priceImpactPct, 1)} tone={sim.priceImpactPct > 50 ? "warn" : undefined} />
              <Tile
                label="MC after"
                value={nativeUsd ? fmtUsd(sim.mcapAfterNative * nativeUsd) : `${fmtNative(sim.mcapAfterNative)}`}
                sub={nativeUsd ? `${fmtNative(sim.mcapAfterNative)} ${native}` : native}
              />
              <Tile label="Price after" value={fmtPrice(sim.priceAfter)} sub={native} />
            </div>
            {sim.clamped && (
              <div className="mt-2 flex gap-1.5 text-[11.5px] text-warn">
                <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" /> Buy is larger than the remaining supply — it will be clamped and the excess refunded.
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 text-[12px] leading-snug">
              <ShieldCheck className={cn("mt-px h-4 w-4 shrink-0", toneText)} />
              <span className="text-text-2">
                Other terminals will show <b className="text-text">dev holding {fmtPct(sim.supplyPct, 2)}</b>
                {sim.supplyPct > 5 ? " — many traders filter out devs above 5%." : "."}
              </span>
            </div>
          </>
        )}

        {/* Snipe timeline */}
        <div className="mt-3.5 border-t border-line pt-3">
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-text-2">
            Anti-snipe window
            {sim.devExempt && sim.snipe.length > 0 && <span className="chip chip-buy ml-auto">you're exempt</span>}
          </div>
          {sim.snipe.length ? (
            <div className="flex h-[70px] items-end gap-1.5">
              {sim.snipe.map((p, i) => (
                <div key={p.t} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[10px] text-text-2">{p.pct >= 10 ? p.pct.toFixed(0) : p.pct >= 1 ? p.pct.toFixed(1) : p.pct.toFixed(2)}%</span>
                  <motion.div
                    className="w-full rounded-[1px]"
                    style={{ background: p.pct > 20 ? "var(--sell)" : p.pct > 2 ? "var(--warn)" : "var(--buy)" }}
                    initial={reduce ? false : { height: 0 }}
                    animate={{ height: `${Math.max(3, (p.pct / maxSnipe) * 40)}px` }}
                    transition={{ delay: reduce ? 0 : i * 0.05, type: "spring", stiffness: 300, damping: 30 }}
                  />
                  <span className="num text-[10px] text-text-3">
                    <Timer className="mr-0.5 inline h-2.5 w-2.5" />
                    {p.t}s
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-snug text-text-3">{sim.snipeNote}</p>
        </div>
      </div>
    </div>
  );
}


// ─── Creator rewards ────────────────────────────────────────────────

/**
 * "Your creator rewards · paid out automatically": who earns and how payouts happen. The exact creator/platform split
 * is shown once, honestly, in the review step before signing (and on /docs/fees) — not headlined here.
 */
export function RewardsCard({
  launchpad,
  chain,
  creator,
  mechanism,
  warnings,
  className,
}: {
  launchpad?: LaunchpadId;
  chain: ChainId;
  creator?: string;
  mechanism?: string;
  warnings?: string[];
  className?: string;
}) {
  const lp = launchpad ? LAUNCHPADS[launchpad] : undefined;
  const feeTo = useLaunchDraft((s) => s.feeTo);
  const agentName = useLaunchDraft((s) => s.agentName || s.agentSlug);
  const socialProvider = useLaunchDraft((s) => s.feeSocialProvider);
  const socialHandle = useLaunchDraft((s) => s.feeSocialHandle.trim().replace(/^@/, ""));
  const feeShares = useLaunchDraft((s) => s.feeShares);
  const svm = CHAINS[chain].kind === "svm";
  const toAgent = svm && feeTo === "agent";
  const social = !svm && feeTo === "social" && socialHandle ? socialHandle : null;
  const split = !svm && feeTo === "split" ? feeShares.filter((x) => x.handle.trim()) : [];
  const auto = svm && launchpad === "pump";
  return (
    <div className={cn("rounded-[4px] border border-line bg-bg-elev p-3.5", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">Where your rewards go</h3>
        {lp && <SplitBadge kind={lp.split} className="ml-auto whitespace-nowrap" />}
      </div>

      <div className="divide-y divide-line border-y border-line text-[12px]">
        <div className="flex min-h-[38px] items-center justify-between gap-2 py-1.5">
          <span className="flex items-center gap-1.5 text-text-3">
            <Wallet className="h-3.5 w-3.5" /> Paid to
          </span>
          {toAgent ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold">
              <Bot className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{agentName ? `${agentName}'s wallet` : "your agent's wallet"}</span>
              <span className="hidden font-normal text-text-3 sm:inline">· run by {BRAND.full}</span>
            </span>
          ) : split.length ? (
            <span className="text-text-2">you + {split.length} account{split.length === 1 ? "" : "s"}</span>
          ) : social ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold">
              <SocialIcon provider={socialProvider} className="h-3.5 w-3.5" />
              <span className="truncate">@{social}</span>
              <span className="hidden font-normal text-text-3 sm:inline">· claims by signing in</span>
            </span>
          ) : creator ? (
            <CopyAddress address={creator} head={6} tail={6} />
          ) : (
            <span className="text-text-3">connect a wallet</span>
          )}
        </div>
        <div className="flex min-h-[38px] items-center justify-between gap-2 py-1.5">
          <span className="flex items-center gap-1.5 text-text-3">
            <Timer className="h-3.5 w-3.5" /> Payouts
          </span>
          <span className="text-right text-text-2">{auto ? "Automatic — no claim needed" : "Harvest from your Creator page"}</span>
        </div>
      </div>

      <p className="mt-2.5 text-[11.5px] leading-snug text-text-3">
        {auto
          ? `Every trade adds to the coin's creator vault on ${lp?.name ?? "the launchpad"}; ${BRAND.full} pays it out to the recipients on a schedule. `
          : ""}
        A platform share comes out of the creator fee — the exact split is shown before you sign.
      </p>
      {mechanism && <p className="mt-1.5 break-words text-[11px] leading-snug text-text-3">{mechanism}</p>}
      {warnings && warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="flex gap-1.5 text-[11.5px] leading-snug">
              <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0 text-warn" />
              <span className="text-text-3">{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
