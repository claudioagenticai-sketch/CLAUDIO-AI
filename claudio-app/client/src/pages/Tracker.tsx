// Tracker — follow wallets (live feed of their trades on tokens Claudio indexes) + watchlist, plus market feeds
// (KOL buys, smart money, signals) from the insights API.

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, BellOff, BellRing, Check, ClipboardPaste, Copy, ExternalLink, Info, Plus, Radar, Star, Tag, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCompact, fmtNative, fmtPct, fmtUsd, shortAddr } from "@/lib/format";
import { haptic, useBoard, useSettings } from "@/lib/store";
import { Age, ChainBadge, Price, TokenAvatar } from "@/components/kit";
import { useIsMobile } from "@/hooks/use-mobile";
import { CHAINS, type ChainId } from "@shared/chains";
import { normAddr } from "@/lib/wallet/keys";
import { Page, PageHeader, ActionButton, Segmented } from "@/features/wallet/ui";
import { useTracker, type TrackedWallet } from "@/features/tracker/store";
import { useTrackerFeed, type FeedItem, type WalletStats } from "@/features/tracker/useTrackerFeed";
import { AddWalletSheet } from "@/features/tracker/AddWalletSheet";
import { SectionTitle, StatTile, Steps, TargetIcon } from "@/features/portfolio/pageKit";
import { SignalFeedPane, TradeFeedPane } from "@/features/tracker/InsightFeeds";
import { WalletSheetHost } from "@/features/insights/WalletSheet";

function walletExplorer(w: TrackedWallet): string {
  return w.kind === "evm" ? CHAINS.hood.explorerAddress(w.address) : CHAINS.sol.explorerAddress(w.address);
}

/** Pane wrapper: a panel with a slim header row (title on the left, controls on the right). */
function Pane({ title, icon, right, children, className, bodyClassName }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("panel flex min-w-0 flex-col overflow-hidden", className)}>
      <header className="flex min-h-[52px] items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">
          <span className="truncate">{title}</span>
        </div>
        {right}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

// ─── Wallet list ────────────────────────────────────────────────────

function WalletItem({
  w,
  stats,
  selected,
  onSelect,
}: {
  w: TrackedWallet;
  stats?: WalletStats;
  selected: boolean;
  onSelect: () => void;
}) {
  const update = useTracker((s) => s.update);
  const remove = useTracker((s) => s.remove);
  const net = (stats?.buyUsd ?? 0) - (stats?.sellUsd ?? 0);
  const [copied, setCopied] = useState(false);
  const total = (stats?.buys ?? 0) + (stats?.sells ?? 0);
  const buyPct = total ? ((stats?.buys ?? 0) / total) * 100 : 0;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      className={cn(
        "relative rounded-[3px] p-3 ring-1 transition-colors",
        selected ? "bg-panel-3 ring-brand/60" : "bg-panel-2 ring-line hover:ring-line-2",
      )}
    >
      {selected && <span aria-hidden className="absolute -left-px bottom-3 top-3 w-[2px] bg-brand" />}
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-pressed={selected}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-xl ring-1 ring-inset ring-line">{w.emoji}</span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold">{w.label}</span>
              <span className="chip">{w.kind === "evm" ? "EVM" : "SOL"}</span>
            </span>
            <span className="num block text-[11px] text-text-3">{shortAddr(w.address, 5, 5)}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            haptic();
            update(w.address, { alerts: !w.alerts });
          }}
          className={cn("flex h-10 w-10 items-center justify-center rounded-[3px] hover:bg-panel-2", w.alerts ? "text-brand" : "text-text-3")}
          aria-label={w.alerts ? "Mute alerts" : "Enable alerts"}
          title={w.alerts ? "Alerts on" : "Alerts off"}
        >
          {w.alerts ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </button>
      </div>

      {/* buy/sell mix */}
      <div className="mt-3 flex h-1 gap-0.5 overflow-hidden bg-line">
        {total > 0 && (
          <>
            <span className="h-full bg-buy" style={{ width: `${buyPct}%` }} />
            <span className="h-full flex-1 bg-sell" />
          </>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-[10.5px]">
        {[
          { l: "Trades", v: String(stats?.trades ?? 0) },
          { l: "Buys", v: String(stats?.buys ?? 0), c: "text-buy" },
          { l: "Sells", v: String(stats?.sells ?? 0), c: "text-sell" },
          { l: "Net", v: stats ? fmtUsd(net) : "—", c: net > 0 ? "text-buy" : net < 0 ? "text-sell" : "" },
        ].map((x, i) => (
          <div key={x.l} className={cn("min-w-0", i === 3 && "text-right")}>
            <div className="font-mono uppercase tracking-[0.1em] text-text-3">{x.l}</div>
            <div className={cn("num truncate text-[12.5px] font-medium", x.c)}>{x.v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[11px] text-text-3">
        <span className="truncate">{stats?.lastTs ? <>last seen <Age from={stats.lastTs} className="text-text-3" /> ago</> : "no trades seen yet"}</span>
        <span className="-mr-1.5 flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(w.address).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
            className="flex h-8 w-8 items-center justify-center rounded-[3px] hover:bg-panel-2 hover:text-text"
            aria-label="Copy address"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-buy" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <a href={walletExplorer(w)} target="_blank" rel="noreferrer noopener" className="flex h-8 w-8 items-center justify-center rounded-[3px] hover:bg-panel-2 hover:text-text" aria-label="Explorer">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button type="button" onClick={() => remove(w.address)} className="flex h-8 w-8 items-center justify-center rounded-[3px] hover:bg-sell-bg hover:text-sell" aria-label="Stop tracking">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </motion.li>
  );
}

function WalletList({
  stats,
  selected,
  onSelect,
  onAdd,
}: {
  stats: Map<string, WalletStats>;
  selected: string | null;
  onSelect: (a: string | null) => void;
  onAdd: () => void;
}) {
  const wallets = useTracker((s) => s.wallets);
  return (
    <Pane
      title={
        <span className="flex items-center gap-2">
          Tracked wallets <span className="num text-[11px] normal-case tracking-normal text-text-3">{wallets.length}</span>
        </span>
      }
      icon={<Users />}
      right={
        <button type="button" onClick={onAdd} className="flex h-9 items-center gap-1 rounded-[3px] px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-brand hover:bg-brand-bg">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      }
      bodyClassName="p-2"
    >
      {wallets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <TargetIcon icon={<Users />} size={60} />
          <div className="mt-1 font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">No wallets tracked</div>
          <p className="max-w-[240px] text-xs leading-relaxed text-text-3">Add whales, KOLs or devs to see their trades live.</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {wallets.map((w) => {
              const n = normAddr(w.address);
              return <WalletItem key={n} w={w} stats={stats.get(n)} selected={selected === n} onSelect={() => onSelect(selected === n ? null : n)} />;
            })}
          </AnimatePresence>
        </ul>
      )}
    </Pane>
  );
}

// ─── Feed ───────────────────────────────────────────────────────────

function FeedRow({ item }: { item: FeedItem }) {
  const reduce = useReducedMotion();
  const tok = useBoard((s) => s.tokens[item.trade.key]);
  const t = item.trade;
  const c = CHAINS[t.chain];
  const address = t.key.slice(t.key.indexOf(":") + 1);
  const buy = t.side === "buy";
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, backgroundColor: buy ? "rgba(61,220,151,0.10)" : "rgba(244,80,111,0.10)" }}
      animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.8 }}
      className="relative border-b border-line last:border-0"
    >
      <span aria-hidden className={cn("absolute bottom-2.5 left-0 top-2.5 w-[2px]", buy ? "bg-buy" : "bg-sell")} />
      <div className="flex items-center gap-3 py-2.5 pl-3.5 pr-3 md:pl-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] text-lg ring-1 ring-inset ring-line" title={item.wallet.label}>
          {item.wallet.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate font-semibold">{item.wallet.label}</span>
            <span className={cn("chip", buy ? "chip-buy" : "chip-sell")}>{buy ? "bought" : "sold"}</span>
          </div>
          <div className="num mt-0.5 truncate text-[11px] text-text-3">
            {fmtNative(t.amountNative)} {c.nativeSymbol} · {fmtCompact(t.amountToken, 1)} tokens · MC ${fmtCompact(t.mcapUsd)}
          </div>
        </div>
        <Link href={`/t/${t.chain}/${address}`} className="flex max-w-[42%] items-center gap-2 rounded-[3px] p-1 pr-1.5 hover:bg-panel-2">
          <TokenAvatar image={tok?.image} symbol={tok?.symbol ?? "?"} launchpad={tok?.launchpad} size={26} />
          <span className="min-w-0 text-right">
            <span className="flex items-center justify-end gap-1 text-[13px] font-bold">
              <span className="truncate">{tok ? `$${tok.symbol}` : shortAddr(address)}</span>
              <ChainBadge chain={t.chain} />
            </span>
            <span className={cn("num block text-[11.5px] font-semibold", buy ? "text-buy" : "text-sell")}>{fmtUsd(t.amountUsd)}</span>
          </span>
        </Link>
        <div className="hidden w-12 shrink-0 flex-col items-end gap-1 sm:flex">
          <Age from={t.ts} className="text-xs" />
          <a href={c.explorerTx(t.tx)} target="_blank" rel="noreferrer noopener" className="text-text-3 hover:text-text" aria-label="Transaction">
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </motion.li>
  );
}

function FeedOnboarding({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-5 py-10 text-center">
        <TargetIcon icon={<Radar />} size={92} className="relative" />
        <div className="mono-label relative">Tracker · feed</div>
        <h3 className="display relative mt-3 text-[30px] text-text md:text-[38px]">Track a wallet to start the feed</h3>
        <p className="relative mt-2 max-w-sm text-[13px] leading-relaxed text-text-3">
          Trades appear here the moment a tracked wallet touches a token Claudio is indexing.
        </p>
        <ActionButton onClick={onAdd} className="relative mt-5">
          <Plus /> Track wallet
        </ActionButton>
      </div>
      <div className="border-t border-line p-3 md:p-4">
        <Steps
          steps={[
            { icon: <ClipboardPaste />, title: "Paste an address", body: "Any public Solana or EVM wallet." },
            { icon: <Tag />, title: "Label it", body: "Whale, KOL, dev — pick an emoji." },
            { icon: <BellRing />, title: "Get alerts", body: "A toast on every buy or sell." },
          ]}
        />
      </div>
    </div>
  );
}

function Feed({ items, selected, onClear, onAdd, className }: { items: FeedItem[]; selected: string | null; onClear: () => void; onAdd: () => void; className?: string }) {
  const wallets = useTracker((s) => s.wallets);
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const shown = items.filter((i) => (!selected || normAddr(i.trade.trader) === selected) && (side === "all" || i.trade.side === side));
  const selWallet = selected ? wallets.find((w) => normAddr(w.address) === selected) : undefined;
  return (
    <Pane
      className={className}
      title={
        <span className="flex items-center gap-2">
          Live feed
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-buy" />
          {items.length > 0 && <span className="num text-[11px] font-semibold text-text-3">{shown.length}</span>}
        </span>
      }
      icon={<Radar />}
      right={
        <Segmented
          size="sm"
          value={side}
          onChange={setSide}
          options={[
            { value: "all", label: "All" },
            { value: "buy", label: "Buys" },
            { value: "sell", label: "Sells" },
          ]}
        />
      }
      bodyClassName="flex flex-col"
    >
      {selWallet && (
        <div className="flex items-center justify-between gap-2 border-b border-line border-l-2 border-l-brand px-3.5 py-1.5 text-xs">
          <span className="min-w-0 truncate text-text-2">
            Showing {selWallet.emoji} <b className="text-text">{selWallet.label}</b> only
          </span>
          <button type="button" onClick={onClear} className="flex h-9 shrink-0 items-center gap-1 rounded-[3px] px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3 hover:bg-panel-2 hover:text-text">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      )}
      {wallets.length === 0 ? (
        <FeedOnboarding onAdd={onAdd} />
      ) : shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center">
          <TargetIcon icon={<Radar />} size={72} />
          <div className="mt-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">No trades seen yet</div>
          <p className="max-w-xs text-xs leading-relaxed text-text-3">Trades appear here the moment a tracked wallet touches a token Claudio is indexing.</p>
        </div>
      ) : (
        <ul className="max-h-[calc(100dvh-300px)] flex-1 overflow-y-auto overscroll-contain md:max-h-[68vh]">
          {shown.map((i) => (
            <FeedRow key={i.trade.id} item={i} />
          ))}
        </ul>
      )}
      <p className="mt-auto flex items-start gap-1.5 border-t border-line px-3.5 py-2.5 text-[11px] leading-relaxed text-text-3">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
        The feed covers tokens Claudio is currently indexing on the board — trades on other tokens or DEXs won't show here.
      </p>
    </Pane>
  );
}

// ─── Watchlist ──────────────────────────────────────────────────────

function Watchlist() {
  const watchlist = useSettings((s) => s.watchlist);
  const toggleWatch = useSettings((s) => s.toggleWatch);
  const tokens = useBoard((s) => s.tokens);
  const rows = useMemo(
    () =>
      watchlist.map((k) => {
        const i = k.indexOf(":");
        return { key: k, chain: k.slice(0, i) as ChainId, address: k.slice(i + 1), token: tokens[k] };
      }),
    [watchlist, tokens],
  );
  return (
    <Pane
      title={
        <span className="flex items-center gap-2">
          Watchlist <span className="num text-[11px] normal-case tracking-normal text-text-3">{watchlist.length}</span>
        </span>
      }
      icon={<Star />}
      bodyClassName="p-1.5"
    >
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <TargetIcon icon={<Star />} size={60} />
          <div className="mt-1 font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">Watchlist is empty</div>
          <p className="max-w-[240px] text-xs leading-relaxed text-text-3">Star tokens on the board or token page.</p>
        </div>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2 rounded-[3px] px-2 py-1.5 hover:bg-panel-2">
              <Link href={`/t/${r.chain}/${r.address}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                <TokenAvatar image={r.token?.image} symbol={r.token?.symbol ?? "?"} launchpad={r.token?.launchpad} bondingPct={r.token?.phase !== "migrated" ? r.token?.bondingPct : undefined} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold">
                    <span className="truncate">{r.token ? `$${r.token.symbol}` : shortAddr(r.address)}</span>
                    {CHAINS[r.chain] && <ChainBadge chain={r.chain} />}
                  </span>
                  <span className="num block truncate text-[11px] text-text-3">{r.token ? `MC $${fmtCompact(r.token.mcapUsd)} · V $${fmtCompact(r.token.volume1hUsd)}` : "Not indexed right now"}</span>
                </span>
                {r.token && (
                  <span className="shrink-0 text-right">
                    <Price value={r.token.priceUsd} className="block text-xs" />
                    <span className={cn("num text-[11px]", r.token.change1hPct >= 0 ? "text-buy" : "text-sell")}>{fmtPct(r.token.change1hPct, 1, true)}</span>
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => toggleWatch(r.key)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-gold hover:bg-panel-2"
                aria-label="Remove from watchlist"
              >
                <Star className="h-4 w-4 fill-gold" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

// ─── Summary ────────────────────────────────────────────────────────

function Summary({ stats, items, compact }: { stats: Map<string, WalletStats>; items: FeedItem[]; compact: boolean }) {
  const wallets = useTracker((s) => s.wallets);
  const alertsOn = wallets.filter((w) => w.alerts).length;
  let buys = 0;
  let sells = 0;
  let net = 0;
  stats.forEach((s) => {
    buys += s.buys;
    sells += s.sells;
    net += s.buyUsd - s.sellUsd;
  });
  const netTone = net > 0 ? "text-buy" : net < 0 ? "text-sell" : "text-text";
  const mix = (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-buy">{buys}</span>
      <span className="text-text-3">/</span>
      <span className="text-sell">{sells}</span>
    </span>
  );
  if (compact) {
    const cells = [
      { l: "Tracked", v: <>{wallets.length}</> },
      { l: "Trades", v: <>{items.length}</> },
      { l: "Buy/sell", v: mix },
      { l: "Net", v: <span className={netTone}>{stats.size ? fmtUsd(net) : "—"}</span> },
    ];
    return (
      <div className="panel mb-3 grid grid-cols-4 divide-x divide-line">
        {cells.map((c) => (
          <div key={c.l} className="min-w-0 px-2.5 py-2.5 text-center">
            <div className="num truncate text-[15px] font-medium">{c.v}</div>
            <div className="mt-0.5 truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">{c.l}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mb-5 grid grid-cols-4 gap-3">
      <StatTile label="Tracked" value={wallets.length} sub={`${alertsOn} with alerts on`} icon={<Users />} />
      <StatTile label="Trades seen" value={items.length} sub="on indexed tokens" icon={<Radar />} />
      <StatTile label="Buys / sells" value={mix} sub="across tracked wallets" />
      <StatTile label="Net flow" value={stats.size ? fmtUsd(net) : "—"} tone={net > 0 ? "buy" : net < 0 ? "sell" : "neutral"} sub="bought minus sold" />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function Tracker() {
  const { items, stats } = useTrackerFeed();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"feed" | "kol" | "smart" | "signals" | "wallets" | "watch">("feed");
  const walletCount = useTracker((s) => s.wallets.length);
  const watchCount = useSettings((s) => s.watchlist.length);
  const mobile = useIsMobile();

  const list = <WalletList stats={stats} selected={selected} onSelect={setSelected} onAdd={() => setAdding(true)} />;
  const feed = <Feed items={items} selected={selected} onClear={() => setSelected(null)} onAdd={() => setAdding(true)} className="min-h-[inherit]" />;

  return (
    <Page>
      <PageHeader
        title="Tracker"
        icon={<Radar />}
        subtitle="Follow wallets and watch tokens in real time"
        actions={
          <ActionButton onClick={() => setAdding(true)}>
            <Plus /> Track wallet
          </ActionButton>
        }
      />

      <Summary stats={stats} items={items} compact={mobile} />

      {mobile ? (
        <div>
          <div className="no-scrollbar -mx-4 mb-3 overflow-x-auto px-4">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "feed", label: `Feed${items.length ? ` · ${items.length}` : ""}` },
                { value: "kol", label: "KOL buys" },
                { value: "smart", label: "Smart money" },
                { value: "signals", label: "Signals" },
                { value: "wallets", label: `Wallets · ${walletCount}` },
                { value: "watch", label: `Watch · ${watchCount}` },
              ]}
              className="min-w-full"
            />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
              {tab === "feed" && feed}
              {tab === "kol" && <TradeFeedPane kind="kol" />}
              {tab === "smart" && <TradeFeedPane kind="smart" />}
              {tab === "signals" && <SignalFeedPane />}
              {tab === "wallets" && list}
              {tab === "watch" && <Watchlist />}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="grid min-w-0 content-start gap-4">
            <SectionTitle num="01" title="Wallets & watchlist" className="-mb-1" />
            {list}
            <Watchlist />
          </div>
          <div className="flex min-w-0 flex-col gap-4 md:sticky md:top-0">
            <SectionTitle num="02" title="Activity" className="-mb-1" right={selected ? <span className="chip chip-brand">filtered</span> : undefined} />
            <div className="min-h-[480px]">{feed}</div>
          </div>
        </div>
      )}

      {!mobile && (
        <section className="mt-6 min-w-0" aria-label="Market activity">
          <SectionTitle num="03" rule title="Market activity" className="mb-3" />
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TradeFeedPane kind="kol" listClassName="max-h-[520px]" />
            <TradeFeedPane kind="smart" listClassName="max-h-[520px]" />
            <SignalFeedPane listClassName="max-h-[520px]" className="md:col-span-2 xl:col-span-1" />
          </div>
        </section>
      )}

      <AddWalletSheet open={adding} onOpenChange={setAdding} />
      <WalletSheetHost />
    </Page>
  );
}
