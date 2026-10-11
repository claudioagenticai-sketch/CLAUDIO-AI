// Which chains are open right now (from the platform config). Solana is open; Robinhood Chain and BNB Chain are
// "coming soon" until an admin opens them. EVM code stays intact — closed chains are only hidden or greyed out.
import { ENABLED_CHAINS, type ChainId } from "@shared/chains";
import { DEFAULT_CHAIN, type ChainSwitchState } from "@shared/platform";
import { usePlatformConfig } from "@/lib/platform";

export function useChainStates(): (chain: ChainId) => ChainSwitchState {
  const { data } = usePlatformConfig();
  return (chain) => data?.chains.find((c) => c.chain === chain)?.state ?? (chain === DEFAULT_CHAIN ? "open" : "coming_soon");
}

/** Enabled chains that aren't "coming soon", in display order (Solana first). */
export function useOpenChains(): ChainId[] {
  const state = useChainStates();
  return ENABLED_CHAINS.filter((c) => state(c) !== "coming_soon");
}
