// Persistence for the Cloud workspace (migration 310_cloud.sql): chats, memories, the virtual file workspace,
// per-agent switches and daily usage. Every function takes the agent id explicitly; routes check ownership first.
import { randomBytes } from "crypto";
import {
  CLOUD_TOOLS,
  HELPER_ROLES,
  type ChatMessageView,
  type ChatRole,
  type ChatSession,
  type CloudSettings,
  type CloudTool,
  type FileEntry,
  type HelperRole,
  type MemoryItem,
  type UsageDay,
} from "@shared/cloud";
import { pool } from "../../db";
import { cloudEnv } from "./config";

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

export class WorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function db() {
  if (!pool) throw new WorkspaceError(503, "database_unavailable", "The Cloud workspace needs the database");
  return pool;
}

// ─── chats ───────────────────────────────────────────────────────────

const MAX_CHATS = 100;
export const CHAT_ID = /^chat_[0-9a-f]{20}$/;

function mapSession(r: any): ChatSession {
  return { id: r.id, title: r.title, messageCount: r.message_count, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! };
}

function mapMessage(r: any): ChatMessageView {
  return {
    id: String(r.id),
    role: r.role as ChatRole,
    content: r.content,
    helper: (r.helper as HelperRole) ?? null,
    model: r.model ?? null,
    meta: r.meta ?? {},
    createdAt: iso(r.created_at)!,
  };
}

export async function listChats(agentId: string, limit = 50): Promise<ChatSession[]> {
  const r = await db().query(`SELECT * FROM chat_sessions WHERE agent_id = $1 ORDER BY updated_at DESC LIMIT $2`, [agentId, Math.min(MAX_CHATS, limit)]);
  return r.rows.map(mapSession);
}

export async function createChat(agentId: string, owner: string, title?: string): Promise<ChatSession> {
  const id = "chat_" + randomBytes(10).toString("hex");
  const r = await db().query(`INSERT INTO chat_sessions (id, agent_id, owner_wallet, title) VALUES ($1,$2,$3,$4) RETURNING *`, [
    id,
    agentId,
    owner,
    cleanTitle(title) || "New chat",
  ]);
  // Keep the newest MAX_CHATS per agent.
  await db().query(
    `DELETE FROM chat_sessions WHERE agent_id = $1 AND id IN (SELECT id FROM chat_sessions WHERE agent_id = $1 ORDER BY updated_at DESC OFFSET $2)`,
    [agentId, MAX_CHATS],
  );
  return mapSession(r.rows[0]);
}

function cleanTitle(t: string | undefined | null): string {
  return String(t ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function getChat(agentId: string, id: string): Promise<ChatSession | null> {
  if (!CHAT_ID.test(id)) return null;
  const r = await db().query(`SELECT * FROM chat_sessions WHERE id = $1 AND agent_id = $2`, [id, agentId]);
  return r.rows[0] ? mapSession(r.rows[0]) : null;
}

export async function renameChat(agentId: string, id: string, title: string): Promise<ChatSession | null> {
  const t = cleanTitle(title);
  if (!t) throw new WorkspaceError(400, "bad_title", "Give the chat a name");
  const r = await db().query(`UPDATE chat_sessions SET title = $3 WHERE id = $1 AND agent_id = $2 RETURNING *`, [id, agentId, t]);
  return r.rows[0] ? mapSession(r.rows[0]) : null;
}

export async function deleteChat(agentId: string, id: string): Promise<boolean> {
  const r = await db().query(`DELETE FROM chat_sessions WHERE id = $1 AND agent_id = $2`, [id, agentId]);
  return (r.rowCount ?? 0) > 0;
}

export async function addMessage(
  sessionId: string,
  agentId: string,
  m: { role: ChatRole; content: string; helper?: HelperRole | null; model?: string | null; meta?: Record<string, unknown> },
): Promise<ChatMessageView> {
  const r = await db().query(
    `INSERT INTO chat_messages (session_id, agent_id, role, content, helper, model, meta) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sessionId, agentId, m.role, m.content.slice(0, 20_000), m.helper ?? null, m.model ?? null, JSON.stringify(m.meta ?? {})],
  );
  const title = m.role === "user" ? cleanTitle(m.content).slice(0, 60) : null;
  await db().query(
    `UPDATE chat_sessions SET message_count = message_count + 1, updated_at = now(),
       title = CASE WHEN $2::text IS NOT NULL AND title = 'New chat' THEN $2 ELSE title END
     WHERE id = $1`,
    [sessionId, title || null],
  );
  return mapMessage(r.rows[0]);
}

/** The newest `limit` messages, oldest first. */
export async function listMessages(sessionId: string, limit = 200): Promise<ChatMessageView[]> {
  const r = await db().query(`SELECT * FROM (SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2) x ORDER BY id ASC`, [sessionId, limit]);
  return r.rows.map(mapMessage);
}

export async function chatCount(agentId: string): Promise<{ chats: number; lastAt: string | null }> {
  const r = await db().query(`SELECT count(*)::int AS n, max(updated_at) AS last FROM chat_sessions WHERE agent_id = $1`, [agentId]);
  return { chats: r.rows[0]?.n ?? 0, lastAt: iso(r.rows[0]?.last) };
}

// ─── memories ────────────────────────────────────────────────────────

function mapMemory(r: any): MemoryItem {
  return { id: String(r.id), kind: r.kind, content: r.content, pinned: r.pinned, source: r.source ?? null, createdAt: iso(r.created_at)! };
}

export function cleanMemory(s: string, max = 500): string {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

export async function listMemories(agentId: string, query?: string, limit = 200): Promise<MemoryItem[]> {
  const words = (query ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}$]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 6);
  if (!words.length) {
    const r = await db().query(`SELECT * FROM agent_memories WHERE agent_id = $1 ORDER BY pinned DESC, id DESC LIMIT $2`, [agentId, limit]);
    return r.rows.map(mapMemory);
  }
  // Rank by how many query words each memory contains (ILIKE, escaped).
  const like = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
  const score = like.map((_, i) => `(CASE WHEN content ILIKE $${i + 2} THEN 1 ELSE 0 END)`).join(" + ");
  const r = await db().query(
    `SELECT *, (${score}) AS score FROM agent_memories WHERE agent_id = $1 AND (${score}) > 0 ORDER BY score DESC, pinned DESC, id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`,
    [agentId, ...like],
  );
  return r.rows.map(mapMemory);
}

export async function countMemories(agentId: string): Promise<number> {
  const r = await db().query(`SELECT count(*)::int AS n FROM agent_memories WHERE agent_id = $1`, [agentId]);
  return r.rows[0]?.n ?? 0;
}

export async function addMemory(agentId: string, kind: MemoryItem["kind"], content: string, opts: { pinned?: boolean; source?: string | null } = {}): Promise<MemoryItem> {
  const text = cleanMemory(content);
  if (text.length < 2) throw new WorkspaceError(400, "empty_memory", "Write something to remember");
  // Same text already saved → return it (pinning it if asked) instead of a duplicate.
  const dup = await db().query(`SELECT * FROM agent_memories WHERE agent_id = $1 AND lower(content) = lower($2) LIMIT 1`, [agentId, text]);
  if (dup.rows[0]) {
    if (opts.pinned && !dup.rows[0].pinned) return (await setPinned(agentId, String(dup.rows[0].id), true))!;
    return mapMemory(dup.rows[0]);
  }
  const r = await db().query(`INSERT INTO agent_memories (agent_id, kind, content, pinned, source) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
    agentId,
    kind,
    text,
    !!opts.pinned,
    opts.source?.slice(0, 80) ?? null,
  ]);
  await db().query(
    `DELETE FROM agent_memories WHERE id IN (
       SELECT id FROM agent_memories WHERE agent_id = $1 AND NOT pinned ORDER BY id DESC OFFSET GREATEST(0, $2 - (SELECT count(*) FROM agent_memories WHERE agent_id = $1 AND pinned)))`,
    [agentId, cloudEnv.maxMemories()],
  );
  return mapMemory(r.rows[0]);
}

export async function setPinned(agentId: string, id: string, pinned: boolean): Promise<MemoryItem | null> {
  if (!/^\d{1,15}$/.test(id)) return null;
  const r = await db().query(`UPDATE agent_memories SET pinned = $3 WHERE id = $1 AND agent_id = $2 RETURNING *`, [Number(id), agentId, pinned]);
  return r.rows[0] ? mapMemory(r.rows[0]) : null;
}

export async function deleteMemory(agentId: string, id: string): Promise<boolean> {
  if (!/^\d{1,15}$/.test(id)) return false;
  const r = await db().query(`DELETE FROM agent_memories WHERE id = $1 AND agent_id = $2`, [Number(id), agentId]);
  return (r.rowCount ?? 0) > 0;
}

/** Pinned first, then the newest — what the agent sees of its memory on every turn and scheduled run. */
export async function memoryForPrompt(agentId: string, limit = 8): Promise<string[]> {
  if (!pool) return [];
  try {
    const r = await pool.query(`SELECT content FROM agent_memories WHERE agent_id = $1 ORDER BY pinned DESC, id DESC LIMIT $2`, [agentId, limit]);
    return r.rows.map((x) => String(x.content));
  } catch {
    return []; // table missing → no memories
  }
}

// ─── files (text only, Postgres, never the host filesystem) ──────────

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
const TEXT_EXT = /\.(md|txt|json|csv|ya?ml|log|notes)$/i;

/** Normalises "/notes/plan.md" style paths. Returns null for anything that isn't a plain text-file path. */
export function normPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/\\/g, "/");
  if (!raw || raw.length > 160 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.length > 6) return null;
  for (const p of parts) if (p === "." || p === ".." || !SEGMENT.test(p) || p.endsWith(" ") || p.endsWith(".")) return null;
  const path = "/" + parts.join("/");
  if (!TEXT_EXT.test(path)) return null;
  return path;
}

export function normFolder(input: unknown): string | null {
  if (input === undefined || input === null || input === "" || input === "/") return "/";
  if (typeof input !== "string") return null;
  const parts = input.trim().replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length > 5) return null;
  for (const p of parts) if (p === "." || p === ".." || !SEGMENT.test(p)) return null;
  return "/" + parts.join("/");
}

/** Text only: valid UTF-8 (JS strings already are), no NUL / control characters except tab and newlines. */
export function textProblem(content: string): string | null {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) return "Only plain text can be saved";
  return null;
}

export interface FileQuota {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  usedBytes: number;
}

export async function listFiles(agentId: string, folder = "/"): Promise<{ files: FileEntry[]; quota: FileQuota }> {
  const prefix = folder === "/" ? "/" : folder + "/";
  const r = await db().query(
    `SELECT path, size, updated_at FROM agent_files WHERE agent_id = $1 AND left(path, length($2)) = $2 ORDER BY path LIMIT 1000`,
    [agentId, prefix],
  );
  const used = await db().query(`SELECT COALESCE(sum(size), 0)::int AS b FROM agent_files WHERE agent_id = $1`, [agentId]);
  return {
    files: r.rows.map((x) => ({ path: x.path, size: x.size, updatedAt: iso(x.updated_at)! })),
    quota: { maxFiles: cloudEnv.maxFiles(), maxFileBytes: cloudEnv.maxFileBytes(), maxTotalBytes: cloudEnv.maxTotalBytes(), usedBytes: used.rows[0]?.b ?? 0 },
  };
}

export async function countFiles(agentId: string): Promise<number> {
  const r = await db().query(`SELECT count(*)::int AS n FROM agent_files WHERE agent_id = $1`, [agentId]);
  return r.rows[0]?.n ?? 0;
}

export async function readFile(agentId: string, path: string): Promise<{ path: string; content: string; size: number; updatedAt: string } | null> {
  const p = normPath(path);
  if (!p) throw new WorkspaceError(400, "bad_path", "Use a path like /notes/plan.md (letters, numbers, . _ - only; .md .txt .json .csv .yaml)");
  const r = await db().query(`SELECT path, content, size, updated_at FROM agent_files WHERE agent_id = $1 AND path = $2`, [agentId, p]);
  return r.rows[0] ? { path: r.rows[0].path, content: r.rows[0].content, size: r.rows[0].size, updatedAt: iso(r.rows[0].updated_at)! } : null;
}

export async function writeFile(agentId: string, path: string, content: string, by: string): Promise<FileEntry> {
  const p = normPath(path);
  if (!p) throw new WorkspaceError(400, "bad_path", "Use a path like /notes/plan.md (letters, numbers, . _ - only; .md .txt .json .csv .yaml)");
  if (typeof content !== "string") throw new WorkspaceError(400, "bad_content", "Content must be text");
  const bad = textProblem(content);
  if (bad) throw new WorkspaceError(400, "not_text", bad);
  const size = Buffer.byteLength(content, "utf8");
  if (size > cloudEnv.maxFileBytes()) throw new WorkspaceError(413, "file_too_big", `Files can be up to ${Math.round(cloudEnv.maxFileBytes() / 1024)} KB`);
  const cur = await db().query(
    `SELECT count(*)::int AS n, COALESCE(sum(size), 0)::int AS b, COALESCE(sum(size) FILTER (WHERE path = $2), 0)::int AS mine, bool_or(path = $2) AS exists
     FROM agent_files WHERE agent_id = $1`,
    [agentId, p],
  );
  const row = cur.rows[0] ?? { n: 0, b: 0, mine: 0, exists: false };
  if (!row.exists && row.n >= cloudEnv.maxFiles()) throw new WorkspaceError(413, "too_many_files", `This workspace holds up to ${cloudEnv.maxFiles()} files`);
  if (row.b - row.mine + size > cloudEnv.maxTotalBytes()) {
    throw new WorkspaceError(413, "workspace_full", `This workspace holds up to ${Math.round(cloudEnv.maxTotalBytes() / 1024)} KB`);
  }
  const r = await db().query(
    `INSERT INTO agent_files (agent_id, path, content, size, updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (agent_id, path) DO UPDATE SET content = EXCLUDED.content, size = EXCLUDED.size, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING path, size, updated_at`,
    [agentId, p, content, size, by.slice(0, 80)],
  );
  return { path: r.rows[0].path, size: r.rows[0].size, updatedAt: iso(r.rows[0].updated_at)! };
}

export async function deleteFile(agentId: string, path: string): Promise<boolean> {
  const p = normPath(path);
  if (!p) return false;
  const r = await db().query(`DELETE FROM agent_files WHERE agent_id = $1 AND path = $2`, [agentId, p]);
  return (r.rowCount ?? 0) > 0;
}

// ─── settings (tool + helper switches) ───────────────────────────────

export const DEFAULT_SETTINGS: CloudSettings = {
  skills: Object.fromEntries(CLOUD_TOOLS.map((t) => [t, true])) as Record<CloudTool, boolean>,
  helpers: Object.fromEntries(HELPER_ROLES.map((h) => [h, true])) as Record<HelperRole, boolean>,
  postApproval: true,
  updatedAt: null,
};

function mergeBools<K extends string>(keys: readonly K[], base: Record<K, boolean>, raw: unknown): Record<K, boolean> {
  const out = { ...base };
  if (raw && typeof raw === "object") for (const k of keys) if (typeof (raw as Record<string, unknown>)[k] === "boolean") out[k] = (raw as Record<K, boolean>)[k];
  return out;
}

export async function getSettings(agentId: string): Promise<CloudSettings> {
  if (!pool) return { ...DEFAULT_SETTINGS };
  try {
    const r = await pool.query(`SELECT skills, helpers, post_approval, updated_at FROM agent_workspace WHERE agent_id = $1`, [agentId]);
    const row = r.rows[0];
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      skills: mergeBools(CLOUD_TOOLS, DEFAULT_SETTINGS.skills, row.skills),
      helpers: mergeBools(HELPER_ROLES, DEFAULT_SETTINGS.helpers, row.helpers),
      postApproval: row.post_approval !== false,
      updatedAt: iso(row.updated_at),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  agentId: string,
  patch: { skills?: Partial<Record<CloudTool, boolean>>; helpers?: Partial<Record<HelperRole, boolean>>; postApproval?: boolean },
  by: string,
): Promise<CloudSettings> {
  const cur = await getSettings(agentId);
  const skills = mergeBools(CLOUD_TOOLS, cur.skills, patch.skills);
  const helpers = mergeBools(HELPER_ROLES, cur.helpers, patch.helpers);
  const postApproval = patch.postApproval ?? cur.postApproval;
  await db().query(
    `INSERT INTO agent_workspace (agent_id, skills, helpers, post_approval, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (agent_id) DO UPDATE SET skills = EXCLUDED.skills, helpers = EXCLUDED.helpers, post_approval = EXCLUDED.post_approval,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [agentId, JSON.stringify(skills), JSON.stringify(helpers), postApproval, by],
  );
  return getSettings(agentId);
}

// ─── usage + the per-owner daily message cap ─────────────────────────

const TODAY = `(now() AT TIME ZONE 'UTC')::date`;

export async function usedToday(wallet: string): Promise<number> {
  if (!pool) return 0;
  try {
    const r = await pool.query(`SELECT COALESCE(sum(messages), 0)::int AS n FROM cloud_usage WHERE owner_wallet = $1 AND day = ${TODAY}`, [wallet]);
    return r.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

const capLocks = new Map<string, Promise<unknown>>();

/**
 * Counts one message against the wallet's daily cap, or refuses when it's used up. Serialised per wallet so two
 * parallel requests can't both take the last message.
 */
export async function reserveMessage(agentId: string, wallet: string): Promise<{ ok: boolean; used: number; cap: number }> {
  const cap = cloudEnv.dailyMessages();
  const prev = capLocks.get(wallet) ?? Promise.resolve();
  const run = prev.then(async () => {
    const used = await usedToday(wallet);
    if (used >= cap) return { ok: false, used, cap };
    await db().query(
      `INSERT INTO cloud_usage (agent_id, owner_wallet, day, messages) VALUES ($1,$2,${TODAY},1)
       ON CONFLICT (agent_id, owner_wallet, day) DO UPDATE SET messages = cloud_usage.messages + 1`,
      [agentId, wallet],
    );
    return { ok: true, used: used + 1, cap };
  });
  const tail = run.catch(() => {});
  capLocks.set(wallet, tail);
  void tail.finally(() => capLocks.get(wallet) === tail && capLocks.delete(wallet));
  return run;
}

/** Gives a message back (the turn never reached a model: offline / budget). */
export async function releaseMessage(agentId: string, wallet: string): Promise<void> {
  await pool
    ?.query(`UPDATE cloud_usage SET messages = GREATEST(0, messages - 1) WHERE agent_id = $1 AND owner_wallet = $2 AND day = ${TODAY}`, [agentId, wallet])
    .catch(() => {});
}

export async function addUsage(agentId: string, wallet: string, u: { modelCalls?: number; toolCalls?: number }): Promise<void> {
  if (!pool || (!u.modelCalls && !u.toolCalls)) return;
  await pool
    .query(
      `INSERT INTO cloud_usage (agent_id, owner_wallet, day, model_calls, tool_calls) VALUES ($1,$2,${TODAY},$3,$4)
       ON CONFLICT (agent_id, owner_wallet, day) DO UPDATE SET model_calls = cloud_usage.model_calls + $3, tool_calls = cloud_usage.tool_calls + $4`,
      [agentId, wallet, u.modelCalls ?? 0, u.toolCalls ?? 0],
    )
    .catch((e) => console.error("[cloud] usage write failed:", (e as Error).message));
}

/** Model calls the workspace made today, all agents (the hosted runner counts them against the hosted share). */
export async function modelCallsToday(): Promise<number> {
  if (!pool) return 0;
  try {
    const r = await pool.query(`SELECT COALESCE(sum(model_calls), 0)::int AS n FROM cloud_usage WHERE day = ${TODAY}`);
    return r.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Last `days` UTC days for one agent: chat usage plus what the agent did (posts, paper trades, scheduled runs). */
export async function usageDays(agentId: string, days = 14): Promise<UsageDay[]> {
  const n = Math.max(1, Math.min(60, days));
  const r = await db().query(
    `WITH d AS (SELECT generate_series(${TODAY} - ($2::int - 1), ${TODAY}, interval '1 day')::date AS day),
     u AS (SELECT day, sum(messages)::int AS messages, sum(model_calls)::int AS model_calls, sum(tool_calls)::int AS tool_calls
           FROM cloud_usage WHERE agent_id = $1 AND day > ${TODAY} - $2::int GROUP BY day),
     a AS (SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
                  count(*) FILTER (WHERE kind = 'post' AND ok)::int AS posts,
                  count(*) FILTER (WHERE kind = 'paper_trade')::int AS paper_trades,
                  count(*) FILTER (WHERE kind = 'decision')::int AS decisions
           FROM agent_actions WHERE agent_id = $1 AND created_at > now() - make_interval(days => $2::int + 1) GROUP BY 1)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(u.messages,0) AS messages, COALESCE(u.model_calls,0) AS model_calls, COALESCE(u.tool_calls,0) AS tool_calls,
            COALESCE(a.posts,0) AS posts, COALESCE(a.paper_trades,0) AS paper_trades, COALESCE(a.decisions,0) AS decisions
     FROM d LEFT JOIN u ON u.day = d.day LEFT JOIN a ON a.day = d.day ORDER BY d.day`,
    [agentId, n],
  );
  return r.rows.map((x) => ({
    day: String(x.day),
    messages: x.messages,
    modelCalls: x.model_calls,
    toolCalls: x.tool_calls,
    posts: x.posts,
    paperTrades: x.paper_trades,
    decisions: x.decisions,
  }));
}
