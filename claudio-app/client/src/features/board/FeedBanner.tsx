// Honest feed banner: shown when the current chain's data is simulated or offline.
import { useState } from "react";
import { AlertTriangle, FlaskConical, X } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { useBoard } from "@/lib/store";
import { cn } from "@/lib/utils";

export function FeedBanner({ chain, error, className }: { chain: ChainId; error?: string; className?: string }) {
  const source = useBoard((s) => s.status[chain]?.source);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const kind: "simulated" | "offline" | "error" | null =
    source === "simulated" ? "simulated" : source === "offline" ? "offline" : error ? "error" : null;
  const id = `${chain}:${kind ?? ""}`;
  if (!kind || dismissed === id) return null;

  const name = CHAINS[chain].name;
  const text =
    kind === "simulated"
      ? `Simulated feed — ${name} tokens and trades below are synthetic. Connect RPC keys for live data.`
      : kind === "offline"
        ? `${name} feed is offline. The board may be stale.`
        : `Couldn't load the ${name} board (${error}). Retrying over WebSocket.`;
  const sim = kind === "simulated";

  return (
    <div
      role="status"
      className={cn(
        "mx-3 mt-2 flex shrink-0 items-center gap-2.5 rounded-[3px] border border-l-2 border-line bg-bg-elev py-1.5 pl-2 pr-1.5 text-[12px] md:mt-3",
        sim ? "border-l-warn text-warn" : "border-l-sell text-sell",
        className,
      )}
    >
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
        {sim ? <FlaskConical className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <b className="font-mono text-[11px] font-medium tracking-[0.12em]">{sim ? "SIMULATED" : kind === "offline" ? "OFFLINE" : "ERROR"}</b>
        <span className="text-text-2"> · {text}</span>
      </span>
      <button
        type="button"
        onClick={() => setDismissed(id)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] text-text-3 transition-colors hover:bg-panel-3 hover:text-text"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
