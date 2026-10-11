// One-click buy used by board cards: calls the trade module, then toasts the outcome.
import { useCallback } from "react";
import { CHAINS } from "@shared/chains";
import type { TokenSnapshot } from "@shared/types";
import { buy } from "@/lib/trade";
import { haptic, useSettings, type ExecPreset } from "@/lib/store";
import { fmtNative } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { playBlip } from "@/features/alerts/sound";

export type QuickBuyFn = (token: TokenSnapshot, amount: number, preset?: ExecPreset) => Promise<boolean>;

/**
 * Returns a stable buy function. If a column preset differs from the global one, the global
 * preset is switched for the duration of the call (the trade module reads settings.activePreset)
 * and restored afterwards.
 */
export function useQuickBuy(): QuickBuyFn {
  return useCallback<QuickBuyFn>(async (token, amount, preset) => {
    haptic(12);
    const chain = CHAINS[token.chain];
    if (!(amount > 0)) {
      toast({ title: "Set a quick-buy amount", description: `Enter how much ${chain.nativeSymbol} to spend per click.` });
      return false;
    }
    const settings = useSettings.getState();
    const prevPreset = settings.activePreset;
    const swap = preset !== undefined && preset !== prevPreset;
    if (swap) settings.set({ activePreset: preset });
    const pending = toast({
      title: `Buying ${token.symbol}…`,
      description: `${fmtNative(amount)} ${chain.nativeSymbol} · ${preset ?? prevPreset} · ${chain.short}`,
    });
    try {
      const res = await buy(token, amount);
      pending.dismiss();
      if (res.ok) {
        const hash = res.hashes[res.hashes.length - 1];
        haptic(20);
        if (useSettings.getState().soundAlerts) playBlip("success", 0);
        toast({
          title: `Bought ${token.symbol}`,
          description: (
            <span className="flex flex-col gap-1">
              <span className="num text-text-2">
                {fmtNative(amount)} {chain.nativeSymbol} on {chain.name}
              </span>
              {hash && chain.explorer && (
                <a
                  href={chain.explorerTx(hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-2 underline-offset-2 hover:underline"
                >
                  View transaction ↗
                </a>
              )}
            </span>
          ),
        });
        return true;
      }
      toast({ variant: "destructive", title: `Buy failed · ${token.symbol}`, description: res.error ?? "Unknown error" });
      return false;
    } catch (e) {
      pending.dismiss();
      toast({
        variant: "destructive",
        title: `Buy failed · ${token.symbol}`,
        description: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      if (swap && useSettings.getState().activePreset === preset) useSettings.getState().set({ activePreset: prevPreset });
    }
  }, []);
}
