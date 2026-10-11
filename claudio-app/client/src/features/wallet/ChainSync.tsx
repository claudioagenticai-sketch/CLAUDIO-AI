// Keeps an external EVM wallet on the chain selected in the app, and warns when it isn't.
//  • Picking HOOD / BSC / Base in the app asks the connected browser or WalletConnect wallet to switch (adding the
//    network with our tested RPCs if it doesn't know it, e.g. Robinhood Chain).
//  • If the wallet is moved to another network from inside the wallet, a banner offers a one-tap fix.
// The built-in Claudio wallet signs for any chain directly, so none of this applies to it.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { useSettings } from "@/lib/store";
import { useActiveAccount } from "@/lib/wallet";
import { ensureEvmChain, isUserRejection } from "@/lib/wallet/injected";
import { useDiscovery } from "@/lib/wallet/discovery";
import { cn } from "@/lib/utils";

function useExternalEvm() {
  const acct = useActiveAccount("evm");
  return acct?.source === "injected" ? acct : undefined;
}

/** Mount once (Shell). Switches the wallet when the app's chain changes. */
export function useChainSync(): void {
  const chain = useSettings((s) => s.chain);
  const external = useExternalEvm();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const c = CHAINS[chain];
    if (!external || c.kind !== "evm") return;
    const key = `${external.address}:${chain}`;
    if (last.current === key) return;
    last.current = key;
    ensureEvmChain(chain).catch((e) => {
      // Rejections are fine — the banner stays up so the user can retry.
      if (!isUserRejection(e)) console.warn("[wallet] chain switch failed", e);
    });
  }, [chain, external]);
}

export function ChainMismatchBanner({ className }: { className?: string }) {
  const chain = useSettings((s) => s.chain);
  const external = useExternalEvm();
  const walletChainId = useDiscovery((s) => s.evmChainId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = CHAINS[chain];
  if (!external || c.kind !== "evm" || walletChainId === undefined || walletChainId === c.evmChainId) return null;
  const walletChain = Object.values(CHAINS).find((x) => x.evmChainId === walletChainId);
  return (
    <div
      role="alert"
      data-testid="chain-mismatch"
      className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-warn/25 bg-warn-bg px-3 py-2 text-[12px] text-warn", className)}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="text-center text-text-2">
        Your wallet is on <b className="text-warn">{walletChain?.name ?? `chain ${walletChainId}`}</b>, but you're trading on <b className="text-text">{c.name}</b>.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await ensureEvmChain(chain);
          } catch (e) {
            setErr(isUserRejection(e) ? "Rejected in wallet" : e instanceof Error ? e.message : "Couldn't switch");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex h-7 items-center rounded-[3px] bg-warn px-2.5 font-bold text-bg transition hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
      >
        {busy ? "Switching…" : `Switch to ${c.short}`}
      </button>
      {err && <span className="text-sell">{err}</span>}
    </div>
  );
}
