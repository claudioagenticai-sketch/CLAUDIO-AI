// Hosted-agent HTTP API (docs/API.md → "Hosted agents"). Owner = signed-in wallet equal to agents.owner_wallet.
// Admins (requireAdmin semantics) may read everything and stop/kill agents, but never approve trades for an owner.
// Every mutation is audited. No endpoint returns or accepts key material; there is no export or withdrawal.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { AgentLogs, AgentPolicyView, AgentWalletInfo, HostedAdminOverview } from "@shared/agents";
import { POLICY_LIMITS } from "@shared/agents";
import { audit, hit, isAdminSession, requireAdmin, requireWallet, type Session } from "../auth";
import { pool } from "../db";
import { agentBySlug, agentsByIds, escrowEligible, type HostedAgentRow } from "./agentsRepo";
import { hostedEnv } from "./config";
import { decideApproval, getApproval, getRuntime, globalKill, listActions, listApprovals, logAction, setGlobalKill, setRunning } from "./hostedStore";
import { balanceOf, earnedByAgent, ledgerOf, pollLedgers } from "./ledger";
import { paperBook } from "./paper";
import { loadPolicy, policyPatchSchema, savePolicy, spentToday, validatePolicy } from "./policy";
import { verifyWalletKey } from "./signer";
import { executeTrade } from "./trading";
import { currentKeyVersion, ensureEscrow, previousKeyVersion, rewrapAll, vaultState } from "./vault";
import { hostedStatus } from "./status";
import { executeApprovedPost } from "./workspace/tools";

type Role = "owner" | "admin";
interface Ctx {
  agent: HostedAgentRow;
  session: Session;
  role: Role;
}

const err = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: code, message });

/**
 * Resolves :slug and the caller's role. `allowAdmin` lets an admin act on agents they don't own.
 * `hostedOnly` (default) refuses non-hosted agents except Claudio's own escrow view.
 */
async function resolve(req: Request, res: Response, opts: { allowAdmin: boolean; allowClaudio?: boolean }): Promise<Ctx | null> {
  if (!pool) {
    err(res, 503, "database_unavailable", "Hosted agents need the database");
    return null;
  }
  const session = res.locals.session as Session;
  const agent = await agentBySlug(String(req.params.slug ?? ""));
  if (!agent) {
    err(res, 404, "not_found", "No such agent");
    return null;
  }
  const isOwner = !!agent.ownerWallet && agent.ownerWallet === session.wallet;
  const isAdmin = isAdminSession(session);
  if (!isOwner && !(opts.allowAdmin && isAdmin)) {
    audit({ actor: session.wallet, action: "hosted.denied", target: agent.slug, severity: "warn", ip: req.ip, detail: { path: req.path } });
    err(res, 403, "not_owner", "Only this agent's owner can do that");
    return null;
  }
  const okMode = agent.mode === "hosted" || (opts.allowClaudio && escrowEligible(agent));
  if (!okMode) {
    err(res, 409, "not_hosted", "This agent is not hosted by Claudio");
    return null;
  }
  return { agent, session, role: isOwner ? "owner" : "admin" };
}

function limited(req: Request, res: Response, key: string, max = 60): boolean {
  const s = res.locals.session as Session;
  if (hit(`hosted:${key}:${s.wallet}`, max, 60_000)) return false;
  err(res, 429, "rate_limited", "Too many requests");
  return true;
}

async function policyView(agentId: string): Promise<AgentPolicyView> {
  const { policy, adminKilled } = await loadPolicy(agentId);
  return { policy, adminKilled, liveTradingEnabled: hostedEnv.liveTrading(), effectivePaper: policy.paper || !hostedEnv.liveTrading(), limits: POLICY_LIMITS };
}

const runSchema = z.object({ action: z.enum(["start", "stop"]), goals: z.string().max(1000).optional() }).strict();
const approvalSchema = z.object({ approve: z.boolean() }).strict();
const adminPutSchema = z.object({ killed: z.boolean(), reason: z.string().max(300).optional() }).strict();

export function registerRoutes(app: Express): void {
  // ── wallet ──────────────────────────────────────────────────────────
  app.get("/api/agents/:slug/wallet", requireWallet, async (req, res) => {
    if (limited(req, res, "wallet")) return;
    const ctx = await resolve(req, res, { allowAdmin: true, allowClaudio: true });
    if (!ctx) return;
    try {
      const address = await ensureEscrow(ctx.agent.id);
      if (!address) return err(res, 503, "vault_unavailable", `Escrow wallets are unavailable (${vaultState()})`);
      const [bal, led, book, spent, pol] = await Promise.all([
        balanceOf(address),
        ledgerOf(ctx.agent.id, 50),
        paperBook(ctx.agent.id),
        spentToday(ctx.agent.id),
        loadPolicy(ctx.agent.id),
      ]);
      const body: AgentWalletInfo = {
        address,
        balanceSol: bal.sol,
        balanceAt: bal.at,
        earnedSol: led.earnedSol,
        totalInSol: led.totalInSol,
        ledger: led.entries,
        paper: { positions: book.positions, realizedPnlSol: book.realizedPnlSol, spentTodaySol: spent, trades: book.trades },
        liveTrading: hostedEnv.liveTrading() && !pol.policy.paper,
        withdrawals: "unavailable",
      };
      res.set("Cache-Control", "no-store").json(body);
    } catch (e) {
      err(res, 500, "internal", (e as Error).message);
    }
  });

  // ── policy ──────────────────────────────────────────────────────────
  app.get("/api/agents/:slug/policy", requireWallet, async (req, res) => {
    const ctx = await resolve(req, res, { allowAdmin: true });
    if (!ctx) return;
    res.set("Cache-Control", "no-store").json(await policyView(ctx.agent.id));
  });

  app.put("/api/agents/:slug/policy", requireWallet, async (req, res) => {
    if (limited(req, res, "policy", 20)) return;
    const ctx = await resolve(req, res, { allowAdmin: true });
    if (!ctx) return;
    const patch = policyPatchSchema.safeParse(req.body ?? {});
    if (!patch.success) return err(res, 400, "bad_policy", patch.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const cur = await loadPolicy(ctx.agent.id);
    const next = { ...cur.policy, ...patch.data };
    const invalid = validatePolicy(next);
    if (invalid) return err(res, 400, "bad_policy", invalid);
    // Admins set/clear the admin kill; an owner's `killed` only toggles their own switch.
    const adminKilled = ctx.role === "admin" && patch.data.killed !== undefined ? patch.data.killed : undefined;
    if (ctx.role === "admin" && patch.data.killed !== undefined) next.killed = cur.policy.killed; // admin kill is separate
    await savePolicy(ctx.agent.id, next, ctx.session.wallet, adminKilled);
    audit({ actor: ctx.session.wallet, action: "hosted.policy_update", target: ctx.agent.slug, ip: req.ip, severity: patch.data.paper === false ? "high" : "info", detail: { role: ctx.role, patch: patch.data } });
    await logAction(ctx.agent.id, "control", { summary: `Policy updated by ${ctx.role}`, detail: { patch: patch.data } });
    res.json(await policyView(ctx.agent.id));
  });

  // ── run start/stop ──────────────────────────────────────────────────
  app.post("/api/agents/:slug/run", requireWallet, async (req, res) => {
    if (limited(req, res, "run", 20)) return;
    const ctx = await resolve(req, res, { allowAdmin: true });
    if (!ctx) return;
    const body = runSchema.safeParse(req.body ?? {});
    if (!body.success) return err(res, 400, "bad_request", '{ action: "start" | "stop", goals? } required');
    if (body.data.action === "start") {
      if (ctx.role !== "owner") return err(res, 403, "not_owner", "Only the owner can start an agent");
      if (ctx.agent.status !== "active") return err(res, 409, "agent_inactive", `Agent is ${ctx.agent.status}`);
      const { policy, adminKilled } = await loadPolicy(ctx.agent.id);
      if (adminKilled) return err(res, 409, "admin_killed", "An admin stopped this agent");
      if (policy.killed) return err(res, 409, "killed", "Turn the agent's kill switch off first");
      if ((await globalKill()).killed) return err(res, 409, "killed_global", "Hosted agents are paused platform-wide");
      void ensureEscrow(ctx.agent.id);
    }
    const run = await setRunning(ctx.agent.id, body.data.action === "start", ctx.session.wallet, body.data.goals);
    audit({ actor: ctx.session.wallet, action: `hosted.run_${body.data.action}`, target: ctx.agent.slug, ip: req.ip, detail: { role: ctx.role } });
    await logAction(ctx.agent.id, "control", { summary: `${body.data.action === "start" ? "Started" : "Stopped"} by ${ctx.role}` });
    const { memory: _m, agentId: _a, ...pub } = run;
    res.json({ run: pub });
  });

  // ── logs ────────────────────────────────────────────────────────────
  app.get("/api/agents/:slug/logs", requireWallet, async (req, res) => {
    const ctx = await resolve(req, res, { allowAdmin: true });
    if (!ctx) return;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    const [run, actions, approvals] = await Promise.all([getRuntime(ctx.agent.id), listActions(ctx.agent.id, limit), listApprovals(ctx.agent.id, 50)]);
    const { memory: _m, agentId: _a, ...pub } = run;
    const body: AgentLogs = { run: pub, actions, approvals };
    res.set("Cache-Control", "no-store").json(body);
  });

  // ── approvals ───────────────────────────────────────────────────────
  app.post("/api/agents/:slug/approvals/:id", requireWallet, async (req, res) => {
    if (limited(req, res, "approve", 30)) return;
    const ctx = await resolve(req, res, { allowAdmin: false });
    if (!ctx) return;
    const body = approvalSchema.safeParse(req.body ?? {});
    if (!body.success) return err(res, 400, "bad_request", "{ approve: boolean } required");
    const existing = await getApproval(ctx.agent.id, String(req.params.id));
    if (!existing) return err(res, 404, "not_found", "No such approval");
    const decided = await decideApproval(ctx.agent.id, existing.id, body.data.approve, ctx.session.wallet);
    if (!decided) return err(res, 409, "not_pending", `Approval is ${existing.status}`);
    audit({ actor: ctx.session.wallet, action: body.data.approve ? "hosted.approval_approve" : "hosted.approval_reject", target: ctx.agent.slug, ip: req.ip, detail: { id: decided.id, intent: decided.intent } });
    const isPost = decided.kind === "thread_post";
    if (!body.data.approve) {
      await logAction(ctx.agent.id, "approval", { summary: `Owner rejected a ${isPost ? "post" : "trade"}`, detail: { id: decided.id } });
      return res.json({ approval: decided });
    }
    if (isPost) {
      const outcome = await executeApprovedPost(ctx.agent.id, decided);
      return res.json({ approval: await getApproval(ctx.agent.id, decided.id), outcome });
    }
    // Trades the Cloud chat asked for stay paper even when live trading is on (the chat tool never signs).
    const fromChat = (decided.reason ?? "").startsWith("Chat: ");
    const outcome = await executeTrade(ctx.agent.id, decided.intent, { source: "approval", approvalId: decided.id, reason: "owner approved", paperOnly: fromChat });
    res.json({ approval: await getApproval(ctx.agent.id, decided.id), outcome });
  });

  // ── admin ───────────────────────────────────────────────────────────
  app.get("/api/admin/hosted", requireAdmin, async (req, res) => {
    if (!pool) return err(res, 503, "database_unavailable", "Hosted agents need the database");
    const [kill, status, earned] = await Promise.all([globalKill(), hostedStatus(), earnedByAgent()]);
    const rows = (
      await pool.query(
        `SELECT w.agent_id, w.address, w.key_version, w.balance_lamports, w.created_at, COALESCE(r.running, false) AS running
         FROM agent_wallets w LEFT JOIN agent_runtime r ON r.agent_id = w.agent_id ORDER BY w.created_at DESC LIMIT 500`,
      )
    ).rows;
    const agents = await agentsByIds(rows.map((r) => r.agent_id));
    const cur = currentKeyVersion();
    const fresh = req.query.refresh === "1";
    const wallets = await Promise.all(
      rows.map(async (r) => {
        const bal = fresh ? (await balanceOf(r.address)).sol : r.balance_lamports != null ? Number(r.balance_lamports) / 1e9 : null;
        const a = agents.get(r.agent_id);
        return {
          agentId: r.agent_id,
          slug: a?.slug ?? null,
          name: a?.name ?? null,
          address: r.address,
          balanceSol: bal,
          earnedSol: earned.get(r.agent_id) ?? 0,
          keyVersion: r.key_version,
          needsRewrap: !!cur && r.key_version !== cur,
          running: !!r.running,
          createdAt: new Date(r.created_at).toISOString(),
        };
      }),
    );
    const body: HostedAdminOverview = {
      ...status,
      kill,
      wallets,
      totals: {
        wallets: wallets.length,
        balanceSol: wallets.reduce((s, w) => s + (w.balanceSol ?? 0), 0),
        earnedSol: wallets.reduce((s, w) => s + w.earnedSol, 0),
      },
    };
    res.set("Cache-Control", "no-store").json({ ...body, keyVersions: { current: cur, previous: previousKeyVersion() } });
  });

  app.put("/api/admin/hosted", requireAdmin, async (req, res) => {
    const body = adminPutSchema.safeParse(req.body ?? {});
    if (!body.success) return err(res, 400, "bad_request", "{ killed: boolean, reason? } required");
    const s = res.locals.session as Session;
    try {
      const kill = await setGlobalKill(body.data.killed, s.wallet, body.data.reason);
      audit({ actor: s.wallet, action: body.data.killed ? "hosted.kill_on" : "hosted.kill_off", severity: "high", ip: req.ip, detail: { reason: body.data.reason } });
      res.json({ kill });
    } catch (e) {
      err(res, 503, "database_unavailable", (e as Error).message);
    }
  });

  app.post("/api/admin/hosted/rewrap", requireAdmin, async (req, res) => {
    const s = res.locals.session as Session;
    if (vaultState() !== "ready") return err(res, 503, "vault_unavailable", vaultState());
    res.json(await rewrapAll(s.wallet));
  });

  app.post("/api/admin/hosted/verify/:slug", requireAdmin, async (req, res) => {
    const a = await agentBySlug(String(req.params.slug ?? ""));
    if (!a) return err(res, 404, "not_found", "No such agent");
    const r = await verifyWalletKey(a.id);
    audit({ actor: (res.locals.session as Session).wallet, action: "hosted.vault_verify", target: a.slug, ip: req.ip, detail: r });
    res.json(r);
  });

  app.post("/api/admin/hosted/poll", requireAdmin, async (_req, res) => {
    res.json(await pollLedgers());
  });
}
