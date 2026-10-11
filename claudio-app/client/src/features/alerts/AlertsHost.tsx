// Global alerts: turns server `alert` messages and watchlist migrations into toasts (+ optional blip).
// Renders nothing itself; mount once in the shell.
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { CHAINS } from "@shared/chains";
import type { TokenAlert, TokenSnapshot } from "@shared/types";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { haptic, useBoard, useSettings } from "@/lib/store";
import { fmtUsd } from "@/lib/format";
import { playBlip, wireAudioUnlock } from "./sound";

const ALERT_TITLE: Record<TokenAlert["kind"], string> = {
  "dev-sold": "Dev sold",
  "fee-recipient-change-proposed": "Fee recipient change proposed",
  "fee-split-reset": "Fee split reset",
  "large-sell": "Large sell",
  "honeypot-suspect": "Honeypot suspected",
  "tax-changed": "Tax changed",
  migration: "Migrated",
  cto: "Community takeover",
};

const alertId = (key: string, a: TokenAlert) => `${key}|${a.kind}|${a.at}`;

export function AlertsHost() {
  const [, setLocation] = useLocation();
  const navRef = useRef(setLocation);
  navRef.current = setLocation;

  useEffect(() => {
    wireAudioUnlock();

    const openAction = (t: TokenSnapshot | undefined) =>
      t ? (
        <ToastAction altText={`Open ${t.symbol}`} onClick={() => navRef.current(`/t/${t.chain}/${t.address}`)}>
          Open
        </ToastAction>
      ) : undefined;

    // ── server alerts ── (anything already in the store at mount is considered seen)
    const seen = new Set<string>(useBoard.getState().alerts.map((x) => alertId(x.key, x.alert)));

    const unsubAlerts = useBoard.subscribe((state, prev) => {
      if (state.alerts === prev.alerts) return;
      const fresh: { key: string; alert: TokenAlert }[] = [];
      for (const item of state.alerts) {
        const id = alertId(item.key, item.alert);
        if (seen.has(id)) continue;
        seen.add(id);
        fresh.push(item);
      }
      if (!fresh.length) return;
      // Newest first in the store; toast the most severe of the batch (toasts are single-slot).
      const rank = { danger: 2, warn: 1, info: 0 } as const;
      fresh.sort((a, b) => rank[b.alert.severity] - rank[a.alert.severity]);
      const top = fresh[0];
      const token = state.tokens[top.key];
      const who = token ? `${token.symbol} · ${CHAINS[token.chain].short}` : top.key.split(":")[1]?.slice(0, 10) ?? top.key;
      const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
      toast({
        variant: top.alert.severity === "danger" ? "destructive" : "default",
        title: `${ALERT_TITLE[top.alert.kind] ?? "Alert"} — ${who}`,
        description: `${top.alert.message}${more}`,
        action: openAction(token),
      });
      if (top.alert.severity !== "info") haptic(top.alert.severity === "danger" ? 30 : 15);
      if (useSettings.getState().soundAlerts) playBlip(top.alert.severity === "danger" ? "danger" : top.alert.severity === "warn" ? "warn" : "info");
      if (seen.size > 5000) {
        seen.clear();
        for (const x of state.alerts) seen.add(alertId(x.key, x.alert));
      }
    });

    // ── watchlist migrations ──
    const announced = new Set<string>();
    const unsubMig = useBoard.subscribe((state, prev) => {
      if (state.tokens === prev.tokens) return;
      const watch = useSettings.getState().watchlist;
      if (!watch.length) return;
      for (const key of watch) {
        const now = state.tokens[key];
        const before = prev.tokens[key];
        if (!now || !before || announced.has(key)) continue;
        if (before.phase !== "migrated" && now.phase === "migrated") {
          announced.add(key);
          toast({
            title: `${now.symbol} migrated`,
            description: `${now.venue ? `Now trading on ${now.venue}` : "Graduated to an AMM pool"} · MC ${fmtUsd(now.mcapUsd)}`,
            action: openAction(now),
          });
          haptic(20);
          if (useSettings.getState().soundAlerts) playBlip("success");
        }
      }
    });

    return () => {
      unsubAlerts();
      unsubMig();
    };
  }, []);

  return null;
}

export default AlertsHost;
