// Floating trade dock for phones: it takes the place of the navigation dock on a token page.
// A thin readout (symbol, MC, 5m move, liquidity) over two big Buy / Sell buttons, above the home indicator.
import { motion, useReducedMotion } from "framer-motion";
import { CHAINS } from "@shared/chains";
import type { TokenSnapshot } from "@shared/types";
import { haptic, useSettings } from "@/lib/store";
import { fmtNative, fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MobileTradeBar({ token, onOpen }: { token: TokenSnapshot; onOpen: (side: "buy" | "sell") => void }) {
  const reduce = useReducedMotion();
  const quick = useSettings((s) => s.quickBuy[token.chain]);
  const native = CHAINS[token.chain].nativeSymbol;
  const up = token.change5mPct >= 0;
  return (
    <motion.div
      initial={reduce ? false : { y: 96 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="fixed inset-x-0 bottom-0 z-50 bg-bg px-2.5 pt-1.5 md:left-[var(--rail-w)]"
      style={{ paddingBottom: "calc(8px + var(--safe-bottom))" }}
    >
      <div className="mx-auto max-w-xl rounded-[4px] border border-line-2 bg-bg-elev p-1.5 shadow-[0_-12px_40px_-16px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1 text-[11px] text-text-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-bold text-text">{token.symbol}</span>
            <span className="text-line-2">·</span>
            <span className="shrink-0">
              MC <span className="num text-text-2">{fmtUsd(token.mcapUsd)}</span>
            </span>
            <span className={cn("num shrink-0 font-semibold", up ? "text-buy" : "text-sell")}>{fmtPct(token.change5mPct, 1, true)}</span>
          </span>
          <span className="num shrink-0">
            Liq <span className="text-text-2">{fmtUsd(token.liquidityUsd)}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              haptic();
              onOpen("buy");
            }}
            className="flex h-[52px] items-center justify-center gap-2 rounded-[3px] bg-buy px-3 text-buy-ink transition active:scale-[0.97]"
          >
            <span className="font-mono text-[14px] font-medium uppercase leading-none tracking-[0.12em]">Buy</span>
            {quick ? <span className="num rounded-[2px] bg-buy-ink/10 px-1.5 py-1 text-[11px] font-semibold leading-none">{fmtNative(quick)} {native}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => {
              haptic();
              onOpen("sell");
            }}
            className="flex h-[52px] items-center justify-center gap-2 rounded-[3px] bg-sell px-3 text-sell-ink transition active:scale-[0.97]"
          >
            <span className="font-mono text-[14px] font-medium uppercase leading-none tracking-[0.12em]">Sell</span>
            <span className="rounded-[2px] bg-sell-ink/10 px-1.5 py-1 text-[11px] font-semibold leading-none">% of bag</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
