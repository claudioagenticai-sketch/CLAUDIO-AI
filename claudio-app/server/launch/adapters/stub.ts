// Placeholder adapter for launchpads we list but can't launch on yet. Visible in the UI as "coming soon",
// never marked live, and `plan()` always answers 501 adapter_planned.
import { LAUNCHPADS, type LaunchpadId } from "@shared/launchpads";
import type { LaunchPlan } from "@shared/types";
import { LaunchError, type LaunchAdapter } from "../types";

export function stubAdapter(id: LaunchpadId): LaunchAdapter {
  const lp = LAUNCHPADS[id];
  // Anything without a verified implementation is at most "planned", even if the registry is more optimistic.
  const status = lp.adapter === "blocked" ? "blocked" : "planned";
  return {
    id,
    chains: lp.deployments.map((d) => d.chain),
    status,
    note: status === "blocked" ? lp.warnings[0] ?? "Not compatible with the locked 70/30 split." : "Coming soon",
    async plan(): Promise<LaunchPlan> {
      throw new LaunchError(501, "adapter_planned", `${lp.name} launches are not available yet`);
    },
  };
}
