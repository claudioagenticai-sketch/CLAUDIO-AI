// Public platform config (chain/launchpad switches, $CLAUDIO from spl_config, feature flags). Server: server/platform.
import { useQuery } from "@tanstack/react-query";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import { CLAUDIO_TOKEN, DEFAULT_CHAIN, DEFAULT_LAUNCHPAD, type PlatformConfig, type SwitchState, type ChainSwitchState } from "@shared/platform";

export const PLATFORM_KEY = ["/api/platform/config"] as const;

export async function fetchPlatformConfig(): Promise<PlatformConfig> {
  const res = await fetch("/api/platform/config", { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function usePlatformConfig() {
  return useQuery({ queryKey: PLATFORM_KEY, queryFn: fetchPlatformConfig, staleTime: 15_000, refetchInterval: 60_000 });
}

/** State of a chain; Solana is open and everything else "coming soon" until the config says otherwise. */
export function useChainState(chain: ChainId): ChainSwitchState {
  const { data } = usePlatformConfig();
  return data?.chains.find((c) => c.chain === chain)?.state ?? (chain === DEFAULT_CHAIN ? "open" : "coming_soon");
}

/** The EVM chains a wallet's EVM account works on, from the switches: "Robinhood Chain · BNB Chain (coming soon)". */
export function useEvmChainsLabel(short = false): string {
  const states: Record<"hood" | "bsc", ChainSwitchState> = { hood: useChainState("hood"), bsc: useChainState("bsc") };
  const names = { hood: short ? "Robinhood" : "Robinhood Chain", bsc: short ? "BNB" : "BNB Chain" };
  const sep = short ? ", " : " · ";
  const live = (["hood", "bsc"] as const).filter((c) => states[c] === "open").map((c) => names[c]);
  const soon = (["hood", "bsc"] as const).filter((c) => states[c] !== "open").map((c) => names[c]);
  return [live.join(sep), soon.length ? `${soon.join(sep)} (coming soon)` : ""].filter(Boolean).join(sep);
}

/** Effective state of a launchpad on a chain (never more open than the code supports). */
export function useLaunchpadState(launchpad: LaunchpadId, chain: ChainId): { state: SwitchState; note?: string | null; allowAgents: boolean } {
  const { data } = usePlatformConfig();
  const row = data?.launchpads.find((l) => l.launchpad === launchpad && l.chain === chain);
  if (row) return { state: row.effective, note: row.note, allowAgents: row.allowAgents };
  const open = launchpad === DEFAULT_LAUNCHPAD && chain === DEFAULT_CHAIN;
  return { state: open ? "open" : "coming_soon", allowAgents: open };
}

/** $CLAUDIO (from spl_config), with the compiled-in constant as fallback. */
export function useClaudioToken() {
  const { data } = usePlatformConfig();
  return data?.token ?? { key: CLAUDIO_TOKEN.key, chain: "solana" as const, mint: CLAUDIO_TOKEN.mint, symbol: CLAUDIO_TOKEN.symbol, name: CLAUDIO_TOKEN.name, decimals: CLAUDIO_TOKEN.decimals };
}
