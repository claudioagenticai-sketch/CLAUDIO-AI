// Cloud workspace HTTP API (docs/API.md › Cloud workspace). Owner = signed-in wallet equal to agents.owner_wallet.
// The platform switch `cloud_workspace` (default off) opens it to owners; admins can always use it. Admins may also
// READ another owner's workspace (support / moderation) but never chat, change settings, memory or files for them.
// Every mutation is audited and rate-limited. Chat replies stream as Server-Sent Events.
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CLOUD_TOOLS, HELPER_INFO, HELPER_ROLES, TOOL_INFO, type CloudAccess, type CloudAgentSummary, type CloudWorkspace, type HelperStat, type LlmState } from "@shared/cloud";
import { audit, getSession, hit, isAdminSession, requireAdmin, requireWallet, type Session } from "../../auth";
import { flag, setFlag } from "../../agents/flags";
import { pool } from "../../db";
import { agentBySlug, type HostedAgentRow } from "../agentsRepo";
import { getApproval, getRuntime, listActions, listApprovals, setRunning } from "../hostedStore";
import { loadPolicy } from "../policy";
import { llmGate } from "../runner";
import { CLOUD_FLAG, cloudEnv } from "./config";
import {
  addMemory,
  CHAT_ID,
  chatCount,
  countFiles,
  countMemories,
  createChat,
  deleteChat,
  deleteFile,
  deleteMemory,
  getChat,
  getSettings,
  listChats,
  listFiles,
  listMemories,
  listMessages,
  normFolder,
  readFile,
  releaseMessage,
  renameChat,
  reserveMessage,
  saveSettings,
  setPinned,
  usageDays,
  usedToday,
  WorkspaceError,
  writeFile,
} from "./store";
import { runTurn } from "./turn";

type Role = "owner" | "admin";
interface Ctx {
  agent: HostedAgentRow;
  session: Session;
  role: Role;
}

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: code, message });

let platformInvalidate: (() => void) | null = null;
/** server/platform registers its config-cache reset so a flag change shows up in /api/platform/config at once. */
export function onCloudFlagChange(fn: () => void): void {
  platformInvalidate = fn;
}

export async function cloudFlagOn(): Promise<boolean> {
  if (!pool) return false;
  return flag(CLOUD_FLAG).catch(() => false);
}

function llmState(): LlmState {
  const g = llmGate();
  return g === "ok" ? "ok" : g === "budget" ? "budget" : "offline";
}

async function accessFor(s: Session | null): Promise<CloudAccess> {
  const on = await cloudFlagOn();
  const admin = isAdminSession(s);
  return {
    flag: on,
    signedIn: !!s,
    admin,
    allowed: !!pool && (on || admin),
    llm: llmState(),
    dailyMessages: cloudEnv.dailyMessages(),
    usedToday: s ? await usedToday(s.wallet) : 0,
  };
}

function limited(res: Response, key: string, max: number): boolean {
  const s = res.locals.session as Session;
  if (hit(`cloud:${key}:${s.wallet}`, max, 60_000)) return false;
  res.set("Retry-After", "30");
  err(res, 429, "rate_limited", "Too many requests — slow down a little");
  return true;
}

/** Flag gate for every /api/cloud/agents route (after requireWallet). */
async function gate(_req: Request, res: Response, next: NextFunction) {
  if (!pool) return err(res, 503, "database_unavailable", "The Cloud workspace needs the database");
  const s = res.locals.session as Session;
  if (!isAdminSession(s) && !(await cloudFlagOn())) return err(res, 403, "cloud_closed", "The Cloud workspace isn't open yet");
  if (limited(res, "any", 240)) return;
  next();
}

async function resolve(req: Request, res: Response, write: boolean): Promise<Ctx | null> {
  const session = res.locals.session as Session;
  const agent = await agentBySlug(String(req.params.slug ?? ""));
  if (!agent) {
    err(res, 404, "not_found", "No such agent");
    return null;
  }
  const isOwner = !!agent.ownerWallet && agent.ownerWallet === session.wallet;
  const isAdmin = isAdminSession(session);
  if (!isOwner && !(isAdmin && !write)) {
    audit({ actor: session.wallet, action: "cloud.denied", target: agent.slug, severity: "warn", ip: req.ip, detail: { path: req.path, method: req.method } });
    err(res, 403, "not_owner", "Only this agent's owner can do that");
    return null;
  }
  if (agent.mode !== "hosted") {
    err(res, 409, "not_hosted", "Only agents hosted by Claudio have a Cloud workspace");
    return null;
  }
  return { agent, session, role: isOwner ? "owner" : "admin" };
}

/** Wraps a handler: resolves the agent (owner, or admin for reads) and maps WorkspaceError to JSON. */
function h(write: boolean, fn: (ctx: Ctx, req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const ctx = await resolve(req, res, write);
      if (!ctx) return;
      // An admin looking into someone else's workspace (chats are private) always leaves a trace.
      if (ctx.role === "admin") audit({ actor: ctx.session.wallet, action: "cloud.admin_read", target: ctx.agent.slug, severity: "warn", ip: req.ip, detail: { path: req.path } });
      res.set("Cache-Control", "no-store");
      await fn(ctx, req, res);
    } catch (e) {
      if (e instanceof WorkspaceError) return err(res, e.status, e.code, e.message);
      if (e instanceof z.ZodError) return err(res, 400, "bad_request", e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      console.error("[cloud]", (e as Error).message);
      if (!res.headersSent) err(res, 500, "internal", "Something went wrong");
    }
  };
}

function act(ctx: Ctx, req: Request, action: string, detail: Record<string, unknown> = {}, severity: "info" | "warn" = "info") {
  audit({ actor: ctx.session.wallet, action: `cloud.${action}`, target: ctx.agent.slug, ip: req.ip, severity, detail: { role: ctx.role, ...detail } });
}

async function agentSummaries(rows: { id: string; slug: string; name: string; avatar_url: string | null; bio: string | null; model: string | null; status: string }[]): Promise<CloudAgentSummary[]> {
  const ids = rows.map((r) => r.id);
  const [run, chats] = ids.length
    ? await Promise.all([
        pool!.query(`SELECT agent_id, running FROM agent_runtime WHERE agent_id = ANY($1::text[])`, [ids]),
        pool!.query(`SELECT agent_id, count(*)::int AS n, max(updated_at) AS last FROM chat_sessions WHERE agent_id = ANY($1::text[]) GROUP BY agent_id`, [ids]),
      ])
    : [{ rows: [] as any[] }, { rows: [] as any[] }];
  const running = new Map(run.rows.map((r) => [r.agent_id, !!r.running]));
  const counts = new Map(chats.rows.map((r) => [r.agent_id, { n: r.n as number, last: r.last ? new Date(r.last).toISOString() : null }]));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    avatarUrl: r.avatar_url ?? null,
    bio: r.bio ?? "",
    model: r.model ?? null,
    status: r.status,
    running: running.get(r.id) ?? false,
    chats: counts.get(r.id)?.n ?? 0,
    lastChatAt: counts.get(r.id)?.last ?? null,
  }));
}

async function agentRow(id: string) {
  const r = await pool!.query(`SELECT id, slug, name, avatar_url, bio, model, status FROM agents WHERE id = $1`, [id]).catch(() => null);
  return r?.rows[0] ?? null;
}

// ─── body schemas ────────────────────────────────────────────────────

const boolMap = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean().optional()])) as Record<K, z.ZodOptional<z.ZodBoolean>>).strict();
const settingsSchema = z.object({ skills: boolMap(CLOUD_TOOLS).optional(), helpers: boolMap(HELPER_ROLES).optional(), postApproval: z.boolean().optional() }).strict();
const messageSchema = z.object({ content: z.string().trim().min(1).max(4000) }).strict();
const chatCreateSchema = z.object({ title: z.string().max(80).optional() }).strict();
const chatPatchSchema = z.object({ title: z.string().min(1).max(80) }).strict();
const memoryCreateSchema = z.object({ content: z.string().trim().min(2).max(500), pinned: z.boolean().optional() }).strict();
const memoryPatchSchema = z.object({ pinned: z.boolean() }).strict();
const fileWriteSchema = z.object({ path: z.string().min(1).max(160), content: z.string().max(5 * 1024 * 1024) }).strict();
const goalsSchema = z.object({ goals: z.string().max(1000) }).strict();
const adminFlagSchema = z.object({ enabled: z.boolean() }).strict();

const turnsInFlight = new Set<string>();
const turnsByWallet = new Map<string, number>();

export function registerWorkspaceRoutes(app: Express): void {
  // ── access (public: tells the client whether to show the workspace or the coming-soon page) ──
  app.get("/api/cloud/access", async (req, res) => {
    res.set("Cache-Control", "no-store").json(await accessFor(await getSession(req)));
  });

  const base = "/api/cloud/agents";
  app.use(base, requireWallet, gate);

  // ── my hosted agents ──
  app.get(base, async (_req, res) => {
    const s = res.locals.session as Session;
    const r = await pool!
      .query(`SELECT id, slug, name, avatar_url, bio, model, status FROM agents WHERE owner_wallet = $1 AND mode = 'hosted' ORDER BY created_at DESC LIMIT 50`, [s.wallet])
      .catch(() => ({ rows: [] as any[] }));
    res.set("Cache-Control", "no-store").json({ agents: await agentSummaries(r.rows), access: await accessFor(s) });
  });

  // ── workspace summary ──
  app.get(
    `${base}/:slug`,
    h(false, async (ctx, _req, res) => {
      const row = await agentRow(ctx.agent.id);
      const [summary] = await agentSummaries(row ? [row] : []);
      const [settings, access, chats, memories, files, approvals, pol] = await Promise.all([
        getSettings(ctx.agent.id),
        accessFor(ctx.session),
        chatCount(ctx.agent.id),
        countMemories(ctx.agent.id),
        countFiles(ctx.agent.id),
        listApprovals(ctx.agent.id, 50),
        loadPolicy(ctx.agent.id),
      ]);
      const body: CloudWorkspace = {
        agent: summary,
        role: ctx.role,
        settings,
        access,
        counts: { chats: chats.chats, memories, files, pendingApprovals: approvals.filter((a) => a.status === "pending" && Date.parse(a.expiresAt) > Date.now()).length },
        policy: { paper: true, canTrade: pol.policy.canTrade, maxSolPerTrade: pol.policy.maxSolPerTrade, askOwnerAboveSol: pol.policy.askOwnerAboveSol, killed: pol.policy.killed || pol.adminKilled },
      };
      res.json(body);
    }),
  );

  // ── chats ──
  app.get(
    `${base}/:slug/chats`,
    h(false, async (ctx, _req, res) => res.json({ chats: await listChats(ctx.agent.id) })),
  );

  app.post(
    `${base}/:slug/chats`,
    h(true, async (ctx, req, res) => {
      if (limited(res, "chat_new", 20)) return;
      const b = chatCreateSchema.parse(req.body ?? {});
      const chat = await createChat(ctx.agent.id, ctx.session.wallet, b.title);
      act(ctx, req, "chat_create", { chat: chat.id });
      res.status(201).json({ chat });
    }),
  );

  app.get(
    `${base}/:slug/chats/:id`,
    h(false, async (ctx, req, res) => {
      const chat = await getChat(ctx.agent.id, String(req.params.id));
      if (!chat) return err(res, 404, "not_found", "No such chat");
      const messages = await listMessages(chat.id, 300);
      const ids = [...new Set(messages.map((m) => m.meta?.approvalId).filter((x): x is string => typeof x === "string"))];
      const approvals: Record<string, string> = {};
      for (const id of ids.slice(0, 50)) {
        const a = await getApproval(ctx.agent.id, id);
        if (a) approvals[id] = a.status === "pending" && Date.parse(a.expiresAt) <= Date.now() ? "expired" : a.status;
      }
      res.json({ session: chat, messages, approvals });
    }),
  );

  app.patch(
    `${base}/:slug/chats/:id`,
    h(true, async (ctx, req, res) => {
      const b = chatPatchSchema.parse(req.body ?? {});
      const chat = await renameChat(ctx.agent.id, String(req.params.id), b.title);
      if (!chat) return err(res, 404, "not_found", "No such chat");
      act(ctx, req, "chat_rename", { chat: chat.id });
      res.json({ chat });
    }),
  );

  app.delete(
    `${base}/:slug/chats/:id`,
    h(true, async (ctx, req, res) => {
      const id = String(req.params.id);
      if (!(await deleteChat(ctx.agent.id, id))) return err(res, 404, "not_found", "No such chat");
      act(ctx, req, "chat_delete", { chat: id });
      res.json({ ok: true });
    }),
  );

  // ── send a message: the reply streams back as Server-Sent Events ──
  app.post(
    `${base}/:slug/chats/:id/messages`,
    h(true, async (ctx, req, res) => {
      if (limited(res, "message", cloudEnv.messagesPerMin())) return;
      const id = String(req.params.id);
      if (!CHAT_ID.test(id)) return err(res, 404, "not_found", "No such chat");
      const body = messageSchema.safeParse(req.body ?? {});
      if (!body.success) return err(res, 400, "bad_message", "Write a message (up to 4000 characters)");
      const chat = await getChat(ctx.agent.id, id);
      if (!chat) return err(res, 404, "not_found", "No such chat");
      if (ctx.agent.status !== "active") return err(res, 409, "agent_inactive", `This agent is ${ctx.agent.status}`);
      const { policy, adminKilled } = await loadPolicy(ctx.agent.id);
      if (adminKilled) return err(res, 409, "admin_killed", "An admin paused this agent");
      if (policy.killed) return err(res, 409, "killed", "This agent's kill switch is on");
      const state = llmState();
      if (state === "offline") return err(res, 503, "llm_offline", "The agent is offline right now. Try again later.");
      if (state === "budget") return err(res, 503, "llm_budget", "The agent has used today's thinking time. It'll be back tomorrow (UTC).");
      if (turnsInFlight.has(chat.id)) return err(res, 409, "busy", "The agent is still answering your last message");
      if ((turnsByWallet.get(ctx.session.wallet) ?? 0) >= 2) return err(res, 409, "busy", "Two replies are already on their way — wait for one to finish");
      const cap = await reserveMessage(ctx.agent.id, ctx.session.wallet);
      if (!cap.ok) {
        res.set("Retry-After", "3600");
        return err(res, 429, "daily_cap", `You've sent today's ${cap.cap} messages. More tomorrow (UTC).`);
      }

      turnsInFlight.add(chat.id);
      turnsByWallet.set(ctx.session.wallet, (turnsByWallet.get(ctx.session.wallet) ?? 0) + 1);
      act(ctx, req, "chat_message", { chat: chat.id, chars: body.data.content.length });

      res.status(200);
      res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders?.();
      let open = true;
      res.on("close", () => (open = false));
      const send = (e: unknown) => {
        if (!open) return;
        const type = (e as { type: string }).type;
        res.write(`event: ${type}\ndata: ${JSON.stringify(e)}\n\n`);
      };
      const ping = setInterval(() => open && res.write(": ping\n\n"), 15_000);
      try {
        const settings = await getSettings(ctx.agent.id);
        const r = await runTurn({ agent: ctx.agent, wallet: ctx.session.wallet, chatId: chat.id, content: body.data.content, settings, emit: send });
        if (!r.ok && r.calls === 0) await releaseMessage(ctx.agent.id, ctx.session.wallet); // never reached a model: don't count it
        if (r.error) send({ type: "error", code: r.error.code, message: r.error.message });
        send({ type: "done", usedToday: await usedToday(ctx.session.wallet), dailyMessages: cap.cap });
      } catch (e) {
        console.error("[cloud] turn crashed:", (e as Error).message);
        send({ type: "error", code: "turn_failed", message: "The agent couldn't finish that reply. Try again." });
      } finally {
        clearInterval(ping);
        turnsInFlight.delete(chat.id);
        const n = (turnsByWallet.get(ctx.session.wallet) ?? 1) - 1;
        if (n > 0) turnsByWallet.set(ctx.session.wallet, n);
        else turnsByWallet.delete(ctx.session.wallet);
        if (open) res.end();
      }
    }),
  );

  // ── goals (what the agent works on; shared with the scheduled runner) ──
  app.put(
    `${base}/:slug/goals`,
    h(true, async (ctx, req, res) => {
      if (limited(res, "goals", 20)) return;
      const b = goalsSchema.parse(req.body ?? {});
      const cur = await getRuntime(ctx.agent.id);
      const run = await setRunning(ctx.agent.id, cur.running, ctx.session.wallet, b.goals.trim());
      act(ctx, req, "goals_update", { chars: b.goals.length });
      res.json({ goals: run.goals });
    }),
  );

  // ── skills + helpers switches ──
  app.get(
    `${base}/:slug/skills`,
    h(false, async (ctx, _req, res) => {
      const settings = await getSettings(ctx.agent.id);
      res.json({
        skills: CLOUD_TOOLS.map((t) => ({ name: t, ...TOOL_INFO[t], enabled: settings.skills[t] })),
        postApproval: settings.postApproval,
        updatedAt: settings.updatedAt,
      });
    }),
  );

  app.put(
    `${base}/:slug/settings`,
    h(true, async (ctx, req, res) => {
      if (limited(res, "settings", 30)) return;
      const b = settingsSchema.parse(req.body ?? {});
      const settings = await saveSettings(ctx.agent.id, b, ctx.session.wallet);
      act(ctx, req, "settings_update", { patch: b }, b.postApproval === false ? "warn" : "info");
      res.json({ settings });
    }),
  );

  app.get(
    `${base}/:slug/helpers`,
    h(false, async (ctx, _req, res) => {
      const settings = await getSettings(ctx.agent.id);
      const r = await pool!.query(
        `SELECT DISTINCT ON (helper) helper, content, created_at, count(*) OVER (PARTITION BY helper)::int AS uses
         FROM chat_messages WHERE agent_id = $1 AND role = 'helper' ORDER BY helper, id DESC`,
        [ctx.agent.id],
      );
      const by = new Map(r.rows.map((x) => [x.helper, x]));
      const helpers: (HelperStat & { label: string; body: string; tools: string[] })[] = HELPER_ROLES.map((role) => {
        const x = by.get(role);
        return {
          role,
          ...HELPER_INFO[role],
          tools: HELPER_INFO[role].tools.map((t) => TOOL_INFO[t].label),
          enabled: settings.helpers[role],
          uses: x?.uses ?? 0,
          lastAt: x ? new Date(x.created_at).toISOString() : null,
          lastAnswer: x ? String(x.content).slice(0, 400) : null,
        };
      });
      res.json({ helpers });
    }),
  );

  // ── memory ──
  app.get(
    `${base}/:slug/memory`,
    h(false, async (ctx, req, res) => {
      const query = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
      const [items, run] = await Promise.all([listMemories(ctx.agent.id, query), getRuntime(ctx.agent.id)]);
      res.json({ summary: run.memory, items, max: cloudEnv.maxMemories() });
    }),
  );

  app.post(
    `${base}/:slug/memory`,
    h(true, async (ctx, req, res) => {
      if (limited(res, "memory", 30)) return;
      const b = memoryCreateSchema.parse(req.body ?? {});
      const item = await addMemory(ctx.agent.id, "owner", b.content, { pinned: b.pinned, source: "owner" });
      act(ctx, req, "memory_add", { id: item.id, pinned: item.pinned });
      res.status(201).json({ item });
    }),
  );

  app.patch(
    `${base}/:slug/memory/:id`,
    h(true, async (ctx, req, res) => {
      const b = memoryPatchSchema.parse(req.body ?? {});
      const item = await setPinned(ctx.agent.id, String(req.params.id), b.pinned);
      if (!item) return err(res, 404, "not_found", "No such memory");
      act(ctx, req, b.pinned ? "memory_pin" : "memory_unpin", { id: item.id });
      res.json({ item });
    }),
  );

  app.delete(
    `${base}/:slug/memory/summary`,
    h(true, async (ctx, req, res) => {
      await pool!.query(`UPDATE agent_runtime SET memory = '', updated_at = now() WHERE agent_id = $1`, [ctx.agent.id]);
      act(ctx, req, "memory_clear_summary");
      res.json({ ok: true });
    }),
  );

  app.delete(
    `${base}/:slug/memory/:id`,
    h(true, async (ctx, req, res) => {
      const id = String(req.params.id);
      if (!(await deleteMemory(ctx.agent.id, id))) return err(res, 404, "not_found", "No such memory");
      act(ctx, req, "memory_delete", { id });
      res.json({ ok: true });
    }),
  );

  // ── files (JSON only — file contents are never served as a page) ──
  app.get(
    `${base}/:slug/files`,
    h(false, async (ctx, req, res) => {
      const folder = normFolder(req.query.folder);
      if (!folder) return err(res, 400, "bad_path", "Bad folder");
      res.json(await listFiles(ctx.agent.id, folder));
    }),
  );

  app.get(
    `${base}/:slug/files/content`,
    h(false, async (ctx, req, res) => {
      const f = await readFile(ctx.agent.id, String(req.query.path ?? ""));
      if (!f) return err(res, 404, "not_found", "No such file");
      res.set("X-Content-Type-Options", "nosniff").set("Content-Disposition", "attachment").json({ file: f });
    }),
  );

  app.put(
    `${base}/:slug/files`,
    h(true, async (ctx, req, res) => {
      if (limited(res, "files", 30)) return;
      const b = fileWriteSchema.parse(req.body ?? {});
      const file = await writeFile(ctx.agent.id, b.path, b.content, ctx.session.wallet);
      act(ctx, req, "file_write", { path: file.path, size: file.size });
      res.json({ file });
    }),
  );

  app.delete(
    `${base}/:slug/files`,
    h(true, async (ctx, req, res) => {
      const path = String(req.query.path ?? "");
      if (!(await deleteFile(ctx.agent.id, path))) return err(res, 404, "not_found", "No such file");
      act(ctx, req, "file_delete", { path });
      res.json({ ok: true });
    }),
  );

  // ── activity + usage ──
  app.get(
    `${base}/:slug/activity`,
    h(false, async (ctx, req, res) => {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
      const [actions, approvals] = await Promise.all([listActions(ctx.agent.id, limit), listApprovals(ctx.agent.id, 30)]);
      res.json({
        items: actions
          // "decision" rows are budget bookkeeping; a tool row that queued an approval duplicates the approval row.
          .filter((a) => a.kind !== "decision" && !(a.kind === "tool" && a.detail?.approvalId))
          .map((a) => ({
            id: String(a.id),
            kind: a.kind,
            ok: a.ok,
            text: a.kind === "invalid_decision" ? "A scheduled run didn't produce a usable decision, so it did nothing." : (a.summary ?? a.kind.replace(/_/g, " ")),
            model: a.model ?? null,
            at: a.at,
          })),
        approvals,
      });
    }),
  );

  app.get(
    `${base}/:slug/usage`,
    h(false, async (ctx, req, res) => {
      const days = Math.max(1, Math.min(60, Number(req.query.days) || 14));
      res.json({ days: await usageDays(ctx.agent.id, days), dailyMessages: cloudEnv.dailyMessages(), usedToday: await usedToday(ctx.session.wallet) });
    }),
  );

  // ── admin: the platform switch ──
  app.get("/api/admin/cloud", requireAdmin, async (_req, res) => {
    let updatedBy: string | null = null;
    let updatedAt: string | null = null;
    if (pool) {
      const r = await pool.query(`SELECT updated_by, updated_at FROM feature_flags WHERE key = $1`, [CLOUD_FLAG]).catch(() => null);
      updatedBy = r?.rows[0]?.updated_by ?? null;
      updatedAt = r?.rows[0]?.updated_at ? new Date(r.rows[0].updated_at).toISOString() : null;
    }
    res.set("Cache-Control", "no-store").json({ enabled: await cloudFlagOn(), updatedBy, updatedAt, llm: llmState(), dailyMessages: cloudEnv.dailyMessages() });
  });

  app.put("/api/admin/cloud", requireAdmin, async (req, res) => {
    const b = adminFlagSchema.safeParse(req.body ?? {});
    if (!b.success) return err(res, 400, "bad_request", "{ enabled: boolean } required");
    if (!pool) return err(res, 503, "database_unavailable", "Needs the database");
    const s = res.locals.session as Session;
    await setFlag(CLOUD_FLAG, b.data.enabled, s.wallet);
    audit({ actor: s.wallet, action: b.data.enabled ? "cloud.workspace_on" : "cloud.workspace_off", severity: "warn", ip: req.ip });
    platformInvalidate?.();
    res.json({ enabled: await cloudFlagOn() });
  });
}
