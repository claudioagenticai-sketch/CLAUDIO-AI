// Agent policies (guard rails) and THE trade check every trade path goes through — the paper simulator, the owner
// approval path and the signer (which re-runs it itself rather than trusting its caller).
import { z } from "zod";
import { DEFAULT_POLICY, POLICY_LIMITS, type AgentPolicy } from "@shared/agents";
import { pool } from "../db";
import { SOL_ADDR, hostedEnv } from "./config";
import { approvalValid, globalKill, intentHash } from "./hostedStore";

const sol = (max: number) => z.number().finite().min(0).max(max);
const mintStr = z.string().regex(SOL_ADDR, "Solana mint address");

export const policySchema = z
  .object({
    paper: z.boolean(),
    maxSolPerTrade: sol(POLICY_LIMITS.maxSolPerTrade),
    maxSolPerDay: sol(POLICY_LIMITS.maxSolPerDay),
    canTrade: z.boolean(),
    canLaunch: z.boolean(),
    askOwnerAboveSol: sol(POLICY_LIMITS.askOwnerAboveSol),
    blockedTokens: z.array(mintStr).max(POLICY_LIMITS.blockedTokens),
    killed: z.boolean(),
  })
  .strict();

/** PUT body: any subset of the policy; unknown keys rejected. */
export const policyPatchSchema = policySchema.partial().strict();

export function sanitizePolicy(raw: unknown): AgentPolicy {
  const merged = { ...DEFAULT_POLICY, ...(raw && typeof raw === "object" ? (raw as object) : {}) };
  const p = policySchema.safeParse(merged);
  return p.success ? { ...p.data, blockedTokens: [...new Set(p.data.blockedTokens)] } : { ...DEFAULT_POLICY };
}

export function validatePolicy(p: AgentPolicy): string | null {
  if (p.maxSolPerTrade > p.maxSolPerDay) return "maxSolPerTrade cannot exceed maxSolPerDay";
  return null;
}

export interface PolicyRecord {
  policy: AgentPolicy;
  adminKilled: boolean;
}

export async function loadPolicy(agentId: string): Promise<PolicyRecord> {
  if (!pool) return { policy: { ...DEFAULT_POLICY }, adminKilled: false };
  const r = await pool.query(`SELECT policy, admin_killed FROM agent_policies WHERE agent_id = $1`, [agentId]);
  if (!r.rows[0]) return { policy: { ...DEFAULT_POLICY }, adminKilled: false };
  return { policy: sanitizePolicy(r.rows[0].policy), adminKilled: !!r.rows[0].admin_killed };
}

export async function savePolicy(agentId: string, policy: AgentPolicy, by: string, adminKilled?: boolean): Promise<PolicyRecord> {
  if (!pool) throw new Error("database unavailable");
  const clean = sanitizePolicy(policy);
  const r = await pool.query(
    `INSERT INTO agent_policies (agent_id, policy, admin_killed, updated_by, updated_at) VALUES ($1,$2,COALESCE($3,false),$4,now())
     ON CONFLICT (agent_id) DO UPDATE SET policy = EXCLUDED.policy, admin_killed = COALESCE($3, agent_policies.admin_killed),
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING policy, admin_killed`,
    [agentId, JSON.stringify(clean), adminKilled ?? null, by],
  );
  return { policy: sanitizePolicy(r.rows[0].policy), adminKilled: !!r.rows[0].admin_killed };
}

// ─── trade intents ───────────────────────────────────────────────────

/** The only things a hosted agent can ask to do with money. Everything else is refused by construction. */
export const tradeIntentSchema = z
  .object({
    kind: z.enum(["pump_buy", "pump_sell"]),
    mint: mintStr,
    /** buy: SOL to spend. sell: SOL worth of the position to sell (capped at the position). */
    amountSol: z.number().finite().positive().max(POLICY_LIMITS.maxSolPerTrade),
    slippageBps: z.number().int().min(10).max(2_000).default(500),
  })
  .strict();
export type TradeIntent = z.infer<typeof tradeIntentSchema>;

export type TradeVerdict =
  | { ok: true; policy: AgentPolicy; live: boolean; approvalId?: string }
  | { ok: false; code: string; message: string; needsApproval?: boolean; policy?: AgentPolicy };

/** SOL spent on buys today (UTC), paper and live together — the daily cap counts both. */
export async function spentToday(agentId: string): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(
    `SELECT COALESCE((SELECT sum(amount_sol) FROM agent_paper_trades WHERE agent_id = $1 AND side = 'buy' AND created_at >= date_trunc('day', now(), 'UTC')), 0)
          + COALESCE((SELECT sum(-amount_sol) FROM agent_ledger WHERE agent_id = $1 AND kind = 'trade' AND amount_sol < 0 AND created_at >= date_trunc('day', now(), 'UTC')), 0) AS s`,
    [agentId],
  );
  return Number(r.rows[0]?.s ?? 0);
}

/**
 * Policy gate for one trade. Order: global kill → agent kill (owner or admin) → canTrade → blocked token → per-trade
 * cap → daily cap (buys) → ask-owner threshold (unless `approvalId` is an approved approval of this exact intent).
 * `live` is true only when the server allows live signing AND the policy is not paper.
 */
export async function checkTrade(agentId: string, intent: TradeIntent, opts: { approvalId?: string } = {}): Promise<TradeVerdict> {
  const kill = await globalKill();
  if (kill.killed) return { ok: false, code: "killed_global", message: "Hosted agents are paused by the platform kill switch" };
  const { policy, adminKilled } = await loadPolicy(agentId);
  if (policy.killed || adminKilled) return { ok: false, code: "killed", message: adminKilled ? "This agent was stopped by an admin" : "This agent's kill switch is on", policy };
  if (!policy.canTrade) return { ok: false, code: "trading_disabled", message: "Trading is off in this agent's policy", policy };
  if (policy.blockedTokens.includes(intent.mint)) return { ok: false, code: "blocked_token", message: "This token is on the agent's block list", policy };
  if (!(intent.amountSol > 0)) return { ok: false, code: "bad_amount", message: "Amount must be positive", policy };
  if (intent.amountSol > policy.maxSolPerTrade) {
    return { ok: false, code: "over_trade_cap", message: `${intent.amountSol} SOL exceeds the per-trade cap of ${policy.maxSolPerTrade} SOL`, policy };
  }
  if (intent.kind === "pump_buy") {
    const spent = await spentToday(agentId);
    if (spent + intent.amountSol > policy.maxSolPerDay + 1e-9) {
      return { ok: false, code: "over_daily_cap", message: `Daily cap ${policy.maxSolPerDay} SOL reached (spent ${spent.toFixed(4)})`, policy };
    }
  }
  let approvalId: string | undefined;
  if (intent.amountSol > policy.askOwnerAboveSol) {
    if (!opts.approvalId || !(await approvalValid(agentId, opts.approvalId, intentHash(intent)))) {
      return { ok: false, code: "needs_approval", needsApproval: true, message: `Above ${policy.askOwnerAboveSol} SOL — the owner must approve`, policy };
    }
    approvalId = opts.approvalId;
  }
  return { ok: true, policy, live: hostedEnv.liveTrading() && !policy.paper, approvalId };
}
