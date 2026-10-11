// Paper-trade simulator: fills at the board's latest price (tokenStore) minus pump-style fees. Nothing here can
// move funds — it only writes agent_paper_trades.
import type { AgentPaperPosition } from "@shared/agents";
import { pool } from "../db";
import { tokenStore } from "../store";
import type { TradeIntent } from "./policy";

const FEE_BPS = 125 + 50; // curve fee + typical route fee — paper results should not look better than reality

export interface PaperFill {
  side: "buy" | "sell";
  mint: string;
  symbol: string | null;
  amountSol: number;
  tokens: number;
  priceSol: number;
  feeSol: number;
}

export function boardPrice(mint: string): { priceSol: number; symbol: string | null } | null {
  const t = tokenStore.get(`sol:${mint}`);
  if (!t || !(t.priceNative > 0) || !Number.isFinite(t.priceNative)) return null;
  return { priceSol: t.priceNative, symbol: t.symbol ?? null };
}

interface TradeRow {
  mint: string;
  symbol: string | null;
  side: string;
  amount_sol: number;
  tokens: number;
}

/** Average-cost positions + realized PnL from the trade history (chronological). */
export function foldPositions(rows: TradeRow[]): { positions: Map<string, { symbol: string | null; tokens: number; costSol: number }>; realizedPnlSol: number } {
  const positions = new Map<string, { symbol: string | null; tokens: number; costSol: number }>();
  let realized = 0;
  for (const r of rows) {
    const p = positions.get(r.mint) ?? { symbol: r.symbol, tokens: 0, costSol: 0 };
    if (r.side === "buy") {
      p.tokens += Number(r.tokens);
      p.costSol += Number(r.amount_sol);
    } else if (p.tokens > 0) {
      const sold = Math.min(p.tokens, Number(r.tokens));
      const costPart = p.costSol * (sold / p.tokens);
      realized += Number(r.amount_sol) - costPart;
      p.tokens -= sold;
      p.costSol -= costPart;
    }
    if (p.tokens < 1e-9) {
      p.tokens = 0;
      p.costSol = 0;
    }
    positions.set(r.mint, p);
  }
  for (const [k, v] of positions) if (v.tokens === 0) positions.delete(k);
  return { positions, realizedPnlSol: realized };
}

async function history(agentId: string): Promise<TradeRow[]> {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT mint, symbol, side, amount_sol, tokens FROM (
       SELECT mint, symbol, side, amount_sol, tokens, id FROM agent_paper_trades WHERE agent_id = $1 ORDER BY id DESC LIMIT 5000
     ) x ORDER BY id ASC`,
    [agentId],
  );
  return r.rows;
}

export async function paperBook(agentId: string): Promise<{ positions: AgentPaperPosition[]; realizedPnlSol: number; trades: number }> {
  const rows = await history(agentId);
  const { positions, realizedPnlSol } = foldPositions(rows);
  const out: AgentPaperPosition[] = [];
  for (const [mint, p] of positions) {
    const px = boardPrice(mint);
    const valueSol = px ? p.tokens * px.priceSol * (1 - FEE_BPS / 10_000) : null;
    out.push({ mint, symbol: p.symbol ?? px?.symbol ?? null, tokens: p.tokens, costSol: p.costSol, valueSol, pnlSol: valueSol === null ? null : valueSol - p.costSol });
  }
  return { positions: out, realizedPnlSol, trades: rows.length };
}

/** Simulates one fill. Caller (trading.ts) has already passed the policy check. */
export async function paperFill(agentId: string, intent: TradeIntent, meta: { reason?: string; approvalId?: string } = {}): Promise<{ ok: true; fill: PaperFill } | { ok: false; code: string; message: string }> {
  if (!pool) return { ok: false, code: "no_database", message: "Paper trading needs the database" };
  const px = boardPrice(intent.mint);
  if (!px) return { ok: false, code: "no_price", message: "The board has no live price for this token" };
  let fill: PaperFill;
  if (intent.kind === "pump_buy") {
    const fee = (intent.amountSol * FEE_BPS) / 10_000;
    fill = { side: "buy", mint: intent.mint, symbol: px.symbol, amountSol: intent.amountSol, tokens: (intent.amountSol - fee) / px.priceSol, priceSol: px.priceSol, feeSol: fee };
  } else {
    const held = foldPositions(await history(agentId)).positions.get(intent.mint)?.tokens ?? 0;
    if (held <= 0) return { ok: false, code: "no_position", message: "No paper position in this token" };
    const tokens = Math.min(held, intent.amountSol / px.priceSol);
    const gross = tokens * px.priceSol;
    const fee = (gross * FEE_BPS) / 10_000;
    fill = { side: "sell", mint: intent.mint, symbol: px.symbol, amountSol: gross - fee, tokens, priceSol: px.priceSol, feeSol: fee };
  }
  await pool.query(
    `INSERT INTO agent_paper_trades (agent_id, mint, symbol, side, amount_sol, tokens, price_sol, fee_sol, reason, approval_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [agentId, fill.mint, fill.symbol, fill.side, fill.amountSol, fill.tokens, fill.priceSol, fill.feeSol, (meta.reason ?? "").slice(0, 300) || null, meta.approvalId ?? null],
  );
  return { ok: true, fill };
}
