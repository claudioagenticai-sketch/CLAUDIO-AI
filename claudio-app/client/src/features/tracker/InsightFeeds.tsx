// Tracker market feeds (GMGN via /api/insights/feed/*, polled every 30 s): KOL buys, smart-money trades and signals.
// Wallet → wallet sheet; token → coin page. Without the insights backend each pane says so in one line.
import { memo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { FeedSignal, FeedTrade } from "@shared/insights";
import { Age, TokenAvatar, useNow } from "@/components/kit";
import { useBoard } from "@/lib/store";
import { fmtUsd, shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSignalFeed, useTradeFeed } from "@/features/insights/api";
import { tokenAddressOf, tokenHrefOf } from "@/features/insights/format";
import { SignalBadge } from "@/features/insights/TokenPanels";
import { DataNote } from "@/features/insights/ui";
import { WalletCell } from "@/features/insights/WalletCell";

function FeedPane({ title, right, children, className, note }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; note?: ReactNode }) {
  return (
    <section className={cn("panel flex min-w-0 flex-col overflow-hidden", className)}>
      <header className="flex min-h-[46px] items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <h3 className="flex min-w-0 items-center gap-2 truncate font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">{title}</h3>
        {right}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
      {note && <div className="border-t border-line px-3.5 py-1.5">{note}</div>}
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  return <div className="px-4 py-8 text-center text-[12px] leading-relaxed text-text-3">{what} isn't available right now. It fills in by itself once the data comes back.</div>;
}

function Skeleton() {
  return (
    <div className="space-y-1.5 p-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="sheen h-11 rounded-[2px] bg-panel" />
      ))}
    </div>
  );
}

function TokenLink({ tokenKey, symbol, image, children }: { tokenKey: string; symbol?: string | null; image?: string | null; children?: ReactNode }) {
  const tok = useBoard((s) => s.tokens[tokenKey]);
  const sym = symbol ?? tok?.symbol ?? shortAddr(tokenAddressOf(tokenKey));
  return (
    <Link href={tokenHrefOf(tokenKey)} className="flex min-w-0 items-center gap-1.5 rounded-[3px] py-0.5 pr-1 hover:bg-panel-2">
      <TokenAvatar image={image ?? tok?.image} symbol={sym} launchpad={tok?.launchpad} size={22} className="-m-0.5" />
      <span className="min-w-0 truncate text-[12.5px] font-bold text-text">${sym}</span>
      {children}
    </Link>
  );
}

const TradeRow = memo(function TradeRow({ r }: { r: FeedTrade }) {
  const buy = r.side === "buy";
  return (
    <li className="relative border-b border-line px-3 py-2 last:border-0 hover:bg-panel">
      <span aria-hidden className={cn("absolute bottom-2 left-0 top-2 w-[2px]", buy ? "bg-buy" : "bg-sell")} />
      <div className="flex min-w-0 items-center gap-2 text-[12px]">
        <WalletCell w={r.wallet} maxTags={3} className="min-w-0 flex-1" />
        <Age from={r.at} className="shrink-0 text-[11px] text-text-3" />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className={cn("chip shrink-0", buy ? "chip-buy" : "chip-sell")}>{buy ? "Bought" : "Sold"}</span>
        <div className="min-w-0 flex-1">
          <TokenLink tokenKey={r.tokenKey} symbol={r.symbol} image={r.image} />
        </div>
        <span className={cn("num shrink-0 text-[12.5px] font-semibold", buy ? "text-buy" : "text-sell")}>{fmtUsd(r.amountUsd)}</span>
      </div>
    </li>
  );
});

export function TradeFeedPane({ kind, className, listClassName }: { kind: "kol" | "smart"; className?: string; listClassName?: string }) {
  const [side, setSide] = useState<"all" | "buy">(kind === "kol" ? "buy" : "all");
  const q = useTradeFeed(kind, true, side === "buy" ? "buy" : undefined);
  const rows = q.data?.data ?? [];
  const title = kind === "kol" ? "KOL buys" : "Smart money";
  return (
    <FeedPane
      className={className}
      title={
        <>
          {title}
          {rows.length > 0 && <span className="num text-[11px] font-semibold text-text-3">{rows.length}</span>}
        </>
      }
      right={
        <div className="inline-flex rounded-[3px] p-[2px] ring-1 ring-inset ring-line-2" role="group" aria-label="Side">
          {(["all", "buy"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={side === s}
              onClick={() => setSide(s)}
              className={cn("h-7 rounded-[2px] px-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]", side === s ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2")}
            >
              {s === "all" ? "All" : "Buys"}
            </button>
          ))}
        </div>
      }
      note={rows.length > 0 ? <DataNote source={q.data?.source ?? "gmgn"} partial={q.data?.partial} /> : undefined}
    >
      {q.isLoading ? (
        <Skeleton />
      ) : !rows.length ? (
        <Unavailable what={title} />
      ) : (
        <ul className={cn("overflow-y-auto overscroll-contain", listClassName)}>
          {rows.map((r, i) => (
            <TradeRow key={`${r.tx ?? ""}-${r.wallet.address}-${r.at}-${i}`} r={r} />
          ))}
        </ul>
      )}
    </FeedPane>
  );
}

function SignalRow({ s, now }: { s: FeedSignal; now: number }) {
  return (
    <li className="flex min-w-0 items-center gap-2 border-b border-line px-3 py-2 last:border-0 hover:bg-panel">
      <div className="min-w-0 flex-1">
        <TokenLink tokenKey={s.tokenKey} symbol={s.symbol} image={s.image} />
      </div>
      <SignalBadge s={s} now={now} />
      <span className="num w-[58px] shrink-0 text-right text-[11.5px] text-text-2" data-tip="Market cap when it fired">
        {s.mcapUsd ? fmtUsd(s.mcapUsd) : "—"}
      </span>
    </li>
  );
}

export function SignalFeedPane({ className, listClassName }: { className?: string; listClassName?: string }) {
  const q = useSignalFeed(true);
  const now = useNow();
  const rows = q.data?.data ?? [];
  return (
    <FeedPane
      className={className}
      title={
        <>
          Signals
          {rows.length > 0 && <span className="num text-[11px] font-semibold text-text-3">{rows.length}</span>}
        </>
      }
      note={rows.length > 0 ? <DataNote source={q.data?.source ?? "gmgn"} partial={q.data?.partial} /> : undefined}
    >
      {q.isLoading ? (
        <Skeleton />
      ) : !rows.length ? (
        <Unavailable what="Signals" />
      ) : (
        <ul className={cn("overflow-y-auto overscroll-contain", listClassName)}>
          {rows.map((s, i) => (
            <SignalRow key={`${s.tokenKey}-${s.kind}-${s.at}-${i}`} s={s} now={now} />
          ))}
        </ul>
      )}
    </FeedPane>
  );
}
