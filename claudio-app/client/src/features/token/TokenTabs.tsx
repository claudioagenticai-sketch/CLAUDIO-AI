// Trades / Holders / Top traders / Info tabs: pill tabs with a sliding selection and counts. Horizontal strip on phones.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { TokenDetail, TokenSnapshot, Trade } from "@shared/types";
import { cn } from "@/lib/utils";
import { TradesTab } from "./TradesTab";
import { InsightHoldersTab, InsightTradersTab, useIdentityMap } from "@/features/insights/HoldersPanel";
import { useInsightHolders } from "@/features/insights/api";
import { InfoTab } from "./InfoTab";
import { fmtCount } from "./StatsStrip";
import { TokenThreadTab } from "@/features/token-agent/TokenThreadTab";
import { isClaudioCoin } from "@/features/token-agent/TokenAgentPanel";

type TabId = "trades" | "holders" | "traders" | "info" | "thread";

export function TokenTabs({
  token,
  detail,
  trades,
  mine,
  className,
}: {
  token: TokenSnapshot;
  detail?: TokenDetail;
  trades: Trade[];
  mine: Set<string>;
  className?: string;
}) {
  const [tab, setTab] = useState<TabId>("trades");
  const reduce = useReducedMotion();
  const holders = detail?.holdersList ?? [];
  // The tape shows names / tag icons for wallets we know; warm the holder list a few seconds after the page opens.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    setWarm(false);
    const id = window.setTimeout(() => setWarm(true), 3_000);
    return () => window.clearTimeout(id);
  }, [token.key]);
  useInsightHolders(token.key, warm && tab === "trades");
  const identities = useIdentityMap(token.key);
  const tabs: { id: TabId; label: string; badge?: string }[] = [
    { id: "trades", label: "Trades", badge: token.txCount ? fmtCount(token.txCount) : undefined },
    { id: "holders", label: "Holders", badge: token.holders ? fmtCount(token.holders) : undefined },
    { id: "traders", label: "Top traders" },
    { id: "info", label: "Info" },
    ...(isClaudioCoin(token) ? [{ id: "thread" as const, label: "Thread" }] : []),
  ];

  return (
    <div className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-line px-2 py-2">
        <div role="tablist" aria-label="Token data" className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-1.5 rounded-[2px] px-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] transition-colors",
                  on ? "text-text" : "text-text-3 hover:text-text-2",
                )}
              >
                {on && (
                  <motion.span
                    layoutId="token-tab-pill"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-[2px] bg-panel-3"
                  />
                )}
                <span className="relative">{t.label}</span>
                {t.badge && (
                  <span className={cn("num relative px-0.5 py-px text-[10px] font-medium", on ? "text-text-2" : "text-text-3")}>
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {tab === "trades" && (
          <span className="hidden shrink-0 items-center gap-1.5 pr-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-3 md:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-buy" />
            Live tape
          </span>
        )}
      </div>
      <div role="tabpanel" className="max-h-none lg:max-h-[640px] lg:overflow-y-auto">
        {tab === "trades" && <TradesTab token={token} trades={trades} identities={identities} />}
        {tab === "holders" && <InsightHoldersTab token={token} holders={holders} mine={mine} />}
        {tab === "traders" && <InsightTradersTab token={token} holders={holders} trades={trades} mine={mine} />}
        {tab === "info" && <InfoTab token={token} detail={detail} />}
        {tab === "thread" && <TokenThreadTab tokenKey={token.key} address={token.address} />}
      </div>
    </div>
  );
}
