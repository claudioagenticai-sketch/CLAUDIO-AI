// One entry point for every hosted-agent trade (runner decisions and owner-approved intents):
//   policy check → (needs approval → queue it for the owner) → paper fill, or signIntent + send when live.
// Serialised per agent so two decisions can't both pass the daily cap.
import { audit } from "../auth/audit";
import { primaryRpc } from "../rpc";
import { pool } from "../db";
import { checkTrade, tradeIntentSchema, type TradeIntent } from "./policy";
import { consumeApproval, createApproval, finishApproval, intentHash, logAction } from "./hostedStore";
import { paperFill, type PaperFill } from "./paper";
import { signIntent } from "./signer";

export type TradeOutcome =
  | { ok: true; mode: "paper"; fill: PaperFill }
  | { ok: true; mode: "live"; signature: string }
  | { ok: false; code: string; message: string; approvalId?: string };

const locks = new Map<string, Promise<unknown>>();
function withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(agentId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  locks.set(agentId, tail);
  tail.finally(() => locks.get(agentId) === tail && locks.delete(agentId));
  return next;
}

async function sendSigned(txBase64: string): Promise<string> {
  const r = await fetch(primaryRpc("sol"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [txBase64, { encoding: "base64", maxRetries: 3, preflightCommitment: "confirmed" }] }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json()) as { result?: string; error?: { message: string } };
  if (!j.result) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.result;
}

export async function executeTrade(
  agentId: string,
  rawIntent: unknown,
  opts: { source: "runner" | "approval" | "cloud"; reason?: string; approvalId?: string; model?: string | null; paperOnly?: boolean },
): Promise<TradeOutcome> {
  const parsed = tradeIntentSchema.safeParse(rawIntent);
  if (!parsed.success) return { ok: false, code: "bad_intent", message: parsed.error.issues[0]?.message ?? "bad intent" };
  const intent: TradeIntent = parsed.data;
  return withAgentLock(agentId, async () => {
    const verdict = await checkTrade(agentId, intent, { approvalId: opts.approvalId });
    if (!verdict.ok) {
      if (verdict.needsApproval && (opts.source === "runner" || opts.source === "cloud")) {
        const a = await createApproval(agentId, intent, opts.reason ?? "agent decision");
        await logAction(agentId, "approval", { model: opts.model, summary: `Asked the owner: ${intent.kind} ${intent.amountSol} SOL`, detail: { intent, approvalId: a?.id } });
        return { ok: false, code: "needs_approval", message: verdict.message, approvalId: a?.id };
      }
      await logAction(agentId, "blocked", { ok: false, model: opts.model, summary: verdict.message, detail: { intent, code: verdict.code } });
      return { ok: false, code: verdict.code, message: verdict.message };
    }

    // The Cloud workspace's paper_trade tool never signs, whatever the policy and server allow.
    if (!verdict.live || opts.paperOnly) {
      // Spend an approval atomically before filling, so it can't be used twice.
      if (verdict.approvalId && !(await consumeApproval(agentId, verdict.approvalId, intentHash(intent)))) {
        return { ok: false, code: "approval_spent", message: "That approval was already used" };
      }
      const res = await paperFill(agentId, intent, { reason: opts.reason, approvalId: verdict.approvalId });
      if (verdict.approvalId) await finishApproval(verdict.approvalId, res.ok ? "executed" : "failed", res.ok ? { mode: "paper", ...res.fill } : { error: res.code });
      if (!res.ok) {
        await logAction(agentId, "blocked", { ok: false, model: opts.model, summary: res.message, detail: { intent, code: res.code } });
        return res;
      }
      await logAction(agentId, "paper_trade", {
        model: opts.model,
        summary: `Paper ${res.fill.side} ${res.fill.amountSol.toFixed(4)} SOL of ${res.fill.symbol ?? intent.mint.slice(0, 6)}`,
        detail: { intent, fill: res.fill, source: opts.source },
      });
      return { ok: true, mode: "paper", fill: res.fill };
    }

    // Live: the signer re-checks policy and builds/validates the tx itself.
    const signed = await signIntent(agentId, intent, { approvalId: verdict.approvalId });
    if (!signed.ok) {
      await logAction(agentId, "blocked", { ok: false, model: opts.model, summary: signed.message, detail: { intent, code: signed.code } });
      return { ok: false, code: signed.code, message: signed.message };
    }
    if (signed.approvalId && !(await consumeApproval(agentId, signed.approvalId, intentHash(intent)))) {
      return { ok: false, code: "approval_spent", message: "That approval was already used" };
    }
    try {
      const sig = await sendSigned(signed.tx);
      if (pool) {
        await pool.query(
          `INSERT INTO agent_ledger (agent_id, address, kind, amount_sol, signature, source, detail) VALUES ($1,$2,'trade',$3,$4,'hosted-signer',$5)
           ON CONFLICT DO NOTHING`,
          [agentId, signed.address, intent.kind === "pump_buy" ? -intent.amountSol : 0, sig, JSON.stringify({ intent })],
        );
      }
      if (signed.approvalId) await finishApproval(signed.approvalId, "executed", { mode: "live", signature: sig });
      await logAction(agentId, "live_trade", { model: opts.model, summary: `Live ${intent.kind} ${intent.amountSol} SOL`, detail: { intent, signature: sig } });
      audit({ actor: `agent:${agentId}`, action: "hosted.live_trade", target: intent.mint, severity: "high", detail: { signature: sig, amountSol: intent.amountSol } });
      return { ok: true, mode: "live", signature: sig };
    } catch (e) {
      if (signed.approvalId) await finishApproval(signed.approvalId, "failed", { error: (e as Error).message });
      await logAction(agentId, "error", { ok: false, model: opts.model, summary: `Send failed: ${(e as Error).message}`, detail: { intent } });
      return { ok: false, code: "send_failed", message: (e as Error).message };
    }
  });
}
