// Background watcher: toast when a tracked wallet (with alerts on) trades a token Claudio is indexing.
// Mounted once by WalletHost. Renders nothing.

import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { useBoard, haptic } from "@/lib/store";
import { fmtNative, fmtUsd } from "@/lib/format";
import { normAddr } from "@/lib/wallet/keys";
import { CHAINS } from "@shared/chains";
import { trackedIndex, useTracker } from "./store";

export default function TrackerAlerts() {
  useEffect(() => {
    const seen = new Set<string>();
    return useBoard.subscribe((s, prev) => {
      if (s.trades === prev.trades) return;
      const wallets = useTracker.getState().wallets.filter((w) => w.alerts);
      if (wallets.length === 0) return;
      const idx = trackedIndex(wallets);
      const now = Date.now();
      for (const key of Object.keys(s.trades)) {
        const list = s.trades[key];
        if (list === prev.trades[key]) continue;
        for (const tr of list) {
          if (now - tr.ts > 60_000) break; // newest first — older ones were handled or are stale
          if (seen.has(tr.id)) continue;
          const w = idx.get(normAddr(tr.trader));
          if (!w) continue;
          seen.add(tr.id);
          const sym = s.tokens[key]?.symbol ?? "token";
          haptic(15);
          toast({
            title: `${w.emoji} ${w.label} ${tr.side === "buy" ? "bought" : "sold"} $${sym}`,
            description: `${fmtUsd(tr.amountUsd)} · ${fmtNative(tr.amountNative)} ${CHAINS[tr.chain].nativeSymbol} on ${CHAINS[tr.chain].short}`,
          });
        }
      }
      if (seen.size > 2000) seen.clear();
    });
  }, []);
  return null;
}
