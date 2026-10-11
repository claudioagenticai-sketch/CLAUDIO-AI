// Flap on BSC — Portal 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0. Same event ABI as HOOD: TokenCreated / TokenBought /
// TokenSold / FlapTokenProgressChanged topic0s all observed on BSC via bsc-rpc.publicnode.com (2026-09-27).
// Graduates to PancakeSwap V2/V3.
import { flapAdapter } from "../flap";
import type { Adapter } from "../poller";

export function bscFlapAdapter(): Adapter {
  return flapAdapter({ chain: "bsc", portal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0", venue: "pancakeswap" });
}
