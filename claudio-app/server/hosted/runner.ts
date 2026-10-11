// Hosted agent runner: for each running hosted agent, on a schedule paced to its share of the free-model budget,
// build a compact context (persona, owner goals, rolling memory, read-only board snapshot, own paper book), ask a
// FREE model for one small JSON decision, validate it strictly, and act only through:
//   • postAsAgent()          — the agents workstream applies tier limits + content filters
//   • executeTrade()         — policy check → owner approval / paper fill / (live only if enabled) signIntent
// Crash-safe: a due agent is claimed by pushing next_run_at forward first; every agent runs in its own try/catch;
// 5 consecutive failures pause it. Global kill (admin or HOSTED_KILL) and per-agent kill switches are honoured.
import { z } from "zod";
import { postAsAgent } from "../agents";
import { complete, canSpend, llmStatus, LlmUnavailable, type ChatMessage } from "../llm/openrouter";
import { pool } from "../db";
import { tokenStore } from "../store";
import { log } from "../vite";
import { agentById, runnable, type HostedAgentRow } from "./agentsRepo";
import { hostedEnv, SOL_ADDR } from "./config";
import { cleanup, claimDue, countRunning, finishRun, getRuntime, globalKill, listActions, logAction, setRunning } from "./hostedStore";
import { pollLedgers } from "./ledger";
import { paperBook } from "./paper";
import { loadPolicy, spentToday } from "./policy";
import { executeTrade } from "./trading";
import { memoryForPrompt, modelCallsToday } from "./workspace/store";

// ─── decision schema ─────────────────────────────────────────────────

const memory = z.string().max(280).optional();
export const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("post"), room: z.string().regex(/^[a-z0-9-]{2,64}$/), content: z.string().trim().min(1).max(500), memory }).strict(),
  z
    .object({
      action: z.literal("paper_trade"),
      side: z.enum(["buy", "sell"]),
      mint: z.string().regex(SOL_ADDR),
      amountSol: z.number().finite().positive().max(5),
      reason: z.string().max(300).optional(),
      memory,
    })
    .strict(),
  z.object({ action: z.literal("idle"), reason: z.string().max(300).optional(), memory }).strict(),
]);
export type Decision = z.infer<typeof decisionSchema>;

/** Extracts the first balanced JSON object from model output (tolerates code fences / chatter) and validates it. */
export function parseDecision(text: string): { ok: true; decision: Decision } | { ok: false; error: string } {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) return { ok: false, error: "no JSON object" };
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return { ok: false, error: "unterminated JSON" };
  let raw: unknown;
  try {
    raw = JSON.parse(s.slice(start, end + 1));
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const p = decisionSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ").slice(0, 200) };
  return { ok: true, decision: p.data };
}

// ─── budget pacing ───────────────────────────────────────────────────

let hostedDay = new Date().toISOString().slice(0, 10);
let hostedUsed = 0;
let usageLoaded = false;

function rollHostedDay(): void {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== hostedDay) {
    hostedDay = d;
    hostedUsed = 0;
  }
}

async function loadUsage(): Promise<void> {
  if (usageLoaded || !pool) return;
  usageLoaded = true;
  try {
    const r = await pool.query(
      `SELECT COALESCE(sum((detail->>'calls')::int), 0) AS n FROM agent_actions WHERE kind = 'decision' AND created_at >= date_trunc('day', now(), 'UTC')`,
    );
    // Cloud workspace chats share the hosted allowance (server/hosted/workspace).
    hostedUsed = Math.max(hostedUsed, Number(r.rows[0]?.n ?? 0) + (await modelCallsToday()));
  } catch {
    /* table missing → start at 0 */
  }
}

/** Counts model calls made outside the scheduler (Cloud workspace chats) against the hosted share. */
export function noteHostedCalls(n: number): void {
  if (!(n > 0)) return;
  rollHostedDay();
  hostedUsed += n;
}

export function hostedAllowance(): number {
  return Math.floor(llmStatus().budget * hostedEnv.llmShare());
}

export function llmShareStatus() {
  rollHostedDay();
  return { share: hostedEnv.llmShare(), usedToday: hostedUsed, allowance: hostedAllowance() };
}

/** ok | unconfigured (no key) | budget (hosted share spent, global budget low, or provider suspended). */
export function llmGate(): "ok" | "unconfigured" | "budget" {
  rollHostedDay();
  const st = llmStatus();
  if (!st.configured) return "unconfigured";
  const headroom = Math.ceil(st.budget * 0.1); // always leave ≥ 10% of the day's budget for resident agents
  if (hostedUsed >= hostedAllowance() || !canSpend(headroom)) return "budget";
  return "ok";
}

/** Time between two decisions of one agent: the hosted allowance spread over the active agents, ≥ the minimum. */
export function intervalMs(activeAgents: number): number {
  const perDay = Math.max(1, hostedAllowance());
  return Math.max(hostedEnv.minIntervalMs(), Math.ceil((86_400_000 * Math.max(1, activeAgents)) / perDay));
}

// ─── context ─────────────────────────────────────────────────────────

interface MarketRow {
  mint: string;
  symbol: string;
  phase: string;
  mcapUsd: number;
  change1hPct: number;
  volume1hUsd: number;
  bondingPct: number;
  holders: number;
  top10Pct: number;
  devHoldPct: number;
}

export function marketSnapshot(limit = 8): MarketRow[] {
  const rows = tokenStore
    .list("sol", undefined, 300)
    .filter((t) => t.priceNative > 0 && !tokenStore.isSimulated(t.key))
    .sort((a, b) => b.volume1hUsd - a.volume1hUsd)
    .slice(0, limit);
  return rows.map((t) => ({
    mint: t.address,
    symbol: String(t.symbol ?? "").slice(0, 16),
    phase: t.phase,
    mcapUsd: Math.round(t.mcapUsd),
    change1hPct: Math.round(t.change1hPct * 10) / 10,
    volume1hUsd: Math.round(t.volume1hUsd),
    bondingPct: Math.round(t.bondingPct),
    holders: t.holders,
    top10Pct: Math.round(t.top10Pct),
    devHoldPct: Math.round(t.devHoldPct),
  }));
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function buildMessages(agent: HostedAgentRow, ctx: { goals: string; memory: string; market: MarketRow[] }): Promise<ChatMessage[]> {
  const { policy } = await loadPolicy(agent.id);
  const book = await paperBook(agent.id).catch(() => ({ positions: [], realizedPnlSol: 0, trades: 0 }));
  const spent = await spentToday(agent.id).catch(() => 0);
  const recent = (await listActions(agent.id, 6).catch(() => [])).map((a) => `${a.kind}: ${clip(a.summary ?? "", 120)}`);
  const rooms = hostedEnv.rooms();
  const system = [
    `You are ${agent.name}, an AI agent hosted on Claudio (useclaudio.xyz), a Solana memecoin terminal where humans and AI agents launch and trade.`,
    `Persona (set by your owner): ${clip(agent.persona || agent.bio || "a curious memecoin market observer", 800)}`,
    ctx.goals ? `Owner goals: ${clip(ctx.goals, 600)}` : "",
    "Rules: you can only do ONE of three things per turn, answering with a single JSON object and nothing else:",
    `  {"action":"post","room":"<one of ${rooms.join(", ")} or t-<mint> for a listed token>","content":"<plain text, ≤ 280 chars, no links>","memory":"<optional note to remember>"}`,
    policy.canTrade && !policy.killed
      ? `  {"action":"paper_trade","side":"buy"|"sell","mint":"<mint from the market list or your positions>","amountSol":<number ≤ ${policy.maxSolPerTrade}>,"reason":"<why>","memory":"<optional>"}`
      : "  (trading is disabled for you — do not output paper_trade)",
    `  {"action":"idle","reason":"<why>","memory":"<optional>"}`,
    "Never give financial advice, never promise returns, never shill. Be concise and specific. Posting nothing new is better than repeating yourself.",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    `Time (UTC): ${new Date().toISOString()}`,
    `Your memory: ${ctx.memory ? clip(ctx.memory, 1500) : "(empty)"}`,
    `Your recent actions: ${recent.length ? recent.join(" | ") : "(none)"}`,
    `Your paper book: ${book.positions.length ? book.positions.map((p) => `${p.symbol ?? p.mint.slice(0, 6)} (${p.mint}) cost ${p.costSol.toFixed(3)} SOL value ${p.valueSol?.toFixed(3) ?? "?"}`).join("; ") : "no positions"}; realized PnL ${book.realizedPnlSol.toFixed(3)} SOL; spent today ${spent.toFixed(3)}/${policy.maxSolPerDay} SOL.`,
    `Market (Solana board, top by 1h volume): ${ctx.market.length ? JSON.stringify(ctx.market) : "(board empty)"}`,
    "Answer with the JSON object only.",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function rollMemory(prev: string, note: string | undefined): string {
  if (!note?.trim()) return prev;
  const line = `[${new Date().toISOString().slice(0, 16)}] ${note.trim().replace(/\s+/g, " ").slice(0, 280)}`;
  const lines = [...prev.split("\n").filter(Boolean), line].slice(-12);
  let out = lines.join("\n");
  while (out.length > 1500 && lines.length > 1) {
    lines.shift();
    out = lines.join("\n");
  }
  return out;
}

async function postsToday(agentId: string): Promise<number> {
  if (!pool) return 0;
  const r = await pool.query(`SELECT count(*)::int AS n FROM agent_actions WHERE agent_id = $1 AND kind = 'post' AND ok AND created_at >= date_trunc('day', now(), 'UTC')`, [agentId]);
  return r.rows[0]?.n ?? 0;
}

// ─── one run ─────────────────────────────────────────────────────────

export interface RunResult {
  ok: boolean;
  action?: Decision["action"];
  outcome?: string;
  model?: string;
  error?: string;
}

/** Runs one decision for one agent now (the scheduler calls this for due agents; tests call it directly). */
export async function runAgentOnce(agentId: string): Promise<RunResult> {
  const agent = await agentById(agentId);
  if (!runnable(agent)) {
    await setRunning(agentId, false, "system").catch(() => {});
    await logAction(agentId, "control", { ok: false, summary: "Stopped: agent is not an active hosted agent" });
    return { ok: false, error: "not_runnable" };
  }
  if ((await globalKill()).killed) return { ok: false, error: "killed_global" };
  const { policy, adminKilled } = await loadPolicy(agentId);
  if (policy.killed || adminKilled) return { ok: false, error: "killed" };
  const gate = llmGate();
  if (gate !== "ok") return { ok: false, error: `llm_${gate}` };

  const runtime = await getRuntime(agentId);
  const market = marketSnapshot();
  // The rolling summary plus the newest / pinned notes from the Cloud workspace memory.
  const notes = await memoryForPrompt(agentId, 5);
  const memoryText = [runtime.memory, ...notes.map((n) => `[note] ${clip(n, 200)}`)].filter(Boolean).join("\n");
  const messages = await buildMessages(agent!, { goals: runtime.goals, memory: memoryText, market });
  const before = llmStatus().usedToday;
  let text: string;
  let model: string;
  try {
    const c = await complete(messages, { models: agent!.model ? [agent!.model] : [], maxTokens: 350, temperature: 0.7, timeoutMs: 40_000 });
    text = c.text;
    model = c.model;
  } finally {
    const used = Math.max(1, llmStatus().usedToday - before);
    rollHostedDay();
    hostedUsed += used;
    await logAction(agentId, "decision", { detail: { calls: used } });
  }
  const parsed = parseDecision(text);
  if (!parsed.ok) {
    await logAction(agentId, "invalid_decision", { ok: false, model, summary: parsed.error, detail: { text: clip(text, 400) } });
    return { ok: true, outcome: "invalid_decision", model };
  }
  const d = parsed.decision;
  let outcome = "idle";
  if (d.action === "post") {
    const tokenRoom = /^t-([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(d.room);
    const allowed = hostedEnv.rooms().includes(d.room) || (tokenRoom && market.some((m) => m.mint === tokenRoom[1]));
    if (!allowed) {
      outcome = "room_not_allowed";
      await logAction(agentId, "blocked", { ok: false, model, summary: `Room ${d.room} not allowed`, detail: { decision: d } });
    } else if ((await postsToday(agentId)) >= 24) {
      outcome = "post_limit";
      await logAction(agentId, "blocked", { ok: false, model, summary: "Daily post limit reached", detail: { decision: d } });
    } else {
      const r = await postAsAgent(agentId, d.room, d.content, { kind: "post", model, tokenKey: tokenRoom ? `sol:${tokenRoom[1]}` : null });
      outcome = r.ok ? "posted" : `post_${r.reason ?? "failed"}`;
      await logAction(agentId, "post", { ok: r.ok, model, summary: r.ok ? clip(d.content, 200) : `Post refused: ${r.reason}`, detail: { room: d.room, id: r.id, reason: r.reason } });
    }
  } else if (d.action === "paper_trade") {
    const known = market.some((m) => m.mint === d.mint) || (await paperBook(agentId)).positions.some((p) => p.mint === d.mint);
    if (!known) {
      outcome = "unknown_token";
      await logAction(agentId, "blocked", { ok: false, model, summary: "Token not on the board snapshot or in positions", detail: { decision: d } });
    } else {
      const r = await executeTrade(agentId, { kind: d.side === "buy" ? "pump_buy" : "pump_sell", mint: d.mint, amountSol: d.amountSol }, { source: "runner", reason: d.reason, model });
      outcome = r.ok ? `${r.mode}_trade` : r.code;
    }
  } else {
    await logAction(agentId, "idle", { model, summary: d.reason ?? "idle" });
  }
  await finishRun(agentId, { ok: true, memory: rollMemory(runtime.memory, d.memory), nextInMs: intervalMs(await countRunning()) });
  return { ok: true, action: d.action, outcome, model };
}

// ─── scheduler ───────────────────────────────────────────────────────

const state = { started: false, ticking: false, lastTickAt: null as string | null, lastGate: "ok" as "ok" | "unconfigured" | "budget" };

export function runnerState() {
  return { ...state };
}

export async function tick(): Promise<void> {
  if (state.ticking || !pool) return;
  state.ticking = true;
  state.lastTickAt = new Date().toISOString();
  try {
    await loadUsage();
    if ((await globalKill()).killed) return;
    const gate = llmGate();
    if (gate !== state.lastGate) log(`hosted runner: free models ${gate}`, "hosted");
    state.lastGate = gate;
    if (gate !== "ok") return;
    const left = hostedAllowance() - hostedUsed;
    const due = await claimDue(Math.max(0, Math.min(5, left)));
    for (const id of due) {
      try {
        const r = await runAgentOnce(id);
        if (!r.ok && r.error?.startsWith("llm_")) {
          await finishRun(id, { ok: true, nextInMs: hostedEnv.minIntervalMs() }); // budget ran out mid-tick: just wait
        } else if (!r.ok && r.error !== "not_runnable") {
          await finishRun(id, { ok: true, nextInMs: intervalMs(await countRunning()) });
        }
      } catch (e) {
        const msg = e instanceof LlmUnavailable ? `llm: ${e.message}` : (e as Error).message;
        await logAction(id, "error", { ok: false, summary: clip(msg, 300) }).catch(() => {});
        await finishRun(id, { ok: false, error: msg, nextInMs: hostedEnv.minIntervalMs() }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("[hosted] tick failed:", (e as Error).message);
  } finally {
    state.ticking = false;
  }
}

export function startRunner(): void {
  if (state.started) return;
  state.started = true;
  if (!pool) {
    log("hosted runner off: no database", "hosted");
    return;
  }
  const every = (ms: number, fn: () => Promise<unknown>, firstMs: number) => {
    const run = () => fn().catch((e) => console.error("[hosted]", (e as Error).message));
    setTimeout(run, firstMs).unref?.();
    setInterval(run, ms).unref?.();
  };
  every(hostedEnv.tickMs(), tick, 20_000);
  every(hostedEnv.ledgerPollMs(), pollLedgers, 45_000);
  every(3_600_000, cleanup, 120_000);
  log(`hosted runner on (tick ${Math.round(hostedEnv.tickMs() / 1000)} s, share ${hostedEnv.llmShare()}, live trading ${hostedEnv.liveTrading() ? "ON" : "off"})`, "hosted");
}
