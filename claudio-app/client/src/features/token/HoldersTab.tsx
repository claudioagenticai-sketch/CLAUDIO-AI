// Holders table (pools/curves marked, not counted in analytics) + Top traders by PnL.
import { useMemo } from "react";
import { Crown, Droplets, ExternalLink } from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { Holder, TokenSnapshot, Trade, TraderTag } from "@shared/types";
import { CopyAddress, Empty } from "@/components/kit";
import { fmtCompact, fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TraderTags } from "./TraderTags";
import { addrKey } from "./useTokenData";

function withYou(chain: TokenSnapshot["chain"], mine: Set<string>, address: string, tags: TraderTag[]): TraderTag[] {
  return mine.has(addrKey(chain, address)) && !tags.includes("you") ? ["you", ...tags] : tags;
}

function Pnl({ v }: { v: number }) {
  if (!Number.isFinite(v) || v === 0) return <span className="num text-text-3">—</span>;
  return <span className={cn("num", v > 0 ? "text-buy" : "text-sell")}>{v > 0 ? "+" : "-"}{fmtUsd(Math.abs(v))}</span>;
}

/** Concentration / risk readouts: value, a bar scaled to the "bad" threshold, tinted by severity. */
function Summary({ token }: { token: TokenSnapshot }) {
  const items: { label: string; v: number; warn: number; bad: number; extra?: string }[] = [
    { label: "Top 10", v: token.top10Pct, warn: 30, bad: 50 },
    { label: "Dev", v: token.devHoldPct, warn: 5, bad: 15, extra: token.devSold ? "Dev sold" : undefined },
    { label: "Snipers", v: token.snipersPct, warn: 10, bad: 25 },
    { label: "Insiders", v: token.insidersPct, warn: 10, bad: 25 },
    { label: "Bundlers", v: token.bundlersPct, warn: 10, bad: 25 },
    { label: "Fresh", v: token.freshWalletsPct, warn: 20, bad: 40 },
  ];
  return (
    <div className="grid grid-cols-3 gap-px border-b border-line bg-line md:grid-cols-6">
      {items.map((i) => {
        const tone = i.v >= i.bad ? "bad" : i.v >= i.warn ? "warn" : "ok";
        const fill = Math.max(3, Math.min(100, (i.v / i.bad) * 100));
        return (
          <div key={i.label} className="flex min-w-0 flex-col gap-1.5 bg-bg-elev px-3 py-2.5">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">{i.label}</span>
              {i.extra && <span className="chip chip-sell shrink-0 px-1 py-[2px] text-[9px]">{i.extra}</span>}
            </div>
            <span className={cn("num text-[13px] font-semibold leading-none", tone === "bad" ? "text-sell" : tone === "warn" ? "text-warn" : "text-text")}>
              {fmtPct(i.v, 1)}
            </span>
            <span className="h-[2px] w-full overflow-hidden bg-line" aria-hidden>
              <span
                className={cn("block h-full", tone === "bad" ? "bg-sell" : tone === "warn" ? "bg-warn" : "bg-text-3")}
                style={{ width: `${fill}%` }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function HoldersTab({ token, holders, mine }: { token: TokenSnapshot; holders: Holder[]; mine: Set<string> }) {
  const chain = CHAINS[token.chain];
  const rows = useMemo(() => [...holders].sort((a, b) => b.pct - a.pct).slice(0, 100), [holders]);
  let rank = 0;
  return (
    <div>
      <Summary token={token} />
      {rows.length === 0 ? (
        <Empty title="No holder data yet" hint="Holder analytics fill in as transfers are indexed." />
      ) : (
        <table className="w-full text-[12px]">
          <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
            <tr className="border-b border-line">
              <th className="w-10 px-3 py-2 text-left font-normal">#</th>
              <th className="px-2 py-2 text-left font-normal">Holder</th>
              <th className="px-2 py-2 text-right font-normal">%</th>
              <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">Balance</th>
              <th className="px-3 py-2 text-right font-normal">PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              if (!h.isPool) rank += 1;
              const tags = withYou(token.chain, mine, h.address, h.tags);
              return (
                <tr key={h.address} className={cn("border-b border-line transition-colors hover:bg-panel-2", h.isPool && "opacity-70")}>
                  <td className="num px-3 py-2 text-text-3">{h.isPool ? <Droplets className="h-3.5 w-3.5 text-info" /> : rank}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CopyAddress address={h.address} className="text-[12px] text-text-2" />
                      <a
                        href={chain.explorerAddress(h.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View holder on explorer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] text-text-3 hover:bg-panel-3 hover:text-text"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {h.isPool && <span className="chip chip-info">{token.phase === "migrated" ? "Pool" : "Curve"}</span>}
                      <TraderTags tags={tags} max={2} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="num text-text">{fmtPct(h.pct, 2)}</div>
                    <div className="ml-auto mt-1 h-[2px] w-14 overflow-hidden bg-line">
                      <div className={cn("h-full", h.isPool ? "bg-info" : "bg-text-2")} style={{ width: `${Math.min(100, h.pct * 2)}%` }} />
                    </div>
                  </td>
                  <td className="num hidden px-2 py-2 text-right text-text-2 sm:table-cell">{fmtCompact(h.balance, 2)}</td>
                  <td className="px-3 py-2 text-right">{h.isPool ? <span className="text-text-3">—</span> : <Pnl v={h.pnlUsd} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface TraderRow {
  address: string;
  boughtUsd: number;
  soldUsd: number;
  pnlUsd: number;
  tags: TraderTag[];
  holdingPct?: number;
}

export function TopTradersTab({ token, holders, trades, mine }: { token: TokenSnapshot; holders: Holder[]; trades: Trade[]; mine: Set<string> }) {
  const chain = CHAINS[token.chain];
  const rows = useMemo<TraderRow[]>(() => {
    const map = new Map<string, TraderRow>();
    for (const h of holders) {
      if (h.isPool) continue;
      map.set(addrKey(token.chain, h.address), {
        address: h.address,
        boughtUsd: h.boughtUsd,
        soldUsd: h.soldUsd,
        pnlUsd: h.pnlUsd,
        tags: h.tags,
        holdingPct: h.pct,
      });
    }
    // Traders from the tape that aren't in the holder list (fully exited): realized PnL only.
    const tape = new Map<string, TraderRow>();
    for (const t of trades) {
      const k = addrKey(token.chain, t.trader);
      if (map.has(k)) continue;
      const r = tape.get(k) ?? { address: t.trader, boughtUsd: 0, soldUsd: 0, pnlUsd: 0, tags: t.tags };
      if (t.side === "buy") r.boughtUsd += t.amountUsd;
      else r.soldUsd += t.amountUsd;
      r.pnlUsd = r.soldUsd - r.boughtUsd;
      tape.set(k, r);
    }
    tape.forEach((v, k) => {
      if (v.soldUsd > 0) map.set(k, v);
    });
    return Array.from(map.values())
      .sort((a, b) => b.pnlUsd - a.pnlUsd)
      .slice(0, 50);
  }, [holders, trades, token.chain]);

  if (!rows.length) return <Empty title="No trader PnL yet" hint="Top traders rank by realized + unrealized PnL." />;

  return (
    <table className="w-full text-[12px]">
      <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
        <tr className="border-b border-line">
          <th className="w-10 px-3 py-2 text-left font-normal">#</th>
          <th className="px-2 py-2 text-left font-normal">Trader</th>
          <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">Bought</th>
          <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">Sold</th>
          <th className="px-3 py-2 text-right font-normal">PnL</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.address} className="border-b border-line transition-colors hover:bg-panel-2">
            <td className="num px-3 py-2 text-text-3">
              {i < 3 ? (
                <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-[2px] ring-1 ring-inset", i === 0 ? "text-gold ring-gold/40" : "text-text-2 ring-line-2")}>
                  <Crown className="h-3.5 w-3.5" />
                </span>
              ) : (
                i + 1
              )}
            </td>
            <td className="px-2 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <a href={chain.explorerAddress(r.address)} target="_blank" rel="noopener noreferrer" className="num text-text-2 hover:text-text">
                  {r.address.slice(0, r.address.startsWith("0x") ? 6 : 4)}…{r.address.slice(-4)}
                </a>
                <TraderTags tags={withYou(token.chain, mine, r.address, r.tags)} max={2} />
                {r.holdingPct === undefined && <span className="chip px-1 py-[3px] text-[9px]">exited</span>}
              </div>
            </td>
            <td className="num hidden px-2 py-2 text-right text-buy sm:table-cell">{fmtUsd(r.boughtUsd)}</td>
            <td className="num hidden px-2 py-2 text-right text-sell sm:table-cell">{fmtUsd(r.soldUsd)}</td>
            <td className="px-3 py-2 text-right font-semibold">
              <Pnl v={r.pnlUsd} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
