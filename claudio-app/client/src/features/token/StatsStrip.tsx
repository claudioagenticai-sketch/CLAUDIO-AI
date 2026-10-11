// Key market stats as a grid of readouts separated by hairlines: 4 columns on phones (two rows), 8 on wide desktops.
// No card chrome of its own; the page decides whether it sits inside the header card or in its own panel.
// With insights (GMGN) the volume and buys/sells cells switch between 5m / 1h / 24h windows, holders are the real count,
// and fees + bonding come from the token info; without them every cell falls back to our own snapshot.
import { useState, type ReactNode } from "react";
import type { TokenInsights } from "@shared/insights";
import type { TokenSnapshot } from "@shared/types";
import { fmtCompact, fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Whole numbers below 1,000 stay exact ("5", not "5.0"). */
export function fmtCount(n: number): string {
  return Math.abs(n) < 1000 ? String(Math.round(n)) : fmtCompact(n, 1);
}

type Win = "5m" | "1h" | "24h";
const WINS: Win[] = ["5m", "1h", "24h"];

function Cell({ label, short, children, sub, title }: { label: ReactNode; short?: string; children: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div title={title} className="flex min-w-0 flex-col justify-center gap-1 bg-bg-elev px-3 py-2.5 lg:px-4">
      <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3 lg:text-[10px]">
        {short ? (
          <>
            <span className="xl:hidden">{short}</span>
            <span className="hidden xl:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span className="num truncate text-[13px] font-semibold leading-none text-text lg:text-[14px]">{children}</span>
      {sub !== undefined && <span className="num flex h-3 items-center truncate text-[10.5px] leading-none">{sub}</span>}
    </div>
  );
}

function WinToggle({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  const next = WINS[(WINS.indexOf(value) + 1) % WINS.length];
  return (
    <>
      {/* phones: one button that cycles 5m → 1h → 24h */}
      <button
        type="button"
        onClick={() => onChange(next)}
        aria-label={`Window ${value}, switch to ${next}`}
        className="num -my-1 ml-auto h-[18px] shrink-0 rounded-[2px] px-1.5 text-[9.5px] font-medium normal-case ring-1 ring-inset ring-line-2 tracking-normal text-text lg:hidden"
      >
        {value} ⇄
      </button>
      <WinGroup value={value} onChange={onChange} />
    </>
  );
}

function WinGroup({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  return (
    <span className="-my-1 ml-auto hidden shrink-0 rounded-[2px] p-px normal-case tracking-normal ring-1 ring-inset ring-line-2 lg:inline-flex" role="group" aria-label="Time window">
      {WINS.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={value === w}
          onClick={() => onChange(w)}
          className={cn("num h-[18px] rounded-[2px] px-1 text-[9.5px] font-medium", value === w ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2")}
        >
          {w}
        </button>
      ))}
    </span>
  );
}

const pos = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function StatsStrip({ token, insights, className }: { token: TokenSnapshot; insights?: TokenInsights | null; className?: string }) {
  const s = insights?.stats;
  const [win, setWin] = useState<Win>("5m");
  const w = s?.windows?.[win];
  const hasWin = !!s?.windows && Object.keys(s.windows).length > 0;

  // Window numbers: GMGN when present, else our own 5m / 1h / 24h snapshot fields.
  const own = {
    "5m": { buys: token.buys5m, sells: token.sells5m, vol: token.volume5mUsd },
    "1h": { buys: null, sells: null, vol: token.volume1hUsd },
    "24h": { buys: null, sells: null, vol: token.volume24hUsd },
  }[win];
  const buys = w?.buys ?? own.buys;
  const sells = w?.sells ?? own.sells;
  const vol = w?.volumeUsd ?? own.vol;
  const total = (buys ?? 0) + (sells ?? 0);
  const buyShare = total > 0 ? ((buys ?? 0) / total) * 100 : 50;

  const mcap = token.mcapUsd || s?.mcapUsd || 0;
  const liq = token.liquidityUsd || s?.liquidityUsd || 0;
  const liqRatio = mcap > 0 ? (liq / mcap) * 100 : 0;
  const holders = pos(s?.holders) ?? token.holders;
  const top10 = s?.top10Pct != null ? s.top10Pct * 100 : token.top10Pct;
  // ATH: our market-cap high, else GMGN's ATH price scaled by the current price.
  const athFromPrice = pos(s?.athPriceUsd) && token.priceUsd > 0 ? (s!.athPriceUsd! / token.priceUsd) * mcap : null;
  const ath = Math.max(token.athMcapUsd || 0, athFromPrice ?? 0);
  const fromAth = ath > 0 ? ((mcap - ath) / ath) * 100 : 0;
  const atAth = ath > 0 && fromAth >= -0.5;
  const migrated = token.phase === "migrated" || s?.migrated === true;
  const bonding = migrated ? 100 : (s?.bondingPct ?? token.bondingPct);
  const fees = pos(s?.totalFeesUsd);

  return (
    <div className={cn("grid grid-cols-4 gap-px bg-line xl:grid-cols-8", className)}>
      <Cell label="Market cap" short="MCap">
        {fmtUsd(mcap)}
      </Cell>
      <Cell label="Liquidity" sub={<span className="text-text-3">{liqRatio > 0 ? `${fmtPct(liqRatio, liqRatio < 10 ? 1 : 0)} of MC` : "—"}</span>}>
        {liq > 0 ? fmtUsd(liq) : "—"}
      </Cell>
      <Cell
        label={
          <>
            <span>Vol</span>
            <WinToggle value={win} onChange={setWin} />
          </>
        }
        title={`Volume in the last ${win}`}
        sub={
          w ? (
            <span className="truncate">
              <span className="text-buy">{fmtUsd(w.buyVolumeUsd)}</span>
              <span className="text-text-3"> / </span>
              <span className="text-sell">{fmtUsd(w.sellVolumeUsd)}</span>
            </span>
          ) : (
            <span className="text-text-3">{win === "5m" ? `1h ${fmtUsd(token.volume1hUsd)}` : win === "1h" ? `24h ${fmtUsd(token.volume24hUsd)}` : "all trades"}</span>
          )
        }
      >
        {vol ? fmtUsd(vol) : "—"}
      </Cell>
      <Cell
        label={`Buys / sells ${win}`}
        short={`B / S ${win}`}
        title={hasWin ? `Buys and sells in the last ${win}` : undefined}
        sub={
          buys != null ? (
            <span className="flex h-[2px] w-full overflow-hidden bg-sell" aria-hidden>
              <span className="h-full bg-buy transition-[width] duration-500" style={{ width: `${buyShare}%` }} />
            </span>
          ) : (
            <span className="text-text-3">not tracked</span>
          )
        }
      >
        {buys != null ? (
          <>
            <span className="text-buy">{fmtCount(buys)}</span>
            <span className="text-text-3"> / </span>
            <span className="text-sell">{fmtCount(sells ?? 0)}</span>
          </>
        ) : (
          <span className="text-text-3">—</span>
        )}
      </Cell>
      <Cell label="Holders" sub={<span className="text-text-3">Top 10 {top10 > 0 ? fmtPct(top10, 0) : "—"}</span>}>
        {holders > 0 ? fmtCount(holders) : "—"}
      </Cell>
      <Cell
        label={migrated ? "Bonding" : "Bonding curve"}
        short="Bonding"
        sub={
          migrated ? (
            <span className="text-info">graduated</span>
          ) : (
            <span className="flex h-[2px] w-full overflow-hidden bg-line" aria-hidden>
              <span className="h-full bg-brand" style={{ width: `${Math.max(2, Math.min(100, bonding))}%` }} />
            </span>
          )
        }
      >
        {fmtPct(Math.max(0, Math.min(100, bonding)), 0)}
      </Cell>
      {fees ? (
        <Cell label="Fees" title="Trading fees paid on this coin (all time)" sub={<span className="text-text-3">all time</span>}>
          {fmtUsd(fees)}
        </Cell>
      ) : (
        <Cell label="Txns" title="All indexed transactions" sub={<span className="text-text-3">all time</span>}>
          {token.txCount > 0 ? fmtCount(token.txCount) : "—"}
        </Cell>
      )}
      <Cell
        label="ATH"
        title={`All-time-high market cap ${fmtUsd(ath)}`}
        sub={
          ath > 0 ? (
            <span className={atAth ? "text-gold" : "text-text-3"}>
              {atAth ? "at ATH" : fmtPct(fromAth, 0)}
              {!atAth && <span className="hidden xl:inline">&nbsp;from ATH</span>}
            </span>
          ) : (
            <span className="text-text-3">—</span>
          )
        }
      >
        {ath > 0 ? fmtUsd(ath) : "—"}
      </Cell>
    </div>
  );
}
