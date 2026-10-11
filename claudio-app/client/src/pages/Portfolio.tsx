// Portfolio — holdings of the active EVM + Solana wallets, value, PnL estimates and recent activity.

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, Coins, ExternalLink, Eye, History, PieChart, RefreshCw, Star, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCompact, fmtNative, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { useHistory, type HistoryTrade } from "@/lib/history";
import { Age, ChainBadge, ChainLogo, CopyAddress, ClaudioSpark, TokenAvatar } from "@/components/kit";
import { CHAINS, ENABLED_CHAINS } from "@shared/chains";
import { useIsMobile } from "@/hooks/use-mobile";
import { openWalletPrompt } from "@/lib/wallet/keystore";
import { usePortfolio, type NativeHolding, type Position } from "@/features/portfolio/usePortfolio";
import { AddressOrb, Card, Page, PageHeader, ActionButton, Segmented } from "@/features/wallet/ui";
import { HeroEmpty, SectionTitle, Steps, TargetRings, linkButton } from "@/features/portfolio/pageKit";

const PALETTE = ["var(--brand)", "var(--brand-2)", "var(--info)", "var(--gold)", "var(--buy)", "var(--warn)", "#c084fc", "#f472b6"];

function usd(v: number): string {
  if (!Number.isFinite(v)) return "$—";
  const abs = Math.abs(v);
  if (abs >= 1e6) return fmtUsd(v, 2);
  return `${v < 0 ? "-" : ""}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedUsd(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${usd(Math.abs(v))}`;
}

function tone(v: number | undefined): string {
  if (v === undefined || v === 0) return "text-text-2";
  return v > 0 ? "text-buy" : "text-sell";
}

// ─── Hero: total value + PnL ────────────────────────────────────────

type Totals = ReturnType<typeof usePortfolio>["totals"];

function Metric({ label, value, valueCls, bar }: { label: string; value: string; valueCls?: string; bar?: { pct: number; positive: boolean } }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow truncate">{label}</div>
      <div className={cn("num mt-1 truncate text-[15px] font-semibold md:text-base", valueCls ?? "text-text")}>{value}</div>
      {bar && (
        <div className="mt-1.5 h-1 overflow-hidden bg-line">
          <div
            className={cn("h-full transition-[width] duration-700", bar.positive ? "bg-buy" : "bg-sell")}
            style={{ width: `${Math.max(2, Math.min(100, bar.pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ValueHero({ totals, error, className, refresh }: { totals: Totals; error: boolean; className?: string; refresh?: ReactNode }) {
  const reduce = useReducedMotion();
  const pnlPct = totals.investedUsd > 0 ? (totals.pnlUsd / totals.investedUsd) * 100 : undefined;
  const max = Math.max(Math.abs(totals.realizedUsd), Math.abs(totals.unrealizedUsd), 1e-9);
  return (
    <section className={cn("panel relative overflow-hidden", className)}>
      <TargetRings size={260} quiet bullseye={false} className="pointer-events-none absolute -right-16 -top-20 hidden opacity-30 sm:block" />
      <div className="relative flex h-full flex-col p-4 md:p-6">
        <div className="flex items-center gap-2">
          <ClaudioSpark />
          <span className="eyebrow">Total value</span>
          <span className="chip ml-auto">estimate</span>
          {refresh}
        </div>
        <motion.div
          key={Math.round(totals.totalUsd)}
          initial={reduce ? false : { opacity: 0.6, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          className="num mt-3 truncate text-[38px] font-medium leading-none tracking-tight md:text-[52px]"
        >
          {usd(totals.totalUsd)}
        </motion.div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              "num inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 font-semibold",
              totals.pnlUsd > 0 ? "bg-buy-bg text-buy" : totals.pnlUsd < 0 ? "bg-sell-bg text-sell" : "text-text-2 ring-1 ring-inset ring-line-2",
            )}
          >
            {signedUsd(totals.pnlUsd)} PnL
            {pnlPct !== undefined && <span className="opacity-80">· {fmtPct(pnlPct, 1, true)}</span>}
          </span>
          <span className="hidden text-[12px] text-text-3 sm:inline">across tokens you traded here</span>
        </div>

        <div className="min-h-6 flex-1" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 md:grid-cols-4">
          <Metric label="Realized" value={signedUsd(totals.realizedUsd)} valueCls={tone(totals.realizedUsd)} bar={{ pct: (Math.abs(totals.realizedUsd) / max) * 100, positive: totals.realizedUsd >= 0 }} />
          <Metric label="Unrealized" value={signedUsd(totals.unrealizedUsd)} valueCls={tone(totals.unrealizedUsd)} bar={{ pct: (Math.abs(totals.unrealizedUsd) / max) * 100, positive: totals.unrealizedUsd >= 0 }} />
          <Metric label="In tokens" value={usd(totals.tokensUsd)} />
          <Metric label="In native" value={usd(totals.nativeUsd)} />
        </div>
        {error && <p className="mt-3 text-xs text-warn">Some balances couldn't be loaded from public RPC — values may be incomplete.</p>}
      </div>
    </section>
  );
}

// ─── Allocation ─────────────────────────────────────────────────────

function Allocation({ positions, natives, className }: { positions: Position[]; natives: NativeHolding[]; className?: string }) {
  const reduce = useReducedMotion();
  const parts = useMemo(() => {
    const list: { label: string; value: number; color: string }[] = [];
    for (const n of natives) if (n.usd && n.usd > 0) list.push({ label: CHAINS[n.chain].nativeSymbol + ` (${CHAINS[n.chain].short})`, value: n.usd, color: CHAINS[n.chain].color });
    positions
      .filter((p) => p.valueUsd > 0)
      .slice(0, 6)
      .forEach((p, i) => list.push({ label: `$${p.symbol}`, value: p.valueUsd, color: PALETTE[i % PALETTE.length] }));
    const rest = positions.filter((p) => p.valueUsd > 0).slice(6).reduce((s, p) => s + p.valueUsd, 0);
    if (rest > 0) list.push({ label: "Other", value: rest, color: "var(--line-2)" });
    return list;
  }, [positions, natives]);
  const total = parts.reduce((s, p) => s + p.value, 0);

  return (
    <Card
      title="Allocation"
      icon={<BarChart3 />}
      right={total > 0 ? <span className="num text-[11px] text-text-3">{parts.length} assets</span> : undefined}
      className={cn("flex flex-col", className)}
      bodyClassName="flex flex-1 flex-col"
    >
      {total <= 0 ? (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <div className="flex h-2.5 gap-0.5">
            {[38, 22, 16, 12, 12].map((w, i) => (
              <span key={i} className="h-full rounded-[3px] bg-panel-3" style={{ width: `${w}%` }} />
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-text-3">Nothing priced yet. Your split between native coins and tokens shows here once you hold something.</p>
        </div>
      ) : (
        <>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[4px]">
            {parts.map((p, i) => (
              <motion.div
                key={`${i}:${p.label}`}
                className="h-full rounded-[3px]"
                style={{ background: p.color }}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(p.value / total) * 100}%` }}
                transition={{ duration: 0.6, delay: i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
                title={`${p.label} · ${usd(p.value)}`}
              />
            ))}
          </div>
          <ul className="mt-3 grid gap-0.5">
            {parts.map((p, i) => (
              <li key={`${i}:${p.label}`} className="grid grid-cols-[10px_minmax(0,1fr)_auto_auto] items-center gap-2.5 border-b border-line px-1 py-1.5 text-[12.5px] last:border-b-0 hover:bg-panel">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                <span className="truncate text-text-2">{p.label}</span>
                <span className="num text-text-3">{usd(p.value)}</span>
                <span className="num w-10 text-right font-semibold text-text">{fmtPct((p.value / total) * 100, 0)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// ─── Native balances ────────────────────────────────────────────────

function NativeTiles({ natives }: { natives: NativeHolding[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 md:gap-3">
      {natives.map((n) => (
        <div key={n.chain} className="panel flex min-w-0 items-center gap-3 px-3.5 py-2.5 md:px-4 md:py-3">
          <ChainLogo chain={n.chain} size={22} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">
              {CHAINS[n.chain].short}
              <span className="font-normal"> · {CHAINS[n.chain].name}</span>
            </div>
            <div className="num mt-0.5 truncate text-[14px] font-semibold md:text-[15px]">
              {n.balance === undefined ? <span className="sheen inline-block h-3.5 w-12 rounded bg-panel-3 align-middle" /> : fmtNative(n.balance)}{" "}
              <span className="text-[11px] font-normal text-text-3">{CHAINS[n.chain].nativeSymbol}</span>
            </div>
          </div>
          <div className="num shrink-0 text-right text-[12px] text-text-2">{n.usd !== undefined ? usd(n.usd) : "—"}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Positions ──────────────────────────────────────────────────────

function tokenHref(p: Position): string {
  return `/t/${p.chain}/${p.address}`;
}

const COLS = "grid-cols-[minmax(0,2.2fr)_repeat(6,minmax(0,1fr))]";

function PositionRow({ p }: { p: Position }) {
  return (
    <Link href={tokenHref(p)} className={cn("grid items-center gap-3 border-b border-line px-4 py-3 text-[13px] transition-colors last:border-0 hover:bg-panel", COLS)}>
      <span className="flex min-w-0 items-center gap-2.5">
        <TokenAvatar image={p.image} symbol={p.symbol} launchpad={p.launchpad} size={30} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-bold">{p.symbol}</span>
            <ChainBadge chain={p.chain} />
            {p.watched && <Star className="h-3 w-3 fill-gold text-gold" />}
          </span>
          <span className="block truncate text-[11px] text-text-3">{p.name ?? p.address}</span>
        </span>
      </span>
      <span className="num text-right text-text-2">{p.balance === undefined && p.held === 0 ? "—" : fmtCompact(p.held, 2)}</span>
      <span className="num text-right text-text-2">{p.priceUsd ? `$${fmtPrice(p.priceUsd)}` : "—"}</span>
      <span className="num text-right font-semibold text-text">{p.valueUsd ? usd(p.valueUsd) : "—"}</span>
      <span className="num text-right text-text-3">{p.avgCostUsd !== undefined ? `$${fmtPrice(p.avgCostUsd)}` : "—"}</span>
      <span className={cn("num text-right", tone(p.unrealizedUsd))}>
        {p.unrealizedUsd !== undefined ? (
          <>
            {signedUsd(p.unrealizedUsd)}
            {p.unrealizedPct !== undefined && <span className="block text-[10px] opacity-80">{fmtPct(p.unrealizedPct, 1, true)}</span>}
          </>
        ) : (
          "—"
        )}
      </span>
      <span className={cn("num text-right", tone(p.realizedUsd))}>{p.realizedUsd ? signedUsd(p.realizedUsd) : "—"}</span>
    </Link>
  );
}

function PositionCard({ p, index }: { p: Position; index: number }) {
  const reduce = useReducedMotion();
  const pnl = (p.unrealizedUsd ?? 0) + p.realizedUsd;
  const hasPnl = p.unrealizedUsd !== undefined || !!p.realizedUsd;
  return (
    <motion.li initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 10) * 0.03 }}>
      <Link href={tokenHref(p)} className="block border-b border-line px-1 py-3 last:border-b-0 active:bg-panel">
        <div className="flex items-center gap-3">
          <TokenAvatar image={p.image} symbol={p.symbol} launchpad={p.launchpad} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-bold">{p.symbol}</span>
              <ChainBadge chain={p.chain} />
              {p.watched && <Star className="h-3 w-3 fill-gold text-gold" />}
            </div>
            <div className="truncate text-[11px] text-text-3">{p.name ?? p.address}</div>
          </div>
          <div className="text-right">
            <div className="num font-medium">{p.valueUsd ? usd(p.valueUsd) : "—"}</div>
            <div className={cn("num text-[11.5px]", tone(hasPnl ? pnl : undefined))}>
              {hasPnl ? signedUsd(pnl) : "—"}
              {p.unrealizedPct !== undefined && <span className="opacity-80"> · {fmtPct(p.unrealizedPct, 1, true)}</span>}
            </div>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-[11px]">
          <span className="min-w-0">
            <span className="block text-text-3">Balance</span>
            <span className="num block truncate text-text-2">{p.balance === undefined && p.held === 0 ? "—" : fmtCompact(p.held, 2)}</span>
          </span>
          <span className="min-w-0">
            <span className="block text-text-3">Price</span>
            <span className="num block truncate text-text-2">{p.priceUsd ? `$${fmtPrice(p.priceUsd)}` : "no price"}</span>
          </span>
          <span className="min-w-0 text-right">
            <span className="block text-text-3">Avg cost</span>
            <span className="num block truncate text-text-2">{p.avgCostUsd !== undefined ? `$${fmtPrice(p.avgCostUsd)}` : "—"}</span>
          </span>
        </div>
      </Link>
    </motion.li>
  );
}

// ─── Activity ───────────────────────────────────────────────────────

function ActivityRow({ t }: { t: HistoryTrade }) {
  const c = CHAINS[t.chain];
  const [chainId, address] = [t.chain, t.key.slice(t.key.indexOf(":") + 1)];
  const statusCls = t.status === "confirmed" ? "chip-buy" : t.status === "failed" ? "chip-sell" : "chip-info";
  const buy = t.side === "buy";
  return (
    <li className="relative flex items-center gap-3 border-b border-line py-2.5 pl-3 pr-1">
      <span aria-hidden className={cn("absolute bottom-2.5 left-0 top-2.5 w-[2px]", buy ? "bg-buy" : "bg-sell")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("chip", buy ? "chip-buy" : "chip-sell")}>{t.side}</span>
          <Link href={`/t/${chainId}/${address}`} className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold hover:text-brand">
            <span className="truncate">${t.symbol}</span>
            <ChainBadge chain={t.chain} />
          </Link>
        </div>
        <div className="num mt-1 truncate text-[11px] text-text-3">
          {fmtNative(t.amountNative)} {c.nativeSymbol} {buy ? "→" : "←"} {fmtCompact(t.amountToken, 2)} {t.symbol}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("chip", statusCls, t.status === "sent" && "animate-pulse-dot")}>{t.status}</span>
        <Age from={t.ts} className="text-[11px]" />
      </div>
      <a
        href={c.explorerTx(t.id)}
        target="_blank"
        rel="noreferrer noopener"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-text md:h-8 md:w-8"
        aria-label="View on explorer"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </li>
  );
}

// ─── No wallet ──────────────────────────────────────────────────────

function NoWallet() {
  return (
    <div className="grid gap-4">
      <HeroEmpty
        split
        icon={<Wallet />}
        eyebrow="No wallet yet"
        title="Your whole book, in one place"
        hint="Create or connect a wallet to see balances and PnL. Keys stay on this device; balances are read straight from chain."
        actions={
          <>
            <ActionButton onClick={() => openWalletPrompt()}>Set up wallet</ActionButton>
            <Link href="/trenches" className={linkButton("ghost")}>
              Browse the Trenches
            </Link>
          </>
        }
      >
        <Steps
          steps={[
            { icon: <Wallet />, title: "Live balances", body: `Native and token balances on ${ENABLED_CHAINS.map((c) => CHAINS[c].short).join(", ")}.` },
            { icon: <Coins />, title: "PnL estimates", body: "Average-cost PnL from trades you place in Claudio." },
            { icon: <History />, title: "Activity", body: "Every buy and sell with live confirmation status." },
          ]}
        />
      </HeroEmpty>
      {/* Ghost preview of what fills in once a wallet exists */}
      <div aria-hidden className="pointer-events-none grid select-none grid-cols-2 gap-2 opacity-50 md:grid-cols-4 md:gap-3">
        {["Total value", "PnL", "Realized", "Unrealized"].map((l) => (
          <div key={l} className="panel border-dashed p-3.5 md:p-4">
            <div className="eyebrow">{l}</div>
            <div className="num mt-1.5 text-[22px] font-medium leading-tight text-text-3 md:text-[26px]">$—</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function Portfolio() {
  const { evm, sol, positions, natives, totals, loading, error, refetch } = usePortfolio();
  const history = useHistory((s) => s.trades);
  const [view, setView] = useState<"holdings" | "all">("holdings");
  const [showAll, setShowAll] = useState(false);
  const mobile = useIsMobile();

  const shown = view === "holdings" ? positions.filter((p) => p.held > 0 || (p.balance ?? 0) > 0) : positions;
  const activity = showAll ? history.slice(0, 200) : history.slice(0, 12);

  if (!evm && !sol) {
    return (
      <Page>
        <PageHeader title="Portfolio" icon={<PieChart />} subtitle="Balances, PnL and activity for your wallets" />
        <NoWallet />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Portfolio"
        icon={<PieChart />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sol && (
              <span className="inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 ring-1 ring-inset ring-line">
                <AddressOrb address={sol.address} size={14} /> <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">SOL</span> <CopyAddress address={sol.address} />
              </span>
            )}
            {evm && (
              <span className="inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 ring-1 ring-inset ring-line">
                <AddressOrb address={evm.address} size={14} /> <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3">EVM</span> <CopyAddress address={evm.address} />
              </span>
            )}
          </span>
        }
        actions={
          mobile ? undefined : (
            <ActionButton tone="ghost" onClick={refetch} aria-label="Refresh balances">
              <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
            </ActionButton>
          )
        }
      />

      {/* Summary */}
      <div className="grid gap-3 md:gap-4 lg:grid-cols-12">
        <ValueHero
          totals={totals}
          error={error}
          className="lg:col-span-7 xl:col-span-8"
          refresh={
            mobile && (
              <button
              type="button"
              onClick={refetch}
              aria-label="Refresh balances"
              className="-my-2 -mr-2 flex h-10 w-10 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-text"
            >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </button>
            )
          }
        />
        <Allocation positions={positions} natives={natives} className="lg:col-span-5 xl:col-span-4" />
      </div>
      <div className="mt-3 md:mt-4">
        <NativeTiles natives={natives} />
      </div>

      <div className="mt-7 grid gap-7">
        {/* Positions */}
        <section className="min-w-0">
          <SectionTitle
            num="01"
            rule
            title="Positions"
            count={shown.length}
            className="mb-3"
            right={
              <Segmented
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: "holdings", label: "Holdings" },
                  { value: "all", label: `All (${positions.length})` },
                ]}
              />
            }
          />
          <div className="panel overflow-hidden">
            {shown.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <TargetRings size={64} />
                <div className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">{view === "holdings" ? "No open positions" : "Nothing tracked yet"}</div>
                <p className="max-w-xs text-xs leading-relaxed text-text-3">Tokens you trade in Claudio and tokens on your watchlist show up here.</p>
                <Link href="/trenches" className={linkButton("soft", "mt-1")}>
                  <Eye /> Find a coin
                </Link>
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <div className={cn("grid gap-3 border-b border-line px-4 py-2.5", COLS)}>
                    {["Token", "Balance", "Price", "Value", "Avg cost", "Unrealized", "Realized"].map((h, i) => (
                      <span key={h} className={cn("eyebrow", i > 0 && "text-right")}>
                        {h}
                      </span>
                    ))}
                  </div>
                  {shown.map((p) => (
                    <PositionRow key={p.key} p={p} />
                  ))}
                </div>
                <ul className="grid px-3 md:hidden">
                  {shown.map((p, i) => (
                    <PositionCard key={p.key} p={p} index={i} />
                  ))}
                </ul>
              </>
            )}
            <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-text-3">
              Balances are read live from chain for your active wallets. Cost basis and PnL are estimates from trades placed in this browser.
            </p>
          </div>
        </section>

        {/* Activity */}
        <section className="min-w-0">
          <SectionTitle num="02" rule title="Recent activity" count={history.length || undefined} className="mb-3" />
          <div className="panel overflow-hidden px-3 pt-1 lg:px-5">
            {history.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
                <div className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">No trades yet</div>
                <p className="max-w-[240px] text-xs leading-relaxed text-text-3">Trades you place from Claudio appear here with live status.</p>
              </div>
            ) : (
              <>
                <ul className="-mb-px lg:grid lg:grid-cols-2 lg:gap-x-8">
                  {activity.map((t) => (
                    <ActivityRow key={t.id} t={t} />
                  ))}
                </ul>
                {history.length > 12 && (
                  <button type="button" onClick={() => setShowAll((s) => !s)} className="relative h-11 w-full border-t border-line font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 hover:text-text">
                    {showAll ? "Show less" : `Show all ${Math.min(history.length, 200)}`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
}
