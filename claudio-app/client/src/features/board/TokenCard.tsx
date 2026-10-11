// Trenches token card. Two layouts from one component, same anatomy:
//   identity (avatar · symbol · age · CA · socials) → holder metrics strip → badges → flight (bonding) + buy pill
//  - "row": desktop lane card, market numbers stacked top-right
//  - "mobile": compact phone card, market numbers sit next to a thumb-sized buy pill
// Cards are memoized; parents pass stable callbacks. Tooltips use `data-tip` (see TipLayer).
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  ChefHat,
  Crosshair,
  Crown,
  Eye,
  Globe,
  Loader2,
  Megaphone,
  Package,
  Send,
  Sprout,
  Star,
  Users,
  Zap,
} from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { TokenSnapshot } from "@shared/types";
import { Age, CopyAddress, Progress, Stat, TaxBadge, TokenAvatar, VenueLabel } from "@/components/kit";
import { cn } from "@/lib/utils";
import { fmtCompact, fmtNative, fmtPct, fmtUsd } from "@/lib/format";
import { useSettings, type ExecPreset } from "@/lib/store";
import { riskTone, type Tone } from "./filters";
import type { QuickBuyFn } from "./useQuickBuy";
import { boardExtras } from "@/features/insights/board";

export type CardVariant = "row" | "mobile";

export interface TokenCardProps {
  token: TokenSnapshot;
  amount: number;
  preset?: ExecPreset;
  variant: CardVariant;
  watched: boolean;
  onBuy: QuickBuyFn;
  onOpen: (token: TokenSnapshot, newTab: boolean) => void;
}

// ─── helpers ────────────────────────────────────────────────────────

function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) < 1000 ? String(Math.round(n)) : fmtCompact(n, 1);
}

function socialUrl(kind: "twitter" | "telegram" | "website", v: string): string {
  const s = v.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (kind === "twitter") return `https://x.com/${s.replace(/^@/, "")}`;
  if (kind === "telegram") return `https://t.me/${s.replace(/^@/, "")}`;
  return `https://${s}`;
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** Value that flashes green/red when it moves. */
function FlashValue({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  useEffect(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? "flash-up" : "flash-down");
    prev.current = value;
    const t = window.setTimeout(() => setFlash(""), 900);
    return () => window.clearTimeout(t);
  }, [value]);
  return <span className={cn("num rounded px-0.5", flash, className)}>{children}</span>;
}

interface StatDef {
  id: string;
  icon: ReactNode;
  value: string;
  tone: Tone;
  tip: string;
}

/** Guards against partial snapshots from adapters (a missing number must never crash the board). */
function n(v: number | undefined | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
const has = (v: number | undefined | null): v is number => typeof v === "number" && Number.isFinite(v);

/** Holder analytics are known once anything filled them in (our indexer or GMGN); before that zeros mean "unknown". */
function analyticsKnown(t: TokenSnapshot): boolean {
  const x = boardExtras(t);
  return has(x.analyticsAt) || n(t.holders) > 0 || n(t.top10Pct) > 0;
}

function buildStats(src: TokenSnapshot): StatDef[] {
  const x = boardExtras(src);
  const known = analyticsKnown(src);
  const t = {
    holders: n(src.holders),
    top10Pct: n(src.top10Pct),
    devHoldPct: n(src.devHoldPct),
    snipersPct: n(src.snipersPct),
    snipersCount: n(src.snipersCount),
    insidersPct: n(src.insidersPct),
    bundlersPct: n(src.bundlersPct),
    bundlersCount: n(src.bundlersCount),
    freshWalletsPct: n(src.freshWalletsPct),
    kol: Math.max(n(x.kolCount), n(src.kolBuys)),
    smart: Math.max(n(x.smartCount), n(src.smartBuys)),
  };
  const pct = (v: number) => (known ? fmtPct(v) : "—");
  const tone = (v: number, w: number, b: number): Tone => (known ? riskTone(v, w, b) : "neutral");
  const unknownTip = "\n(not known yet)";
  const out: StatDef[] = [
    { id: "holders", icon: <Users />, value: known ? fmtInt(t.holders) : "—", tone: "neutral", tip: known ? `Holders · ${t.holders.toLocaleString()}` : `Holders${unknownTip}` },
    { id: "top10", icon: <Crown />, value: pct(t.top10Pct), tone: tone(t.top10Pct, 20, 30), tip: known ? `Top 10 holders own ${t.top10Pct.toFixed(1)}%\n(pool & curve excluded)` : `Top 10 holders${unknownTip}` },
    { id: "dev", icon: <ChefHat />, value: pct(t.devHoldPct), tone: tone(t.devHoldPct, 5, 10), tip: known ? `Dev holds ${t.devHoldPct.toFixed(1)}%` : `Dev holding${unknownTip}` },
    { id: "snipers", icon: <Crosshair />, value: pct(t.snipersPct), tone: tone(t.snipersPct, 10, 20), tip: known ? `${t.snipersCount} snipers hold ${t.snipersPct.toFixed(1)}%` : `Snipers${unknownTip}` },
    { id: "insiders", icon: <Eye />, value: pct(t.insidersPct), tone: tone(t.insidersPct, 10, 20), tip: known ? `Insiders hold ${t.insidersPct.toFixed(1)}%` : `Insiders${unknownTip}` },
    { id: "bundlers", icon: <Package />, value: pct(t.bundlersPct), tone: tone(t.bundlersPct, 10, 20), tip: known ? `${t.bundlersCount ? `${t.bundlersCount} bundled wallets hold` : "Bundled wallets hold"} ${t.bundlersPct.toFixed(1)}%` : `Bundlers${unknownTip}` },
    { id: "fresh", icon: <Sprout />, value: pct(t.freshWalletsPct), tone: tone(t.freshWalletsPct, 25, 45), tip: known ? `Fresh wallets ${t.freshWalletsPct.toFixed(1)}% of holders` : `Fresh wallets${unknownTip}` },
  ];
  if (has(x.botPct) && known) out.push({ id: "bot", icon: <Bot />, value: fmtPct(x.botPct), tone: riskTone(x.botPct, 30, 50), tip: `Bots make up ${x.botPct.toFixed(1)}% of holders` });
  if (t.kol > 0) out.push({ id: "kol", icon: <Megaphone />, value: String(t.kol), tone: "good", tip: `${t.kol} KOL wallet${t.kol === 1 ? "" : "s"} in` });
  if (t.smart > 0) out.push({ id: "smart", icon: <Brain />, value: String(t.smart), tone: "info", tip: `${t.smart} smart-money wallet${t.smart === 1 ? "" : "s"} in` });
  return out;
}

// ─── pieces ─────────────────────────────────────────────────────────

function Socials({ token, size }: { token: TokenSnapshot; size: "sm" | "md" }) {
  const s = token.socials ?? {};
  const cls = cn(
    "inline-flex items-center justify-center rounded-[2px] text-text-3 transition-colors hover:bg-panel-3 hover:text-text",
    size === "sm" ? "h-5 w-5" : "h-7 w-7",
  );
  const icon = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const followers = n(boardExtras(token).xFollowers);
  if (!s.twitter && !s.telegram && !s.website) return null;
  return (
    <span className="inline-flex shrink-0 items-center">
      {s.twitter && (
        <a
          href={socialUrl("twitter", s.twitter)}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className={cn(cls, followers > 0 && "w-auto gap-0.5 px-1")}
          data-tip={followers > 0 ? `X / Twitter · ${followers.toLocaleString()} followers` : "X / Twitter"}
          aria-label="X"
        >
          <XLogo className={icon} />
          {followers > 0 && <span className="num text-[10.5px] font-semibold">{fmtInt(followers)}</span>}
        </a>
      )}
      {s.telegram && (
        <a href={socialUrl("telegram", s.telegram)} target="_blank" rel="noreferrer" onClick={stop} className={cls} data-tip="Telegram" aria-label="Telegram">
          <Send className={icon} />
        </a>
      )}
      {s.website && (
        <a href={socialUrl("website", s.website)} target="_blank" rel="noreferrer" onClick={stop} className={cls} data-tip="Website" aria-label="Website">
          <Globe className={icon} />
        </a>
      )}
    </span>
  );
}

function hasBadges(t: TokenSnapshot): boolean {
  const showDev = t.devLaunches > 1 || t.devRugs > 0;
  const x = boardExtras(t);
  return Boolean(t.buyTaxBps || t.sellTaxBps || t.dexPaid || x.dexBoost || x.dexAd || x.cto || t.launchedHere || t.stockPaired || showDev || t.devSold || t.alerts?.length);
}

function Badges({ token, className }: { token: TokenSnapshot; className?: string }) {
  const t = token;
  const x = boardExtras(t);
  const devTone = t.devRugs > 0 ? "chip-sell" : t.devMigrations > 0 ? "chip-buy" : "";
  const worst = t.alerts?.reduce<"info" | "warn" | "danger" | null>((acc, a) => {
    if (a.severity === "danger" || acc === "danger") return "danger";
    if (a.severity === "warn" || acc === "warn") return "warn";
    return "info";
  }, null);
  const showDev = t.devLaunches > 1 || t.devRugs > 0;
  if (!hasBadges(t)) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {t.launchedHere && (
        <span className="chip !bg-brand tracking-[0.12em] !text-brand-ink !shadow-none" data-tip="Launched on Claudio · locked 70/30 fee split">
          CLAUDIO
        </span>
      )}
      {t.stockPaired && (
        <span className="chip text-gold" data-tip={`Stock-paired · quote ${t.quoteSymbol}`}>
          ◆ {t.quoteSymbol}
        </span>
      )}
      <TaxBadge buyBps={t.buyTaxBps} sellBps={t.sellTaxBps} />
      {t.dexPaid && (
        <span className="chip chip-info font-semibold" data-tip="DEX Screener profile paid">
          DS
        </span>
      )}
      {x.dexBoost && (
        <span className="chip chip-info font-semibold" data-tip="Boosted on DEX Screener">
          Boost
        </span>
      )}
      {x.dexAd && (
        <span className="chip chip-info font-semibold" data-tip="Running a DEX Screener ad">
          Ad
        </span>
      )}
      {x.cto && (
        <span className="chip chip-brand font-semibold" data-tip="Community took over the coin">
          CTO
        </span>
      )}
      {showDev && (
        <span
          className={cn("chip num", devTone)}
          data-tip={`Dev history (cross-chain)\n${t.devLaunches} launches · ${t.devMigrations} migrated · ${t.devRugs} rugged`}
        >
          dev {t.devLaunches}▸{t.devMigrations}
          {t.devRugs > 0 && <span className="text-sell">·{t.devRugs}☠</span>}
        </span>
      )}
      {t.devSold && (
        <span className="chip chip-sell font-semibold" data-tip="The dev wallet has sold">
          Dev sold
        </span>
      )}
      {worst && (
        <span
          className={cn("chip", worst === "danger" ? "chip-sell" : worst === "warn" ? "chip-warn" : "chip-info")}
          data-tip={t.alerts.slice(0, 4).map((a) => `• ${a.message}`).join("\n")}
        >
          <AlertTriangle className="h-3 w-3" />
          {t.alerts.length}
        </span>
      )}
    </div>
  );
}

/** Holder analytics in one quiet strip. */
function StatStrip({ stats, size }: { stats: StatDef[]; size: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-y-1 rounded-[2px] ring-1 ring-inset ring-line",
        size === "sm" ? "gap-x-2.5 px-2 py-[3px]" : "gap-x-3 px-2.5 py-1.5",
      )}
    >
      {stats.map((s) =>
        size === "sm" ? (
          <span key={s.id} data-tip={s.tip}>
            <Stat icon={s.icon} value={s.value} tone={s.tone} />
          </span>
        ) : (
          <Stat key={s.id} icon={s.icon} value={s.value} tone={s.tone} title={s.tip.replace(/\n/g, " · ")} className="text-[12px]" />
        ),
      )}
    </div>
  );
}

/** 5m buy/sell pressure. */
function TxBar({ buys, sells, total, className }: { buys: number; sells: number; total: number; className?: string }) {
  const sum = buys + sells;
  const pct = sum > 0 ? (buys / sum) * 100 : 50;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-tip={`5m · ${buys} buys / ${sells} sells\n${total.toLocaleString()} txs total`}>
      <span className="text-text-3">TX</span>
      <span className="num text-text-2">{fmtInt(total)}</span>
      <span className="relative h-1 w-8 overflow-hidden bg-sell/80">
        <span className="absolute inset-y-0 left-0 bg-buy" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** The arrow in flight: bonding progress before migration, the AMM venue after. */
function Flight({ token: t, className }: { token: TokenSnapshot; className?: string }) {
  if (t.phase === "migrated") {
    return (
      <div className={cn("flex min-w-0 items-center gap-2 text-[11px]", className)} data-tip={`Graduated${t.venue ? ` to ${t.venue}` : ""}\nLiquidity ${fmtUsd(n(t.liquidityUsd))}`}>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-info">Graduated</span>
        {t.venue && <VenueLabel venue={t.venue} size={12} className="min-w-0 truncate text-text-2" />}
        <span className="ml-auto inline-flex shrink-0 items-baseline gap-1">
          <span className="text-text-3">Liq</span>
          <span className="num text-text-2">{fmtUsd(n(t.liquidityUsd))}</span>
        </span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, n(t.bondingPct)));
  const hot = pct >= 85;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} data-tip={`Bonding curve ${pct.toFixed(1)}%`}>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">Bond</span>
      <Progress pct={pct} className="h-1 min-w-[40px] flex-1" />
      <span className={cn("num w-9 shrink-0 text-right text-[11px]", hot ? "font-semibold text-brand" : "text-text-2")}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function BuyButton({
  token,
  amount,
  preset,
  onBuy,
  size,
}: {
  token: TokenSnapshot;
  amount: number;
  preset?: ExecPreset;
  onBuy: QuickBuyFn;
  size: "sm" | "lg";
}) {
  const [busy, setBusy] = useState(false);
  const sym = CHAINS[token.chain].nativeSymbol;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        void onBuy(token, amount, preset).finally(() => setBusy(false));
      }}
      className={cn(
        "btn-buy num shrink-0 whitespace-nowrap font-medium disabled:opacity-70",
        size === "sm"
          ? "h-7 px-3 text-[12px] group-hover:bg-buy group-hover:text-buy-ink"
          : "h-10 min-w-[104px] px-4 text-[13px]",
      )}
      aria-label={`Quick buy ${token.symbol} for ${fmtNative(amount)} ${sym}`}
      data-tip={`Quick buy · ${preset ?? "preset"}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" fill="currentColor" />}
      {fmtNative(amount)} {sym}
    </button>
  );
}

function WatchStar({ token, watched, size }: { token: TokenSnapshot; watched: boolean; size: "sm" | "md" }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        useSettings.getState().toggleWatch(token.key);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[2px] transition-colors",
        size === "sm" ? "h-5 w-5" : "h-10 w-10",
        watched ? "text-gold" : "text-text-3 hover:text-text",
      )}
      aria-pressed={watched}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      data-tip={watched ? "Watching" : "Watch"}
    >
      <Star className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} fill={watched ? "currentColor" : "none"} />
    </button>
  );
}

// ─── card ───────────────────────────────────────────────────────────

function TokenCardImpl({ token: t, amount, preset, variant, watched, onBuy, onOpen }: TokenCardProps) {
  const stats = buildStats(t);
  const open = (e: MouseEvent | KeyboardEvent) => onOpen(t, e.metaKey || e.ctrlKey);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only when the card itself is focused — Enter on the inner buy/star buttons must not navigate.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(e);
    }
  };
  // Left nock: rose for coins launched here, gold for the watchlist.
  const nock = t.launchedHere ? "shadow-[inset_2px_0_0_var(--brand)]" : watched ? "shadow-[inset_2px_0_0_var(--gold)]" : "";
  const badges = hasBadges(t);

  if (variant === "mobile") {
    return (
      <div
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={onKey}
        className={cn(
          "enter relative mx-3 mb-2 rounded-[3px] border border-line bg-bg-elev p-3 outline-none transition-colors active:bg-panel",
          nock,
        )}
      >
        {/* identity */}
        <div className="flex items-center gap-2.5">
          <TokenAvatar image={t.image} symbol={t.symbol} launchpad={t.launchpad} size={44} className="-m-1" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[15px] font-bold tracking-tight text-text">{t.symbol}</span>
              <span className="min-w-0 truncate text-[12.5px] text-text-3">{t.name}</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <Age from={t.createdAt} className="text-[12px] font-semibold" />
              <span className="h-1 w-1 shrink-0 rounded-full bg-line-2" aria-hidden />
              <CopyAddress address={t.address} className="h-7 text-[12px]" />
              <Socials token={t} size="md" />
            </div>
          </div>
          <WatchStar token={t} watched={watched} size="md" />
        </div>

        <div className="mt-2.5">
          <StatStrip stats={stats} size="md" />
        </div>
        {badges && <Badges token={t} className="mt-2" />}

        {/* market + buy */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">MC</span>
              <FlashValue value={t.mcapUsd} className="text-[16px] font-medium leading-none text-text">
                {fmtUsd(t.mcapUsd)}
              </FlashValue>
            </span>
            <span className="flex min-w-0 items-center gap-3 text-[11.5px]">
              <span className="inline-flex min-w-0 items-baseline gap-1">
                <span className="text-text-3">V</span>
                <span className="num truncate text-text-2">{fmtUsd(t.volume1hUsd)}</span>
              </span>
              <TxBar buys={n(t.buys5m)} sells={n(t.sells5m)} total={n(t.txCount)} className="shrink-0" />
            </span>
          </div>
          <BuyButton token={t} amount={amount} preset={preset} onBuy={onBuy} size="lg" />
        </div>

        <Flight token={t} className="mt-3" />
      </div>
    );
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onAuxClick={(e) => {
        if (e.button === 1) onOpen(t, true);
      }}
      onKeyDown={onKey}
      className={cn(
        "enter group relative cursor-pointer rounded-[3px] border border-line bg-bg-elev p-2.5 outline-none transition-colors",
        "hover:border-line-2 hover:bg-panel focus-visible:border-brand/60 focus-visible:bg-panel",
        nock,
      )}
    >
      {/* identity + market */}
      <div className="flex items-center gap-2">
        <TokenAvatar image={t.image} symbol={t.symbol} launchpad={t.launchpad} size={40} className="-m-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-bold leading-tight tracking-tight text-text">{t.symbol}</span>
            <span className="min-w-0 truncate text-[12px] leading-tight text-text-3">{t.name}</span>
            <WatchStar token={t} watched={watched} size="sm" />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <Age from={t.createdAt} className="text-[11px] font-semibold" />
            <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-line-2" aria-hidden />
            <CopyAddress address={t.address} />
            <Socials token={t} size="sm" />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
          <span className="inline-flex items-baseline gap-1" data-tip={`Market cap\nATH ${fmtUsd(t.athMcapUsd)}`}>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">MC</span>
            <FlashValue value={t.mcapUsd} className="text-[15px] font-medium leading-none text-text">
              {fmtUsd(t.mcapUsd)}
            </FlashValue>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-baseline gap-1" data-tip={`Volume 1h\n5m ${fmtUsd(t.volume5mUsd)} · 24h ${fmtUsd(t.volume24hUsd)}`}>
              <span className="text-text-3">V</span>
              <span className="num text-text-2">{fmtUsd(t.volume1hUsd)}</span>
            </span>
            <TxBar buys={n(t.buys5m)} sells={n(t.sells5m)} total={n(t.txCount)} />
          </span>
        </div>
      </div>

      {/* holder metrics, badges beside them when they fit */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <StatStrip stats={stats} size="sm" />
        {badges && <Badges token={t} />}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Flight token={t} className="flex-1" />
        <BuyButton token={t} amount={amount} preset={preset} onBuy={onBuy} size="sm" />
      </div>
    </div>
  );
}

export const TokenCard = memo(TokenCardImpl);

/** Placeholder while the first snapshot loads. */
export function TokenCardSkeleton({ variant }: { variant: CardVariant }) {
  if (variant === "mobile") {
    return (
      <div className="mx-3 mb-2 rounded-[3px] border border-line bg-bg-elev p-3">
        <div className="flex items-center gap-3">
          <div className="sheen h-11 w-11 rounded-[22%] bg-panel-3" />
          <div className="flex-1 space-y-2">
            <div className="sheen h-3.5 w-2/5 rounded bg-panel-3" />
            <div className="sheen h-3 w-3/5 rounded bg-panel-2" />
          </div>
        </div>
        <div className="sheen mt-3 h-7 rounded-lg bg-panel-2" />
        <div className="mt-3 flex items-center justify-between">
          <div className="sheen h-3.5 w-1/2 rounded bg-panel-2" />
          <div className="sheen h-10 w-[104px] rounded-[3px] bg-panel-3" />
        </div>
        <div className="sheen mt-3 h-1 bg-panel-3" />
      </div>
    );
  }
  return (
    <div className="rounded-[3px] border border-line bg-bg-elev p-2.5">
      <div className="flex items-center gap-2.5">
        <div className="sheen h-10 w-10 rounded-[22%] bg-panel-3" />
        <div className="flex-1 space-y-1.5">
          <div className="sheen h-3 w-1/3 rounded bg-panel-3" />
          <div className="sheen h-2.5 w-1/2 rounded bg-panel-2" />
        </div>
        <div className="space-y-1.5">
          <div className="sheen ml-auto h-3 w-14 rounded bg-panel-3" />
          <div className="sheen ml-auto h-2.5 w-10 rounded bg-panel-2" />
        </div>
      </div>
      <div className="sheen mt-2.5 h-6 rounded-lg bg-panel-2" />
      <div className="mt-2.5 flex items-center gap-3">
        <div className="sheen h-1 flex-1 bg-panel-3" />
        <div className="sheen h-8 w-20 rounded-[3px] bg-panel-3" />
      </div>
    </div>
  );
}
