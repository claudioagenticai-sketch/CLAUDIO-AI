// Your recent trades on this token (local history; the chain is the source of truth — links go to the explorer).
import { ExternalLink } from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { TokenSnapshot } from "@shared/types";
import type { HistoryTrade } from "@/lib/history";
import { useNow } from "@/components/kit";
import { fmtAge, fmtCompact, fmtNative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MyTrades({ token, trades, className }: { token: TokenSnapshot; trades: HistoryTrade[]; className?: string }) {
  const now = useNow();
  if (!trades.length) return null;
  const chain = CHAINS[token.chain];
  const rows = [...trades].sort((a, b) => b.ts - a.ts).slice(0, 6);
  return (
    <div className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="eyebrow">Your trades</span>
        <span className="num text-[10.5px] text-text-3">{trades.length}</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((t) => (
          <li key={t.id} className="flex items-center gap-2.5 px-4 py-2 text-[11.5px]">
            <span
              className={cn(
                "chip w-10 shrink-0 justify-center px-0 py-[3px] text-[10.5px] font-bold",
                t.side === "buy" ? "chip-buy" : "chip-sell",
              )}
            >
              {t.side === "buy" ? "Buy" : "Sell"}
            </span>
            <span className="num min-w-0 flex-1 truncate text-text-2">
              {fmtNative(t.amountNative)} {chain.nativeSymbol} · {fmtCompact(t.amountToken, 2)} {t.symbol}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold capitalize",
                t.status === "confirmed" ? "text-buy" : t.status === "failed" ? "text-sell" : "text-info",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full bg-current", t.status !== "confirmed" && t.status !== "failed" && "animate-pulse-dot")} />
              {t.status}
            </span>
            <span className="num w-7 shrink-0 text-right text-[10px] text-text-3">{fmtAge(t.ts, now)}</span>
            <a
              href={chain.explorerTx(t.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on explorer"
              className="-mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] text-text-3 hover:bg-panel-3 hover:text-text"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
