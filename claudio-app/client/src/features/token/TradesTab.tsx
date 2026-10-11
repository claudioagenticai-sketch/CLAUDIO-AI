// Live trade tape. New rows slide in + flash by side; filter chips with buy/sell counts; MC/price column toggle.
// Traders we know from the holders / top-traders lists (GMGN) carry their name and tag icons; a click opens the wallet sheet.
import { useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { WalletIdentity, WalletTag } from "@shared/insights";
import type { TokenSnapshot, Trade, TraderTag } from "@shared/types";
import { Empty, useNow } from "@/components/kit";
import { fmtAge, fmtCompact, fmtNative, fmtPrice, fmtUsd, shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TraderTags } from "./TraderTags";
import { openWallet } from "@/features/insights/WalletSheet";
import { WalletTags } from "@/features/insights/WalletTags";

type Filter = "all" | "buy" | "sell" | "dev" | "kol" | "smart" | "sniper" | "you" | "whale";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buy", label: "Buys" },
  { id: "sell", label: "Sells" },
  { id: "kol", label: "KOL" },
  { id: "smart", label: "Smart" },
  { id: "dev", label: "Dev" },
  { id: "sniper", label: "Snipers" },
  { id: "whale", label: "Whales" },
  { id: "you", label: "You" },
];

const MAX_ROWS = 150;
const NO_IDS = new Map<string, WalletIdentity>();
/** Our own tags that GMGN doesn't have; shown next to the identity icons. */
const OWN_ONLY: TraderTag[] = ["you", "tracked"];

function match(t: Trade, f: Filter, id?: WalletIdentity): boolean {
  if (f === "all") return true;
  if (f === "buy" || f === "sell") return t.side === f;
  return t.tags.includes(f as TraderTag) || (f !== "you" && !!id?.tags.includes(f as WalletTag));
}

function TraderName({ t, id, head = 4 }: { t: Trade; id?: WalletIdentity; head?: number }) {
  return (
    <button
      type="button"
      onClick={() => openWallet(t.trader, id ?? null, t.chain)}
      className={cn("min-w-0 truncate text-left hover:text-text", id?.name ? "max-w-[120px] font-semibold text-text" : "num text-text-2")}
      title={id?.name ? `${id.name} · ${t.trader}` : t.trader}
    >
      {id?.name ?? shortAddr(t.trader, head, 4)}
    </button>
  );
}

function Tags({ t, id, max }: { t: Trade; id?: WalletIdentity; max: number }) {
  if (!id) return <TraderTags tags={t.tags} max={max} className="flex-nowrap" />;
  const own = t.tags.filter((x) => OWN_ONLY.includes(x));
  return (
    <>
      <WalletTags tags={id.tags.filter((x) => x !== "top10" || max > 2)} max={max + 1} />
      {own.length > 0 && <TraderTags tags={own} max={1} className="flex-nowrap" />}
    </>
  );
}

export function TradesTab({ token, trades, identities = NO_IDS }: { token: TokenSnapshot; trades: Trade[]; identities?: Map<string, WalletIdentity> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showMc, setShowMc] = useState(true);
  const now = useNow();
  const chain = CHAINS[token.chain];
  // Ids present on first paint don't animate; everything after does.
  const initialIds = useRef<Set<string> | null>(null);
  if (initialIds.current === null && trades.length) initialIds.current = new Set(trades.map((t) => t.id));

  const rows = useMemo(() => trades.filter((t) => match(t, filter, identities.get(t.trader))).slice(0, MAX_ROWS), [trades, filter, identities]);
  const isNew = (id: string) => initialIds.current !== null && !initialIds.current.has(id);

  const counts = useMemo(() => {
    let b = 0;
    let sl = 0;
    for (const t of trades) {
      if (t.side === "buy") b += 1;
      else sl += 1;
    }
    return { buy: b, sell: sl };
  }, [trades]);

  return (
    <div>
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          const tone = f.id === "buy" ? "buy" : f.id === "sell" ? "sell" : undefined;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-[3px] border px-2.5 text-[11.5px] font-semibold transition-colors",
                on
                  ? tone === "buy"
                    ? "border-buy/40 bg-buy-bg text-buy"
                    : tone === "sell"
                      ? "border-sell/40 bg-sell-bg text-sell"
                      : "border-line-2 bg-panel-3 text-text"
                  : "border-line bg-panel text-text-3 hover:border-line-2 hover:text-text-2",
              )}
            >
              {f.label}
              {tone && <span className="num text-[10px] font-medium opacity-70">{counts[tone]}</span>}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <Empty title={filter === "all" ? "No trades yet" : "No matching trades"} hint="Trades appear here live as they land on-chain." />
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden md:block">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-[1] bg-bg-elev font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
                <tr className="border-b border-line">
                  <th className="py-2 pl-4 pr-2 text-left font-normal">Age</th>
                  <th className="px-2 py-2 text-left font-normal">Side</th>
                  <th className="px-2 py-2 text-right font-normal">USD</th>
                  <th className="px-2 py-2 text-right font-normal">{chain.nativeSymbol}</th>
                  <th className="px-2 py-2 text-right font-normal">{token.symbol}</th>
                  <th className="px-2 py-2 text-right font-normal">
                    <button type="button" onClick={() => setShowMc((v) => !v)} className="uppercase tracking-[0.12em] hover:text-text-2" title="Toggle MC / price">
                      {showMc ? "MC" : "Price"} ⇄
                    </button>
                  </th>
                  <th className="px-2 py-2 pl-4 text-left font-normal">Trader</th>
                  <th className="w-10 py-2 pl-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const buy = t.side === "buy";
                  const fresh = isNew(t.id);
                  const you = t.tags.includes("you");
                  return (
                    <tr
                      key={t.id}
                      className={cn(
                        "border-b border-line/60 transition-colors hover:bg-panel-2",
                        fresh && "enter",
                        fresh && (buy ? "flash-up" : "flash-down"),
                        you && "bg-brand-bg shadow-[inset_2px_0_0_var(--brand)]",
                      )}
                    >
                      <td className="num py-2 pl-4 pr-2 text-text-3">{fmtAge(t.ts, now)}</td>
                      <td className="px-2 py-2">
                        <span className={cn("chip px-1.5 py-[3px] text-[10px]", buy ? "chip-buy" : "chip-sell")}>{buy ? "Buy" : "Sell"}</span>
                      </td>
                      <td className={cn("num px-2 py-2 text-right font-semibold", buy ? "text-buy" : "text-sell")}>{fmtUsd(t.amountUsd, 2)}</td>
                      <td className="num px-2 py-2 text-right text-text-2">{fmtNative(t.amountNative)}</td>
                      <td className="num px-2 py-2 text-right text-text-2">{fmtCompact(t.amountToken, 2)}</td>
                      <td className="num px-2 py-2 text-right text-text-2">{showMc ? fmtUsd(t.mcapUsd) : `$${fmtPrice(t.priceUsd)}`}</td>
                      <td className="px-2 py-2 pl-4">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <TraderName t={t} id={identities.get(t.trader)} />
                          <Tags t={t} id={identities.get(t.trader)} max={3} />
                        </span>
                      </td>
                      <td className="py-2 pl-2 pr-3 text-right">
                        <a
                          href={chain.explorerTx(t.tx)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View transaction"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] text-text-3 hover:bg-panel-3 hover:text-text"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone list */}
          <ul className="md:hidden">
            {rows.map((t) => {
              const buy = t.side === "buy";
              const fresh = isNew(t.id);
              return (
                <li
                  key={t.id}
                  className={cn(
                    "flex items-center gap-2.5 border-b border-line/60 py-2 pl-3 pr-1",
                    fresh && "enter",
                    fresh && (buy ? "flash-up" : "flash-down"),
                    t.tags.includes("you") && "bg-brand-bg",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold",
                      buy ? "bg-buy-bg text-buy" : "bg-sell-bg text-sell",
                    )}
                  >
                    {buy ? "B" : "S"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className={cn("num text-[13px] font-semibold", buy ? "text-buy" : "text-sell")}>
                        {buy ? "+" : "−"}
                        {fmtUsd(t.amountUsd, 2)}
                      </span>
                      <span className="num truncate text-[11px] text-text-3">
                        {fmtNative(t.amountNative)} {chain.nativeSymbol}
                      </span>
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
                      <TraderName t={t} id={identities.get(t.trader)} head={3} />
                      <Tags t={t} id={identities.get(t.trader)} max={2} />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-[11.5px] text-text-2">{fmtUsd(t.mcapUsd)}</div>
                    <div className="num text-[10px] text-text-3">{fmtAge(t.ts, now)}</div>
                  </div>
                  <a
                    href={chain.explorerTx(t.tx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View transaction"
                    className="inline-flex h-10 w-8 shrink-0 items-center justify-center text-text-3"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
