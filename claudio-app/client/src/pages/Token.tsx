// Token page — /t/:chain/:address
// Desktop (≥1024px): full-width identity card (header + stats readouts), then a two-column desk:
//   left = bonding flight path, chart (hero), data tabs; right = sticky order ticket + your trades.
// Phone: compact header with a large price, stats grid, bonding, 45vh chart, tabs, and a floating
//   Buy/Sell dock that opens the order ticket in a bottom sheet.
// Hotkeys: B / S focus buy / sell (open the sheet on phones).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { SearchX } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { BRAND } from "@shared/brand";
import { Empty, ResponsiveSheet } from "@/components/kit";
import { fmtUsd } from "@/lib/format";
import { BondingPanel } from "@/features/token/BondingPanel";
import Chart from "@/features/token/Chart";
import { MobileTradeBar } from "@/features/token/MobileTradeBar";
import { StatsStrip } from "@/features/token/StatsStrip";
import { TokenHeader } from "@/features/token/TokenHeader";
import { ClaimBanner } from "@/features/social/ClaimBanner";
import { TokenTabs } from "@/features/token/TokenTabs";
import { useMediaQuery, useTokenData } from "@/features/token/useTokenData";
import { MyTrades } from "@/features/trade/MyTrades";
import TradePanel, { type Side } from "@/features/trade/TradePanel";
import { TokenAgentPanel } from "@/features/token-agent/TokenAgentPanel";
import type { TokenInsights } from "@shared/insights";
import type { TokenSnapshot } from "@shared/types";
import { useTokenInsights } from "@/features/insights/api";
import { DevPanel, SafetyPanel, SignalsBar } from "@/features/insights/TokenPanels";
import { WalletSheetHost } from "@/features/insights/WalletSheet";

function isChain(c: string | undefined): c is ChainId {
  return !!c && Object.prototype.hasOwnProperty.call(CHAINS, c);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** GMGN's real holder count (and liquidity / top-10 where our indexer has none) on top of our snapshot. */
function withInsights(t: TokenSnapshot | undefined, ins: TokenInsights | null | undefined): TokenSnapshot | undefined {
  const s = ins?.stats;
  if (!t || !s) return t;
  const pos = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return {
    ...t,
    holders: pos(s.holders) ?? t.holders,
    liquidityUsd: t.liquidityUsd || pos(s.liquidityUsd) || 0,
    top10Pct: t.top10Pct || (pos(s.top10Pct) ?? 0) * 100,
  };
}

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay, ease: [0.2, 0.9, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}

function Skeleton({ desktop }: { desktop: boolean }) {
  if (!desktop) {
    return (
      <div className="space-y-3 p-3">
        <div className="panel sheen h-[150px]" />
        <div className="panel sheen h-[120px]" />
        <div className="panel sheen" style={{ height: "45vh" }} />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1760px] space-y-4 px-4 py-4 xl:px-5">
      <div className="panel sheen h-[164px]" />
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="panel sheen h-[50px]" />
          <div className="panel sheen h-[548px]" />
        </div>
        <div className="panel sheen h-[560px]" />
      </div>
    </div>
  );
}

export default function Token() {
  const params = useParams() as unknown as Record<string, string | undefined>;
  const chainParam = params.chain;
  const address = safeDecode(params.address ?? "");
  const validChain = isChain(chainParam);
  const chain: ChainId = validChain ? chainParam : "sol";

  const desktop = useMediaQuery("(min-width: 1024px)");
  const data = useTokenData(chain, address, validChain);
  const insightsQ = useTokenInsights(data.key, validChain && !!address);
  const insights = insightsQ.data ?? null;
  const token = useMemo(() => withInsights(data.token, insights), [data.token, insights]);

  const [request, setRequest] = useState<{ side: Side; n: number } | undefined>(undefined);
  const [sheet, setSheet] = useState<{ open: boolean; side: Side; n: number }>({ open: false, side: "buy", n: 0 });

  // "?trade=buy|sell" (Home's Buy button) opens the trade flow on arrival: the sheet on phones, the panel's side on desktop.
  useEffect(() => {
    const side = new URLSearchParams(window.location.search).get("trade");
    if (side !== "buy" && side !== "sell") return;
    if (desktop) setRequest({ side, n: 1 });
    else setSheet({ open: true, side, n: 1 });
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hotkeys: B / S.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k !== "b" && k !== "s") return;
      e.preventDefault();
      const side: Side = k === "b" ? "buy" : "sell";
      if (desktop) setRequest((r) => ({ side, n: (r?.n ?? 0) + 1 }));
      else setSheet((s) => ({ open: true, side, n: s.n + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop]);

  // Tab title: SYMBOL $MC
  useEffect(() => {
    if (!token) return;
    const prev = document.title;
    document.title = `${token.symbol} ${fmtUsd(token.mcapUsd)} · ${BRAND.full}`;
    return () => {
      document.title = prev;
    };
  }, [token?.symbol, token?.mcapUsd]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!validChain) {
    return <Empty title="Unknown chain" hint={`"${chainParam}" isn't a chain Claudio supports.`} icon={<SearchX />} />;
  }

  if (!token) {
    if (data.isLoading) return <Skeleton desktop={desktop} />;
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Empty
          icon={<SearchX />}
          title={data.notFound ? "Token not indexed yet" : "Couldn't load token"}
          hint={
            data.notFound
              ? `We haven't seen ${address.slice(0, 10)}… on ${CHAINS[chain].name}. If it just launched, it'll appear in a few seconds — this page retries automatically.`
              : data.error?.message
          }
        />
        <div className="flex gap-2">
          <button type="button" onClick={data.refetch} className="btn btn-primary">
            Retry
          </button>
          <Link href="/trenches" className="btn btn-secondary">
            Back to the Trenches
          </Link>
        </div>
      </div>
    );
  }

  if (desktop) {
    return (
      <div className="mx-auto w-full max-w-[1760px] space-y-4 px-4 py-4 xl:px-5">
        <Reveal>
          <section className="panel overflow-hidden" aria-label={`${token.symbol} overview`}>
            <TokenHeader token={token} />
            <StatsStrip token={token} insights={insights} className="border-t border-line" />
            <SignalsBar token={token} insights={insights} className="border-t border-line px-5 py-2" />
          </section>
        </Reveal>
        <ClaimBanner chain={token.chain} address={token.address} />
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 space-y-3">
            <Reveal delay={0.05}>
              <BondingPanel token={token} meta={data.detail?.launchpadMeta} />
            </Reveal>
            <Reveal delay={0.08}>
              <Chart token={token} trades={data.trades} myTrades={data.myTrades} height={500} />
            </Reveal>
            <div className="grid grid-cols-2 items-stretch gap-3">
              <SafetyPanel token={token} insights={insights} />
              <DevPanel token={token} insights={insights} />
            </div>
            <Reveal delay={0.1}>
              <TokenAgentPanel token={token} />
            </Reveal>
            <Reveal delay={0.12}>
              <TokenTabs token={token} detail={data.detail} trades={data.trades} mine={data.mine} />
            </Reveal>
          </main>
          <aside className="sticky top-4 min-w-0 space-y-3">
            <Reveal delay={0.06}>
              <TradePanel token={token} request={request} />
            </Reveal>
            <MyTrades token={token} trades={data.myTrades} />
          </aside>
        </div>
        <WalletSheetHost />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 pb-[calc(124px+var(--safe-bottom))]">
        <TokenHeader token={token} compact />
        <div className="space-y-3 px-3">
          <ClaimBanner chain={token.chain} address={token.address} />
          <StatsStrip token={token} insights={insights} className="overflow-hidden rounded-[3px] border border-line" />
          <SignalsBar token={token} insights={insights} className="-mx-3 px-3" />
          <BondingPanel token={token} meta={data.detail?.launchpadMeta} />
          <Chart token={token} trades={data.trades} myTrades={data.myTrades} height="45vh" />
          <SafetyPanel token={token} insights={insights} />
          <DevPanel token={token} insights={insights} />
          <TokenAgentPanel token={token} />
          <MyTrades token={token} trades={data.myTrades} />
          <TokenTabs token={token} detail={data.detail} trades={data.trades} mine={data.mine} />
        </div>
      </div>

      <WalletSheetHost />
      <MobileTradeBar token={token} onOpen={(side) => setSheet((s) => ({ open: true, side, n: s.n + 1 }))} />

      <ResponsiveSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        title={`Trade ${token.symbol}`}
        description={`${CHAINS[token.chain].name} · signed on this device`}
      >
        <TradePanel
          key={`${sheet.side}-${sheet.n}`}
          token={token}
          initialSide={sheet.side}
          bare
          onDone={() => setSheet((s) => ({ ...s, open: false }))}
        />
      </ResponsiveSheet>
    </>
  );
}
