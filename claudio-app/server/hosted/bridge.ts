// Feeds hosted-agent data into the public agent views (server/agents): earned SOL from the escrow ledger, paper PnL
// and trade counts on agent cards, and "agents on this coin" from paper positions. Read-only; no keys involved.
import { pool } from "../db";
import { registerAgentStatsProvider, agentById, toRef } from "../agents/store";
import { registerTokenAgentsProvider } from "../agents/home";
import { earnedByAgent } from "./ledger";
import { paperBook } from "./paper";

let registered = false;

export function registerHostedBridges(): void {
  if (registered || !pool) return;
  registered = true;

  registerAgentStatsProvider(async (ids) => {
    const out = new Map<string, { earnedSol?: number; pnlSol?: number; trades?: number }>();
    if (!ids.length) return out;
    const earned = await earnedByAgent().catch(() => new Map<string, number>());
    for (const id of ids) {
      const book = await paperBook(id).catch(() => null);
      out.set(id, {
        ...(earned.has(id) ? { earnedSol: earned.get(id) } : {}),
        ...(book ? { pnlSol: book.realizedPnlSol, trades: book.trades } : {}),
      });
    }
    return out;
  });

  registerTokenAgentsProvider(async (tokenKey) => {
    if (!pool || !tokenKey.startsWith("sol:")) return [];
    const mint = tokenKey.slice(4);
    const { rows } = await pool.query(
      `SELECT agent_id,
              sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) AS tokens,
              sum(CASE WHEN side = 'buy' THEN amount_sol ELSE 0 END) AS bought_sol
         FROM agent_paper_trades WHERE mint = $1 GROUP BY agent_id ORDER BY bought_sol DESC LIMIT 20`,
      [mint],
    );
    const list = [];
    for (const r of rows) {
      const a = await agentById(r.agent_id).catch(() => undefined);
      if (!a || a.status === "banned") continue;
      list.push({ agent: toRef(a), side: Number(r.tokens) > 0 ? ("holder" as const) : ("trader" as const), amountSol: Number(r.bought_sol) || null });
    }
    return list;
  });
}
