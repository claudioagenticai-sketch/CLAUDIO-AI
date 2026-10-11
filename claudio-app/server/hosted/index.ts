// Hosted agents module (owner: hosted workstream): agent escrow wallets (encrypted keys), guard-railed signer,
// policies, paper mode, the agent engine runner.
//
//   vault.ts      keypair generation + envelope encryption (VAULT_MASTER_KEY), rotation re-wrap
//   signer.ts     the only decryptor: typed intents → self-built, allowlisted, policy-checked tx (live off by default)
//   policy.ts     AgentPolicy storage + the single trade check
//   trading.ts    trade entry point: approvals / paper fills / live signing
//   paper.ts      paper-trade simulator + positions
//   ledger.ts     escrow balances + inflow (creator-fee) detection
//   runner.ts     scheduled free-model decisions (post / paper_trade / idle)
//   routes.ts     /api/agents/:slug/{wallet,policy,run,logs,approvals} + /api/admin/hosted
//   workspace/    the Cloud workspace: chat, helpers, tools, memory, files, skills, activity (/api/cloud/*)
// Nothing outside server/hosted may import signer.ts or vault.ts (hosted.check.ts enforces it).
import type { Express } from "express";
import { registerRoutes } from "./routes";
import { startRunner } from "./runner";
import { ensureEscrow } from "./vault";
import { recordPayout } from "./ledger";

export { hostedStatus } from "./status";
import { registerHostedBridges } from "./bridge";
import { registerWorkspaceRoutes } from "./workspace";

export { cloudFlagOn, onCloudFlagChange } from "./workspace";

export function registerHostedRoutes(app: Express): void {
  registerRoutes(app);
  registerWorkspaceRoutes(app);
  registerHostedBridges();
}

export function startHostedRunner(): void {
  startRunner();
}

/**
 * Solana address that receives a hosted agent's creator share (its escrow wallet). Creates the wallet on first use.
 * Returns null when hosted agents are unavailable (no database / VAULT_MASTER_KEY) or the agent is not hosted.
 * Used by the launch flow when a person launches a coin "with" a hosted agent.
 */
export async function escrowForAgent(agentId: string): Promise<string | null> {
  if (typeof agentId !== "string" || !agentId) return null;
  return ensureEscrow(agentId);
}

/**
 * For the collector: record a creator-fee payout it just sent to an agent's escrow (idempotent; the inflow poller
 * would find it a few minutes later anyway). Returns false when the agent has no escrow or it was already recorded.
 */
export async function recordAgentPayout(agentId: string, payout: { signature: string; amountSol: number; source?: string }): Promise<boolean> {
  return recordPayout(agentId, payout).catch(() => false);
}
