// Desktop footer: honest feed status for open chains (LIVE / SIM / OFF, latency, block, gas, native price),
// "soon" for chains that aren't open yet, WebSocket state + message rate, UTC clock and links.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Fuel } from "lucide-react";
import { BRAND } from "@shared/brand";
import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import type { ChainStatus } from "@shared/types";
import { LiveDot, useNow } from "@/components/kit";
import { useChainState } from "@/lib/platform";
import { haptic, useBoard, useSettings, useUI } from "@/lib/store";
import { socket, type ConnState } from "@/lib/ws";
import { cn } from "@/lib/utils";

const STALE_MS = 60_000;

function fmtUsdPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 3 : 2, minimumFractionDigits: v < 10 ? 2 : 0 })}`;
}

export function useSocketState(): { state: ConnState; latency: number; rate: number } {
  const [state, setState] = useState<ConnState>(socket.state);
  const [latency, setLatency] = useState(socket.latencyMs);
  const [rate, setRate] = useState(0);
  useEffect(() => {
    let count = 0;
    const offState = socket.onState((s) => setState(s));
    const offMsg = socket.onMessage(() => {
      count++;
    });
    const id = window.setInterval(() => {
      setRate(count);
      count = 0;
      setLatency(socket.latencyMs);
      setState(socket.state);
    }, 1000);
    return () => {
      offState();
      offMsg();
      window.clearInterval(id);
    };
  }, []);
  return { state, latency, rate };
}

/** A chain that isn't open yet: name + "soon", no feed numbers (its feed may still run for research, but it isn't ours to show). */
function SoonCell({ chain }: { chain: ChainId }) {
  const info = CHAINS[chain];
  return (
    <div className="flex h-full shrink-0 items-center gap-1.5 border-r border-line px-2.5 text-text-3" title={`${info.name} — coming soon`}>
      <span className="h-1.5 w-1.5 rounded-full bg-line-2" aria-hidden />
      <span>{info.short}</span>
      <span className="tracking-[0.08em]">SOON</span>
    </div>
  );
}

function ChainCell({ chain, status, now, current }: { chain: ChainId; status?: ChainStatus; now: number; current: boolean }) {
  const info = CHAINS[chain];
  const state = useChainState(chain);
  if (state === "coming_soon" && !current) return <SoonCell chain={chain} />;
  const source = status?.source;
  const stale = source === "live" && status && status.lastEventAt > 0 && now - status.lastEventAt > STALE_MS;
  const label = !status ? "…" : source === "live" ? (stale ? "STALE" : "LIVE") : source === "simulated" ? "SIM" : "OFF";
  const tone = !status ? "text-text-3" : source === "live" ? (stale ? "text-warn" : "text-buy") : source === "simulated" ? "text-warn" : "text-sell";
  const dot: "live" | "simulated" | "offline" | "connecting" = !status ? "connecting" : stale ? "simulated" : source ?? "offline";
  const tip = !status
    ? `${info.name}: waiting for status`
    : `${info.name} · ${source === "simulated" ? "SIMULATED feed (synthetic data)" : source === "live" ? "live feed" : "feed offline"}` +
      (status.lastEventAt ? ` · last event ${Math.max(0, Math.round((now - status.lastEventAt) / 1000))}s ago` : "");

  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        useSettings.getState().set({ chain });
      }}
      className={cn(
        "flex h-full shrink-0 items-center gap-1.5 border-r border-line px-2.5 transition-colors hover:bg-panel-2",
        current && "bg-panel",
      )}
      title={tip}
    >
      <LiveDot state={dot} />
      <span className={current ? "text-text" : "text-text-2"}>{info.short}</span>
      <span className={cn("tracking-[0.08em]", tone)}>{label}</span>
      {status && (
        <>
          {status.latencyMs > 0 && (
            <span className={cn(status.latencyMs > 1500 ? "text-warn" : "text-text-3")}>{Math.round(status.latencyMs)}ms</span>
          )}
          {status.lastBlock > 0 && <span className="hidden text-text-3 xl:inline">#{status.lastBlock.toLocaleString()}</span>}
          {status.gas && (
            <span className="hidden items-center gap-0.5 text-text-3 2xl:inline-flex">
              <Fuel className="h-3 w-3" />
              {status.gas}
            </span>
          )}
          <span className="text-text-2">{fmtUsdPrice(status.nativeUsd)}</span>
        </>
      )}
    </button>
  );
}

export function StatusBar() {
  const status = useBoard((s) => s.status);
  const chain = useSettings((s) => s.chain);
  const now = useNow();
  const ws = useSocketState();
  const setPalette = useUI((s) => s.setPalette);
  const utc = new Date(now).toISOString().slice(11, 19);
  const wsDot: "live" | "connecting" | "offline" = ws.state === "open" ? "live" : ws.state === "connecting" ? "connecting" : "offline";
  const twitter: string = BRAND.twitter;
  const xUrl = twitter ? (twitter.startsWith("http") ? twitter : `https://x.com/${twitter.replace(/^@/, "")}`) : "";

  return (
    <footer className="num relative z-30 flex h-statusbar shrink-0 items-stretch overflow-hidden border-t border-line bg-bg text-[10.5px]">
      <div className="no-scrollbar flex min-w-0 items-stretch overflow-x-auto">
        {ENABLED_CHAINS.map((c) => (
          <ChainCell key={c} chain={c} status={status[c]} now={now} current={c === chain} />
        ))}
        <div className="flex shrink-0 items-center gap-1.5 border-r border-line px-2.5" title={`WebSocket ${ws.state}`}>
          <LiveDot state={wsDot} />
          <span className="text-text-3">WS</span>
          <span className={cn(ws.state === "open" ? "text-text-2" : ws.state === "connecting" ? "text-info" : "text-sell")}>
            {ws.state === "open" ? `${ws.latency}ms` : ws.state === "connecting" ? "connecting" : "reconnecting"}
          </span>
          {ws.state === "open" && <span className="hidden text-text-3 lg:inline">· {ws.rate} msg/s</span>}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3.5 px-3 uppercase tracking-[0.06em] text-text-3">
        <button type="button" onClick={() => setPalette(true)} className="hidden items-center gap-1 hover:text-text-2 lg:inline-flex" title="Command palette & shortcuts">
          ⌘K · / · L · 1 2 3
        </button>
        <Link href="/docs" className="hover:text-text-2">
          Docs
        </Link>
        <Link href="/privacy" className="hidden hover:text-text-2 md:inline">
          Privacy
        </Link>
        <Link href="/terms" className="hidden hover:text-text-2 md:inline">
          Terms
        </Link>
        {xUrl && (
          <a href={xUrl} target="_blank" rel="noreferrer" className="hover:text-text-2" aria-label="X">
            𝕏
          </a>
        )}
        <span className="hidden normal-case text-text-3 xl:inline">v{BRAND.version}</span>
        <span className="normal-case text-text-2" title="Coordinated Universal Time">
          {utc} <span className="text-text-3">UTC</span>
        </span>
      </div>
    </footer>
  );
}
