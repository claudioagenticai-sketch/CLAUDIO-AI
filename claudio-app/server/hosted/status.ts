// hostedStatus(): one object describing whether hosted agents work right now (for the platform features flag,
// the admin page and the health of the runner). No secrets.
import type { HostedStatus } from "@shared/agents";
import { hostedEnv } from "./config";
import { countRunning, globalKill } from "./hostedStore";
import { llmGate, llmShareStatus, runnerState } from "./runner";
import { vaultState } from "./vault";

export async function hostedStatus(): Promise<HostedStatus> {
  const vault = vaultState();
  const [kill, active] = await Promise.all([globalKill().catch(() => ({ killed: true })), countRunning()]);
  const r = runnerState();
  return {
    available: vault === "ready",
    vault,
    liveTrading: hostedEnv.liveTrading(),
    killed: kill.killed,
    runner: { started: r.started, activeAgents: active, lastTickAt: r.lastTickAt, llm: llmGate() },
    llmShare: llmShareStatus(),
  };
}
