// Flap on Robinhood Chain — Portal 0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09 (events verified live, see ../flap.ts).
// Graduates to Uniswap V2 (registry). ETH quote only on HOOD.
import { flapAdapter } from "../flap";
import type { Adapter } from "../poller";

export function hoodFlapAdapter(): Adapter {
  return flapAdapter({ chain: "hood", portal: "0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09", venue: "uniswap-v2" });
}
