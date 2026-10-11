// Admin › Overview: the insights gateway at a glance (GET /api/insights/status, public, no secrets): GMGN rate and queue,
// cooldown, calls per minute, cache hit rate; and where live trades come from (PumpPortal / Alchemy).
import { Gauge } from "lucide-react";
import { Card } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { useInsightsStatus } from "@/features/insights/api";
import { KV } from "./ui";

function On({ ok, yes = "connected", no = "off" }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={ok ? "text-buy" : "text-text-3"}>{ok ? yes : no}</span>;
}

export function InsightsCard() {
  const q = useInsightsStatus(true);
  const s = q.data;
  const g = s?.gmgn;
  const lt = s?.liveTrades;
  const paused = g?.pausedUntil && g.pausedUntil > Date.now() ? g.pausedUntil : null;
  return (
    <Card title="Insights" icon={<Gauge />}>
      {q.isLoading ? (
        <div className="sheen h-[180px] rounded-xl bg-panel-2" />
      ) : !s || !g || !lt ? (
        <p className="py-2 text-[12px] leading-snug text-text-3">The insights module isn't running in this build yet. Its status shows here once it ships.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={cn("chip", g.enabled ? "chip-buy" : "chip-warn")}>GMGN {g.enabled ? "on" : "off"}</span>
            {paused && <span className="chip chip-sell">cooling down</span>}
            {!g.enabled && g.reason && <span className="text-[11.5px] text-text-3">{g.reason}</span>}
          </div>
          <KV label="Rate now / max">
            <span className="num">
              {g.ratePerSec.toFixed(1)} / {g.maxRatePerSec.toFixed(1)} per s
            </span>
          </KV>
          <KV label="Queue">
            <span className={cn("num", g.queued > 20 && "text-warn")}>{g.queued}</span>
          </KV>
          <KV label="Paused until">{paused ? <span className="num text-sell">{new Date(paused).toLocaleTimeString()}</span> : "—"}</KV>
          <KV label="Calls / errors (1 min)">
            <span className="num">
              {g.calls1m} / <span className={g.errors1m ? "text-sell" : undefined}>{g.errors1m}</span>
            </span>
          </KV>
          <KV label="Cache">
            <span className="num">
              {g.cacheEntries.toLocaleString()} entries · {(g.hitRate * 100).toFixed(0)}% hits
            </span>
          </KV>
          <div className="my-1.5 border-t border-line" />
          <KV label="Live trades from">{lt.source === "none" ? <span className="text-warn">none</span> : lt.source === "pumpportal" ? "PumpPortal" : "Alchemy"}</KV>
          <KV label="Coins watched">
            <span className="num">{lt.watching}</span>
          </KV>
          <KV label="PumpPortal">
            <On ok={lt.pumpportal.connected} />
            <span className="num text-text-3">
              {" "}
              · {lt.pumpportal.keyed ? "key set" : "no key"} · {lt.pumpportal.subscribed} subs
            </span>
          </KV>
          <KV label="Alchemy">
            {lt.alchemy.configured ? <On ok={lt.alchemy.connected} /> : <span className="text-text-3">not set</span>}
            {lt.alchemy.configured && <span className="num text-text-3"> · {lt.alchemy.subscribed} subs</span>}
          </KV>
        </>
      )}
    </Card>
  );
}
