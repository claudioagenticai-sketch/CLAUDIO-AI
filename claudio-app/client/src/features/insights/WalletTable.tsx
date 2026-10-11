// Holders / Top traders table (one row design for both). Desktop: rank · wallet · % supply · value · avg cost · P&L ·
// buys/sells · first seen. Phones: two-line rows (wallet + activity on the left, share + value and P&L on the right).
// Filter chips by tag sit on top; only tags that occur in the list are offered.
import { memo, useMemo, useState } from "react";
import type { HolderRow, WalletTag } from "@shared/insights";
import { useNow } from "@/components/kit";
import { fmtAge, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isNum, ratioPct, signedUsd } from "./format";
import { WalletCell } from "./WalletCell";
import { WalletTagIcon } from "./WalletTags";

export const FILTER_TAGS: { tag: WalletTag; label: string }[] = [
  { tag: "kol", label: "KOL" },
  { tag: "smart", label: "Smart" },
  { tag: "whale", label: "Whales" },
  { tag: "sniper", label: "Snipers" },
  { tag: "bundler", label: "Bundlers" },
  { tag: "insider", label: "Insiders" },
  { tag: "fresh", label: "Fresh" },
  { tag: "dev", label: "Dev" },
  { tag: "rat", label: "Rats" },
  { tag: "bot", label: "Bots" },
];

export function TagFilter({ rows, value, onChange, className }: { rows: HolderRow[]; value: WalletTag | null; onChange: (t: WalletTag | null) => void; className?: string }) {
  const counts = useMemo(() => {
    const c = new Map<WalletTag, number>();
    for (const r of rows) for (const t of r.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [rows]);
  const chips = FILTER_TAGS.filter((f) => (counts.get(f.tag) ?? 0) > 0);
  if (!chips.length) return null;
  const btn = (on: boolean) =>
    cn(
      "inline-flex h-8 shrink-0 items-center gap-1 rounded-[3px] border px-2 font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors",
      on ? "border-line-2 bg-panel-3 text-text" : "border-line text-text-3 hover:border-line-2 hover:text-text-2",
    );
  return (
    <div className={cn("no-scrollbar flex items-center gap-1.5 overflow-x-auto", className)} role="group" aria-label="Filter by wallet type">
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={btn(value === null)}>
        All <span className="num text-[10px] font-medium opacity-70">{rows.length}</span>
      </button>
      {chips.map((f) => (
        <button key={f.tag} type="button" aria-pressed={value === f.tag} onClick={() => onChange(value === f.tag ? null : f.tag)} className={btn(value === f.tag)}>
          <WalletTagIcon tag={f.tag} size={12} />
          {f.label}
          <span className="num text-[10px] font-medium opacity-70">{counts.get(f.tag)}</span>
        </button>
      ))}
    </div>
  );
}

function totalPnl(r: HolderRow): number | null {
  const a = r.realizedPnlUsd;
  const b = r.unrealizedPnlUsd;
  if (!isNum(a) && !isNum(b)) return null;
  return (isNum(a) ? a : 0) + (isNum(b) ? b : 0);
}

function Pnl({ r, className }: { r: HolderRow; className?: string }) {
  const v = totalPnl(r);
  if (v === null || v === 0) return <span className={cn("num text-text-3", className)}>—</span>;
  return (
    <span
      className={cn("num", v > 0 ? "text-buy" : "text-sell", className)}
      data-tip={`Realized ${isNum(r.realizedPnlUsd) ? signedUsd(r.realizedPnlUsd) : "—"}\nUnrealized ${isNum(r.unrealizedPnlUsd) ? signedUsd(r.unrealizedPnlUsd) : "—"}`}
    >
      {signedUsd(v)}
    </span>
  );
}

function PnlRatio({ v }: { v?: number | null }) {
  if (!isNum(v) || v === 0) return null;
  return <span className={cn("num text-[10.5px]", v > 0 ? "text-buy/80" : "text-sell/80")}>{v > 0 ? "+" : ""}{(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%</span>;
}

function Share({ pct, pool, max }: { pct: number; pool: boolean; max: number }) {
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="num text-text">{ratioPct(pct, 2)}</span>
      <span className="h-[2px] w-14 overflow-hidden bg-line" aria-hidden>
        <span className={cn("block h-full", pool ? "bg-info" : "bg-text-2")} style={{ width: `${Math.max(2, Math.min(100, (pct / max) * 100))}%` }} />
      </span>
    </span>
  );
}

const GRID = "md:grid md:grid-cols-[34px_minmax(0,1.7fr)_minmax(64px,0.6fr)_minmax(64px,0.6fr)_minmax(72px,0.6fr)_minmax(84px,0.7fr)_64px_54px] md:items-center md:gap-2";

const Row = memo(function Row({ r, you, max, now, mode }: { r: HolderRow; you: boolean; max: number; now: number; mode: "holders" | "traders" }) {
  const pool = r.tags.includes("pool");
  const tags = pool ? r.tags.filter((t) => t !== "pool" && t !== "top10") : r.tags;
  return (
    <li className={cn("border-b border-line px-3 py-1.5 text-[12px] transition-colors hover:bg-panel-2 md:px-3.5", you && "bg-brand-bg", pool && "opacity-75", GRID)}>
      {/* phone */}
      <div className="flex items-center gap-2.5 md:hidden">
        <span className="num w-5 shrink-0 text-center text-[11px] text-text-3">{pool ? <WalletTagIcon tag="pool" size={12} /> : r.rank}</span>
        <div className="min-w-0 flex-1">
          <WalletCell w={{ ...r, tags }} you={you} maxTags={4} tools={false} />
          <div className="num mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-text-3">
            {pool ? (
              <span>Pool / curve</span>
            ) : (
              <>
                <span>
                  <span className="text-buy">{isNum(r.buys) ? r.buys : "—"}</span>/<span className="text-sell">{isNum(r.sells) ? r.sells : "—"}</span> tx
                </span>
                {isNum(r.firstSeenAt) && <span>· first buy {fmtAge(r.firstSeenAt, now)} ago</span>}
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-text">{mode === "traders" && isNum(r.usdValue) ? fmtUsd(r.usdValue) : ratioPct(r.pct, 2)}</div>
          <div className="num text-[10.5px] text-text-3">{mode === "traders" ? ratioPct(r.pct, 2) : isNum(r.usdValue) ? fmtUsd(r.usdValue) : "—"}</div>
        </div>
        <div className="w-[68px] shrink-0 text-right">
          {pool ? <span className="text-text-3">—</span> : <Pnl r={r} className="block font-semibold" />}
          {!pool && <PnlRatio v={r.pnlRatio} />}
        </div>
      </div>

      {/* desktop */}
      <span className="num hidden text-text-3 md:block">{pool ? <WalletTagIcon tag="pool" size={13} /> : r.rank}</span>
      <span className="hidden min-w-0 md:block">
        <WalletCell w={{ ...r, tags }} you={you} />
      </span>
      <span className="hidden text-right md:block">
        <Share pct={r.pct} pool={pool} max={max} />
      </span>
      <span className="num hidden text-right text-text-2 md:block">{isNum(r.usdValue) ? fmtUsd(r.usdValue) : "—"}</span>
      <span className="num hidden text-right text-text-2 md:block">{isNum(r.avgCostUsd) && r.avgCostUsd > 0 ? fmtUsd(r.avgCostUsd) : "—"}</span>
      <span className="hidden flex-col items-end md:flex">
        {pool ? <span className="text-text-3">—</span> : <Pnl r={r} className="font-semibold" />}
        {!pool && <PnlRatio v={r.pnlRatio} />}
      </span>
      <span className="num hidden text-right md:block">
        <span className="text-buy">{isNum(r.buys) ? r.buys : "—"}</span>
        <span className="text-text-3">/</span>
        <span className="text-sell">{isNum(r.sells) ? r.sells : "—"}</span>
      </span>
      <span className="num hidden text-right text-text-3 md:block">{isNum(r.firstSeenAt) ? fmtAge(r.firstSeenAt, now) : "—"}</span>
    </li>
  );
});

export function WalletTable({
  rows,
  mine,
  mode,
  filter,
  className,
}: {
  rows: HolderRow[];
  mine: Set<string>;
  mode: "holders" | "traders";
  filter: WalletTag | null;
  className?: string;
}) {
  const now = useNow();
  const shown = useMemo(() => (filter ? rows.filter((r) => r.tags.includes(filter)) : rows), [rows, filter]);
  const max = useMemo(() => Math.max(0.0001, ...rows.filter((r) => !r.tags.includes("pool")).map((r) => r.pct)), [rows]);
  return (
    <div className={className}>
      <div className={cn("hidden border-b border-line px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-3", GRID)}>
        <span>#</span>
        <span>{mode === "holders" ? "Holder" : "Trader"}</span>
        <span className="text-right">Supply</span>
        <span className="text-right">Value</span>
        <span className="text-right">Avg cost</span>
        <span className="text-right">P&amp;L</span>
        <span className="text-right">B / S</span>
        <span className="text-right" data-tip="Time since the first buy">First buy</span>
      </div>
      {shown.length === 0 ? (
        <div className="mono-label px-4 py-8 text-center">No wallets of this type in the list.</div>
      ) : (
        <ul>
          {shown.map((r) => (
            <Row key={r.address} r={r} you={mine.has(r.address)} max={max} now={now} mode={mode} />
          ))}
        </ul>
      )}
    </div>
  );
}
