// The Cloud workspace tool dispatcher: a strict allowlist of tools a hosted agent may call from chat (or a helper
// may call while answering a delegated step). Every call is validated with zod, checked against the agent's skill
// switches and the helper's role, and logged to the agent's activity. Read-only except memory_save / files_write
// (the agent's own workspace), paper_trade (policy + paper engine only, never signed) and thread_post (owner
// approval by default, then postAsAgent). No shell, no network fetches, no host filesystem.
import { z } from "zod";
import type { TokenSnapshot } from "@shared/types";
import { CLAUDIO_TOKEN } from "@shared/platform";
import { HELPER_INFO, TOOL_INFO, type CloudSettings, type CloudTool, type HelperRole } from "@shared/cloud";
import { postAsAgent } from "../../agents";
import { claudioCoins, isClaudioCoin, tokenFacts } from "../../agents/residents";
import { CLAUDIO_KEY, latestThread, roomMessages } from "../../agents/thread";
import { pool } from "../../db";
import { tokenStore } from "../../store";
import type { HostedAgentRow } from "../agentsRepo";
import { hostedEnv, SOL_ADDR } from "../config";
import { consumeApproval, createApproval, finishApproval, intentHash, logAction } from "../hostedStore";
import { paperBook } from "../paper";
import { loadPolicy, spentToday } from "../policy";
import { executeTrade } from "../trading";
import { addMemory, listFiles, listMemories, normFolder, readFile, writeFile, WorkspaceError } from "./store";

export interface ToolCtx {
  agent: HostedAgentRow;
  /** The signed-in owner driving the chat. */
  wallet: string;
  settings: CloudSettings;
  chatId: string | null;
  /** Set when a helper is the caller: only that role's tools are allowed. */
  helper?: HelperRole;
}

export interface ToolResult {
  ok: boolean;
  code?: string;
  /** What the model reads next (wrapped as untrusted data by the turn loop). */
  text: string;
  /** One plain line for people (tool card + activity). */
  summary: string;
  approvalId?: string;
  approvalKind?: string;
  /** thread_post: the exact text waiting for approval. */
  preview?: string;
}

// ─── coins: $CLAUDIO and coins launched on Claudio only ──────────────

const symbolStr = z.string().trim().min(1).max(16);
const coinRef = z.object({ mint: z.string().regex(SOL_ADDR).optional(), symbol: symbolStr.optional() }).strict();

const NOT_CLAUDIO = "I only look at $CLAUDIO and coins launched on Claudio. That coin isn't one of them, so I won't look it up.";

type Resolved = { ok: true; token: TokenSnapshot | null; mint: string; symbol: string } | { ok: false; code: string; text: string };

/** Finds a coin by mint or symbol and refuses anything that isn't $CLAUDIO or launched on Claudio. */
export function resolveCoin(ref: { mint?: string; symbol?: string }): Resolved {
  const sym = ref.symbol?.replace(/^\$/, "").trim().toUpperCase();
  if (ref.mint) {
    const t = tokenStore.get(`sol:${ref.mint}`) ?? null;
    if (ref.mint === CLAUDIO_TOKEN.mint) return { ok: true, token: t, mint: ref.mint, symbol: "CLAUDIO" };
    if (!t) return { ok: false, code: "not_claudio_coin", text: `${NOT_CLAUDIO} (It isn't on Claudio's board either.)` };
    if (!isClaudioCoin(t)) return { ok: false, code: "not_claudio_coin", text: NOT_CLAUDIO };
    return { ok: true, token: t, mint: t.address, symbol: t.symbol };
  }
  if (!sym) return { ok: false, code: "bad_args", text: "Give a mint address or a symbol." };
  if (sym === CLAUDIO_TOKEN.symbol.toUpperCase()) return { ok: true, token: tokenStore.get(CLAUDIO_KEY) ?? null, mint: CLAUDIO_TOKEN.mint, symbol: "CLAUDIO" };
  const mine = claudioCoins().filter((t) => t.symbol.toUpperCase() === sym);
  if (mine.length) {
    const t = mine.sort((a, b) => b.volume1hUsd - a.volume1hUsd)[0];
    return { ok: true, token: t, mint: t.address, symbol: t.symbol };
  }
  return { ok: false, code: "not_claudio_coin", text: NOT_CLAUDIO };
}

function brief(t: TokenSnapshot) {
  const f = tokenFacts(t);
  return { symbol: f.symbol, mint: t.address, phase: f.phase, mcap: f.mcap, change1h: f.change1h, volume1h: f.volume1h, holders: f.holders, bondingPct: f.bondingPct, ageMin: f.ageMin };
}

function listClaudioCoins(sort: "movers" | "new" | "volume", limit: number): TokenSnapshot[] {
  const claudio = tokenStore.get(CLAUDIO_KEY);
  const seen = new Set<string>();
  const all = [...(claudio ? [claudio] : []), ...claudioCoins()].filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), isClaudioCoin(t))));
  const by =
    sort === "new"
      ? (a: TokenSnapshot, b: TokenSnapshot) => b.createdAt - a.createdAt
      : sort === "volume"
        ? (a: TokenSnapshot, b: TokenSnapshot) => b.volume1hUsd - a.volume1hUsd
        : (a: TokenSnapshot, b: TokenSnapshot) => Math.abs(b.change1hPct) - Math.abs(a.change1hPct);
  return all.sort(by).slice(0, limit);
}

// ─── schemas ─────────────────────────────────────────────────────────

const SCHEMAS = {
  claudio_coins: z.object({ sort: z.enum(["movers", "new", "volume"]).optional(), limit: z.number().int().min(1).max(15).optional() }).strict(),
  coin_facts: coinRef,
  wallet_info: z.object({}).strict(),
  thread_read: z.object({ room: z.string().regex(/^[a-z0-9-]{2,64}$/).optional(), limit: z.number().int().min(1).max(15).optional() }).strict(),
  memory_search: z.object({ query: z.string().trim().min(1).max(100) }).strict(),
  memory_save: z.object({ text: z.string().trim().min(2).max(280), pin: z.boolean().optional() }).strict(),
  files_list: z.object({ folder: z.string().max(120).optional() }).strict(),
  files_read: z.object({ path: z.string().min(1).max(160) }).strict(),
  files_write: z.object({ path: z.string().min(1).max(160), content: z.string().max(1024 * 1024) }).strict(),
  paper_trade: z
    .object({
      side: z.enum(["buy", "sell"]),
      mint: z.string().regex(SOL_ADDR).optional(),
      symbol: symbolStr.optional(),
      amountSol: z.number().finite().positive().max(5),
      reason: z.string().max(200).optional(),
    })
    .strict(),
  thread_post: z.object({ room: z.string().regex(/^[a-z0-9-]{2,80}$/), content: z.string().trim().min(1).max(280) }).strict(),
} satisfies Record<CloudTool, z.ZodTypeAny>;

/** One line per tool for the system prompt: name, what it does, exact argument shape. */
export const TOOL_SIGNATURES: Record<CloudTool, string> = {
  claudio_coins: `claudio_coins {"sort"?: "movers"|"new"|"volume", "limit"?: 1-15} — $CLAUDIO and coins launched on Claudio`,
  coin_facts: `coin_facts {"symbol"?: "CLAUDIO", "mint"?: "<address>"} — details on ONE Claudio coin (others are refused)`,
  wallet_info: `wallet_info {} — your paper positions, today's spend and your guard rails`,
  thread_read: `thread_read {"room"?: "general"|"markets"|"t-<mint>", "limit"?: 1-15} — recent thread messages`,
  memory_search: `memory_search {"query": "<words>"} — search your saved notes`,
  memory_save: `memory_save {"text": "<≤280 chars>", "pin"?: true} — remember something for later`,
  files_list: `files_list {"folder"?: "/notes"} — list your workspace files`,
  files_read: `files_read {"path": "/notes/plan.md"} — open a text file`,
  files_write: `files_write {"path": "/notes/plan.md", "content": "<text>"} — create or replace a text file`,
  paper_trade: `paper_trade {"side": "buy"|"sell", "symbol" or "mint", "amountSol": <number>, "reason": "<why>"} — practice trade on a Claudio coin within your guard rails (never real SOL)`,
  thread_post: `thread_post {"room": "general"|"markets"|"t-<mint>", "content": "<plain text ≤280 chars, no links>"} — post in the thread (your owner approves it first)`,
};

export function toolAllowed(ctx: ToolCtx, name: string): name is CloudTool {
  if (!(name in SCHEMAS)) return false;
  const tool = name as CloudTool;
  if (!ctx.settings.skills[tool]) return false;
  if (ctx.helper && !HELPER_INFO[ctx.helper].tools.includes(tool)) return false;
  return true;
}

// ─── dispatcher ──────────────────────────────────────────────────────

const clipText = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function runTool(ctx: ToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  if (!(name in SCHEMAS)) return done(ctx, name, { ok: false, code: "unknown_tool", text: `There is no tool called ${clipText(name, 40)}.`, summary: "Unknown tool" });
  const tool = name as CloudTool;
  if (!ctx.settings.skills[tool]) {
    return done(ctx, tool, { ok: false, code: "skill_off", text: `Your owner switched ${tool} off. Answer without it.`, summary: "Switched off in Skills" });
  }
  if (ctx.helper && !HELPER_INFO[ctx.helper].tools.includes(tool)) {
    return done(ctx, tool, { ok: false, code: "not_for_helper", text: `The ${ctx.helper} helper can't use ${tool}.`, summary: "Not allowed for this helper" });
  }
  const parsed = SCHEMAS[tool].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ").slice(0, 200);
    return done(ctx, tool, { ok: false, code: "bad_args", text: `Bad arguments for ${tool} (${why}). Use exactly: ${TOOL_SIGNATURES[tool]}`, summary: "Bad arguments" });
  }
  try {
    return done(ctx, tool, await exec(ctx, tool, parsed.data as Record<string, unknown>));
  } catch (e) {
    const msg = e instanceof WorkspaceError ? e.message : "Something went wrong running that";
    if (!(e instanceof WorkspaceError)) console.error(`[cloud] tool ${tool} failed:`, (e as Error).message);
    return done(ctx, tool, { ok: false, code: e instanceof WorkspaceError ? e.code : "tool_failed", text: msg, summary: msg });
  }
}

async function done(ctx: ToolCtx, tool: string, r: ToolResult): Promise<ToolResult> {
  const label = (TOOL_INFO as Record<string, { label: string }>)[tool]?.label ?? tool;
  await logAction(ctx.agent.id, "tool", {
    ok: r.ok,
    summary: `${label}: ${r.summary}`,
    detail: { tool, code: r.code ?? null, chat: ctx.chatId, helper: ctx.helper ?? null, approvalId: r.approvalId ?? null },
  });
  return r;
}

async function exec(ctx: ToolCtx, tool: CloudTool, a: Record<string, any>): Promise<ToolResult> {
  const agentId = ctx.agent.id;
  switch (tool) {
    case "claudio_coins": {
      const list = listClaudioCoins(a.sort ?? "movers", a.limit ?? 8);
      if (!list.length) return { ok: true, text: "No Claudio coins on the live board right now ($CLAUDIO isn't loaded yet either).", summary: "No coins on the board yet" };
      return { ok: true, text: JSON.stringify(list.map(brief)), summary: `${list.length} coin${list.length === 1 ? "" : "s"}: ${list.slice(0, 4).map((t) => "$" + t.symbol).join(", ")}` };
    }
    case "coin_facts": {
      if (!a.mint && !a.symbol) return { ok: false, code: "bad_args", text: "Give a symbol or a mint.", summary: "No coin given" };
      const c = resolveCoin(a);
      if (!c.ok) return { ok: false, code: c.code, text: c.text, summary: c.code === "not_claudio_coin" ? "Refused: not a Claudio coin" : c.text };
      if (!c.token) return { ok: true, text: `$${c.symbol} (${c.mint}) isn't on the live board right now, so there are no fresh numbers.`, summary: `$${c.symbol}: no live numbers yet` };
      return { ok: true, text: JSON.stringify({ mint: c.mint, ...tokenFacts(c.token) }), summary: `$${c.symbol} looked up` };
    }
    case "wallet_info": {
      const [{ policy, adminKilled }, book, spent] = await Promise.all([loadPolicy(agentId), paperBook(agentId), spentToday(agentId)]);
      let escrow: { address: string; balanceSol: number | null } | null = null;
      if (pool) {
        const r = await pool.query(`SELECT address, balance_lamports FROM agent_wallets WHERE agent_id = $1`, [agentId]).catch(() => ({ rows: [] as any[] }));
        if (r.rows[0]) escrow = { address: r.rows[0].address, balanceSol: r.rows[0].balance_lamports != null ? Number(r.rows[0].balance_lamports) / 1e9 : null };
      }
      const body = {
        mode: "paper (practice trades only)",
        guardRails: {
          tradingOn: policy.canTrade,
          maxSolPerTrade: policy.maxSolPerTrade,
          maxSolPerDay: policy.maxSolPerDay,
          askOwnerAboveSol: policy.askOwnerAboveSol,
          killSwitch: policy.killed || adminKilled,
        },
        spentTodaySol: Math.round(spent * 1e4) / 1e4,
        realizedPnlSol: Math.round(book.realizedPnlSol * 1e4) / 1e4,
        positions: book.positions.slice(0, 10).map((p) => ({ symbol: p.symbol, mint: p.mint, costSol: p.costSol, valueSol: p.valueSol })),
        escrowWallet: escrow,
      };
      return { ok: true, text: JSON.stringify(body), summary: `${book.positions.length} paper position${book.positions.length === 1 ? "" : "s"}, ${spent.toFixed(3)} SOL spent today` };
    }
    case "thread_read": {
      const limit = a.limit ?? 10;
      const rows = a.room ? (await roomMessages(a.room, { limit })).data : await latestThread(limit);
      if (!rows.length) return { ok: true, text: "No messages there yet.", summary: "Nothing posted yet" };
      const lines = rows.map((m) => `${m.agent.name} in #${m.room}: ${clipText(m.content.replace(/\s+/g, " "), 280)}`);
      return { ok: true, text: lines.join("\n"), summary: `Read ${rows.length} message${rows.length === 1 ? "" : "s"}${a.room ? ` in #${a.room}` : ""}` };
    }
    case "memory_search": {
      const hits = await listMemories(agentId, a.query, 8);
      if (!hits.length) return { ok: true, text: "Nothing in memory matches that.", summary: "No matches" };
      return { ok: true, text: hits.map((m) => `- ${m.pinned ? "(pinned) " : ""}${m.content}`).join("\n"), summary: `${hits.length} match${hits.length === 1 ? "" : "es"}` };
    }
    case "memory_save": {
      const m = await addMemory(agentId, "note", a.text, { pinned: !!a.pin, source: ctx.chatId ? `chat:${ctx.chatId}` : "chat" });
      return { ok: true, text: "Saved to memory.", summary: `Saved: "${clipText(m.content, 80)}"` };
    }
    case "files_list": {
      const folder = normFolder(a.folder);
      if (!folder) return { ok: false, code: "bad_path", text: "Use a folder like /notes", summary: "Bad folder" };
      const { files, quota } = await listFiles(agentId, folder);
      if (!files.length) return { ok: true, text: `No files in ${folder}.`, summary: `No files in ${folder}` };
      return {
        ok: true,
        text: files.map((f) => `${f.path} (${f.size} bytes)`).join("\n") + `\n(${quota.usedBytes} of ${quota.maxTotalBytes} bytes used)`,
        summary: `${files.length} file${files.length === 1 ? "" : "s"} in ${folder}`,
      };
    }
    case "files_read": {
      const f = await readFile(agentId, a.path);
      if (!f) return { ok: false, code: "not_found", text: `There's no file at ${a.path}.`, summary: "File not found" };
      return { ok: true, text: clipText(f.content, 8000), summary: `Opened ${f.path}` };
    }
    case "files_write": {
      const f = await writeFile(agentId, a.path, a.content, `agent:${ctx.agent.slug}`);
      return { ok: true, text: `Saved ${f.path} (${f.size} bytes).`, summary: `Saved ${f.path}` };
    }
    case "paper_trade": {
      const c = resolveCoin({ mint: a.mint, symbol: a.symbol });
      if (!c.ok) return { ok: false, code: c.code, text: c.text, summary: c.code === "not_claudio_coin" ? "Refused: not a Claudio coin" : c.text };
      const reason = `Chat: ${String(a.reason ?? "owner chat").slice(0, 180)}`;
      const r = await executeTrade(agentId, { kind: a.side === "buy" ? "pump_buy" : "pump_sell", mint: c.mint, amountSol: a.amountSol }, { source: "cloud", reason, paperOnly: true });
      if (r.ok && r.mode === "paper") {
        const f = r.fill;
        return {
          ok: true,
          text: `Paper ${f.side} filled: ${f.amountSol.toFixed(4)} SOL of $${f.symbol ?? c.symbol} at ${f.priceSol.toExponential(3)} SOL, fee ${f.feeSol.toFixed(5)} SOL.`,
          summary: `Paper ${f.side} ${f.amountSol.toFixed(3)} SOL of $${f.symbol ?? c.symbol}`,
        };
      }
      if (!r.ok && r.code === "needs_approval") {
        return {
          ok: true,
          code: "needs_approval",
          text: `That's above the ask-me limit, so I asked my owner to approve it. ${r.message}`,
          summary: `Waiting for your approval: paper ${a.side} ${a.amountSol} SOL of $${c.symbol}`,
          approvalId: r.approvalId,
          approvalKind: a.side === "buy" ? "pump_buy" : "pump_sell",
        };
      }
      const msg = r.ok ? "Refused" : r.message;
      return { ok: false, code: r.ok ? "refused" : r.code, text: `The trade was refused: ${msg}`, summary: `Refused: ${msg}` };
    }
    case "thread_post": {
      const room: string = a.room;
      const tokenRoom = /^t-([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(room);
      const roomOk = hostedEnv.rooms().includes(room) || (tokenRoom ? resolveCoin({ mint: tokenRoom[1] }).ok : false);
      if (!roomOk) return { ok: false, code: "room_not_allowed", text: `You can post in ${hostedEnv.rooms().join(", ")} or the room of a Claudio coin.`, summary: "Room not allowed" };
      const content = String(a.content).replace(/\s+/g, " ").trim();
      if (ctx.settings.postApproval) {
        const ap = await createApproval(agentId, { kind: "thread_post", room, content, amountSol: 0 }, `Chat: post in #${room}`);
        if (!ap) return { ok: false, code: "approvals_full", text: "Too many things are already waiting for my owner.", summary: "Too many approvals waiting" };
        await logAction(agentId, "approval", { summary: `Asked the owner: post in #${room}`, detail: { approvalId: ap.id, room } });
        return { ok: true, code: "needs_approval", text: "The post is waiting for my owner's approval.", summary: `Waiting for your approval: post in #${room}`, approvalId: ap.id, approvalKind: "thread_post", preview: content };
      }
      return postNow(agentId, room, content, tokenRoom ? `sol:${tokenRoom[1]}` : null);
    }
  }
}

async function postNow(agentId: string, room: string, content: string, tokenKey: string | null): Promise<ToolResult> {
  const r = await postAsAgent(agentId, room, content, { kind: "post", tokenKey });
  await logAction(agentId, "post", { ok: r.ok, summary: r.ok ? clipText(content, 200) : `Post refused: ${r.reason}`, detail: { room, id: r.id, reason: r.reason, source: "cloud" } });
  if (!r.ok) return { ok: false, code: r.reason ?? "post_failed", text: `The thread refused the post (${r.reason}).`, summary: `Post refused: ${String(r.reason ?? "").replace(/_/g, " ")}` };
  return { ok: true, text: `Posted in #${room}.`, summary: `Posted in #${room}` };
}

/**
 * Runs an owner-approved thread_post approval (called from the approvals route). The approval moves
 * approved → executed atomically first, so it can only post once.
 */
export async function executeApprovedPost(agentId: string, approval: { id: string; intent: Record<string, unknown> }): Promise<{ ok: boolean; code?: string; message: string }> {
  const intent = approval.intent;
  const room = String(intent.room ?? "");
  const content = String(intent.content ?? "");
  if (!/^[a-z0-9-]{2,80}$/.test(room) || !content) return { ok: false, code: "bad_intent", message: "That approval isn't a post" };
  if (!(await consumeApproval(agentId, approval.id, intentHash(intent)))) return { ok: false, code: "approval_spent", message: "That approval was already used" };
  const tokenRoom = /^t-([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(room);
  const r = await postNow(agentId, room, content, tokenRoom ? `sol:${tokenRoom[1]}` : null);
  await finishApproval(approval.id, r.ok ? "executed" : "failed", r.ok ? { mode: "post", room } : { error: r.code });
  return { ok: r.ok, code: r.code, message: r.summary };
}
