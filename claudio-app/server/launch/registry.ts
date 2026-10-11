// Adapter registry: one adapter per launchpad id. Only adapters with real, verified implementations are
// beta/live; everything else is a stub that answers 501.
import { LAUNCHPAD_ORDER, type LaunchpadId } from "@shared/launchpads";
import type { LaunchAdapter } from "./types";
import { bagsAdapter } from "./adapters/bags";
import { clankerAdapter } from "./adapters/clanker";
import { dyorAdapter } from "./adapters/dyor";
import { flapAdapter } from "./adapters/flap";
import { ponsAdapter } from "./adapters/pons";
import { poolsAdapter } from "./adapters/pools";
import { pumpAdapter } from "./adapters/pump";
import { stubAdapter } from "./adapters/stub";

const implemented: Partial<Record<LaunchpadId, LaunchAdapter>> = {
  pons: ponsAdapter,
  clanker: clankerAdapter,
  pump: pumpAdapter,
  pools: poolsAdapter,
  dyor: dyorAdapter,
  flap: flapAdapter,
  bags: bagsAdapter,
};

export const ADAPTERS: Record<LaunchpadId, LaunchAdapter> = LAUNCHPAD_ORDER.reduce(
  (acc, id) => {
    acc[id] = implemented[id] ?? stubAdapter(id);
    return acc;
  },
  {} as Record<LaunchpadId, LaunchAdapter>,
);

/** Launchpads that can route the creator share to a social account's vault. */
export function socialLaunchpads(): LaunchpadId[] {
  return LAUNCHPAD_ORDER.filter((id) => ADAPTERS[id].socialFees && (ADAPTERS[id].status === "beta" || ADAPTERS[id].status === "live"));
}

export function adapterFor(id: LaunchpadId): LaunchAdapter {
  return ADAPTERS[id];
}
