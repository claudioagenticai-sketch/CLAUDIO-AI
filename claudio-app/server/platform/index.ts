// Platform module (owner: platform workstream): chain/launchpad switches, spl_config, the public platform config,
// admin endpoints, the Solana fee collector and the launch reconciler.
//
//   GET  /api/platform/config        public  PlatformConfig (cached 15 s; comingSoon is per visitor)
//   GET  /api/collector/status       public  CollectorStatus (no secrets)
//   GET  /api/admin/overview         admin   AdminOverview
//   GET  /api/admin/chains           admin   { chains }      PUT { chain, state, note }
//   GET  /api/admin/launchpads       admin   { launchpads }  PUT { launchpad, chain, state, allowAgents, note }
//   GET  /api/admin/spl-config       admin   { token, updatedBy, updatedAt }  PUT { mint, symbol, name, decimals }
//   GET  /api/admin/collector        admin   AdminCollectorDetail
//   POST /api/admin/collector/run    admin   { dryRun? } → { run }
//   GET  /api/admin/audit            admin   ?action=&limit= → { events }
// Every admin change is written to audit_events.
import type { Express, Request, Response } from "express";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { CHAIN_ORDER, CHAINS, NETWORK, type ChainId } from "@shared/chains";
import { LAUNCHPADS, LAUNCHPAD_ORDER, type LaunchpadId } from "@shared/launchpads";
import {
  DEFAULT_CHAIN,
  DEFAULT_LAUNCHPAD,
  PLATFORM_FEE_WALLET_SOL,
  PLATFORM_SPLIT,
  type AdminAuditEvent,
  type AdminCollectorDetail,
  type AdminOverview,
  type PlatformConfig,
} from "@shared/platform";
import { pool } from "../db";
import { closedFor } from "../access";
import { adminLoginConfigured, audit, requireAdmin, type Session } from "../auth";
import { recentAudit } from "../auth/audit";
import { migrate } from "../migrate";
import { cloudFlagOn, hostedStatus, onCloudFlagChange } from "../hosted";
import { isSolAddress, launchEnv } from "../launch/env";
import { startLaunchReconciler } from "../launch/reconcile";
import { solConnection } from "../launch/sol";
import { launchStore } from "../launch/store";
import { CHAIN_STATES, LAUNCHPAD_STATES, chainRows, deploymentPairs, launchpadRows, setChainState, setLaunchpadState } from "./switches";
import { getSplConfig, setSplConfig } from "./spl";
import { treasuryEnvConflict } from "./treasury";
import { collectorStatus, loadCollectorKey, recentPayouts, recentRuns, runCollector, startCollectorBot } from "./collector";

export { assertLaunchOpen } from "./switches";
export { platformRecipientSol, treasuryEnvConflict } from "./treasury";
export { payoutsForToken } from "./collector";

// ─── Feature flags (honest: backed by the secret / table actually being there) ──

async function tableExists(...names: string[]): Promise<boolean> {
  if (!pool) return false;
  try {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) LIMIT 1`, [names]);
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function hostedAvailable(): Promise<boolean> {
  try {
    return (await hostedStatus()).available;
  } catch {
    return false;
  }
}

async function features(): Promise<PlatformConfig["features"]> {
  const dbOk = !!pool && (await migrate().then(() => true).catch(() => false));
  const [agents, thread] = dbOk ? await Promise.all([tableExists("agents"), tableExists("thread_messages", "messages", "thread_rooms", "rooms")]) : [false, false];
  return {
    database: dbOk,
    agents,
    thread,
    hostedAgents: dbOk && (await hostedAvailable()),
    cloudWorkspace: dbOk && (await cloudFlagOn()),
    collector: !!loadCollectorKey().kp,
    adminLogin: adminLoginConfigured(),
  };
}

let configCache: { at: number; v: Omit<PlatformConfig, "comingSoon"> } | null = null;

export function invalidatePlatformConfig(): void {
  configCache = null;
}
onCloudFlagChange(invalidatePlatformConfig);

export async function platformConfig(closed: boolean): Promise<PlatformConfig> {
  if (!configCache || Date.now() - configCache.at > 15_000) {
    const [chains, pads, spl, feats] = await Promise.all([chainRows(), launchpadRows(), getSplConfig(), features()]);
    configCache = {
      at: Date.now(),
      v: {
        network: NETWORK,
        defaultChain: DEFAULT_CHAIN,
        defaultLaunchpad: DEFAULT_LAUNCHPAD,
        chains: chains.map((c) => ({ chain: c.chain, state: c.effective, note: c.note })),
        launchpads: pads.map((l) => ({ launchpad: l.launchpad, chain: l.chain, state: l.state, effective: l.effective, allowAgents: l.allowAgents, note: l.note })),
        token: spl.token,
        feeWalletSol: PLATFORM_FEE_WALLET_SOL,
        split: PLATFORM_SPLIT,
        features: feats,
      },
    };
  }
  return { comingSoon: closed, ...configCache.v };
}

// ─── Admin helpers ──────────────────────────────────────────────────

function sendErr(res: Response, e: unknown) {
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return res.status(400).json({ error: "invalid_request", message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request" });
  }
  const err = e as { status?: number; code?: string; message?: string };
  if (err?.status && err.code) return res.status(err.status).json({ error: err.code, message: err.message });
  console.error("[platform]", e);
  return res.status(500).json({ error: "internal", message: err?.message ?? "Internal error" });
}

const actorOf = (res: Response) => (res.locals.session as Session | undefined)?.wallet ?? "admin";

async function auditEvents(action: string | undefined, limit: number): Promise<AdminAuditEvent[]> {
  if (pool) {
    try {
      const r = action
        ? await pool.query(`SELECT * FROM audit_events WHERE action ILIKE $1 ORDER BY id DESC LIMIT $2`, [`%${action}%`, limit])
        : await pool.query(`SELECT * FROM audit_events ORDER BY id DESC LIMIT $1`, [limit]);
      return r.rows.map((e: any) => ({
        id: e.id,
        actor: e.actor,
        action: e.action,
        target: e.target,
        severity: e.severity,
        detail: e.detail ?? {},
        ip: e.ip,
        at: new Date(e.created_at).toISOString(),
      }));
    } catch {
      /* memory */
    }
  }
  return recentAudit(500)
    .filter((e) => !action || e.action.toLowerCase().includes(action.toLowerCase()))
    .slice(0, limit)
    .map((e) => ({ actor: e.actor ?? null, action: e.action, target: e.target ?? null, severity: e.severity ?? "info", detail: e.detail ?? {}, ip: e.ip ?? null, at: new Date(e.at).toISOString() }));
}

async function launchCounts(): Promise<AdminOverview["counts"]> {
  if (pool) {
    try {
      const r = await pool.query(`SELECT
          count(*)::int AS launches,
          count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
          count(*) FILTER (WHERE status = 'submitted')::int AS submitted,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'unverified')::int AS unverified,
          count(*) FILTER (WHERE launched_by = 'agent')::int AS by_agents,
          count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h
        FROM launches WHERE status <> 'prepared'`);
      const x = r.rows[0];
      return { launches: x.launches, confirmed: x.confirmed, submitted: x.submitted, failed: x.failed, unverified: x.unverified, byAgents: x.by_agents, last24h: x.last24h };
    } catch {
      /* memory */
    }
  }
  const all = await launchStore.byStatus(["submitted", "confirmed", "failed", "unverified"], { limit: 5_000 });
  const by = (s: string) => all.filter((l) => l.status === s).length;
  return {
    launches: all.length,
    confirmed: by("confirmed"),
    submitted: by("submitted"),
    failed: by("failed"),
    unverified: by("unverified"),
    byAgents: all.filter((l) => l.launchedBy === "agent").length,
    last24h: all.filter((l) => l.createdAt > Date.now() - 24 * 3600_000).length,
  };
}

async function feeWalletBalance(): Promise<number | null> {
  try {
    return (await solConnection().getBalance(new PublicKey(PLATFORM_FEE_WALLET_SOL), "confirmed")) / 1e9;
  } catch {
    return null;
  }
}

async function overview(): Promise<AdminOverview> {
  const [collector, balanceSol, counts, chains, pads, events] = await Promise.all([
    collectorStatus(),
    feeWalletBalance(),
    launchCounts(),
    chainRows(),
    launchpadRows(),
    auditEvents(undefined, 20),
  ]);
  const conflict = treasuryEnvConflict();
  const lut = launchEnv.pumpLut() ?? null;
  const pinata = !!launchEnv.pinataJwt();
  const warnings: string[] = [];
  if (conflict) warnings.push(`${conflict.split("=")[0]} differs from the platform fee wallet — Solana launches are refused until it is removed.`);
  if (!lut) {
    warnings.push(
      "PUMP_LUT_ADDRESS is not set: launches with a dev buy don't fit one transaction, so the dev buy is sent separately (snipeable) and long names/links are refused. " +
        "Create the table: POST /api/launch/pump/lut { authority: <your wallet> } → sign & send the returned transactions → set PUMP_LUT_ADDRESS → restart.",
    );
  }
  if (!pinata) warnings.push(NETWORK === "mainnet" ? "PINATA_JWT is not set: mainnet launches are refused in production (coin images/metadata must be pinned to IPFS)." : "PINATA_JWT is not set: coin files are served by this server (fine on testnet).");
  if (!collector.enabled) warnings.push(`Fee collector disabled (${collector.reason}). Creator fees then only move when someone presses Harvest.`);
  else if (collector.lowBalance) warnings.push(`Fee collector wallet is low: ${collector.balanceSol?.toFixed(4)} SOL (alert below ${collector.alertBelowSol} SOL).`);
  if (launchEnv.pumpAllowSplitLayout()) warnings.push("PUMP_ALLOW_SPLIT_LAYOUT=true: the fee split may be sent in a separate transaction. Testing only — remove it in production.");
  if (counts.unverified) warnings.push(`${counts.unverified} launch(es) have an on-chain fee split that doesn't match the plan (status unverified).`);
  return {
    collector,
    feeWallet: { address: PLATFORM_FEE_WALLET_SOL, balanceSol },
    counts,
    switches: { chainsOpen: chains.filter((c) => c.effective === "open").length, launchpadsOpen: pads.filter((l) => l.effective === "open").length },
    config: {
      network: NETWORK,
      database: !!pool,
      pumpLut: lut,
      pinata,
      collectorKey: collector.enabled,
      splitLayoutAllowed: launchEnv.pumpAllowSplitLayout(),
      treasuryEnvConflict: conflict,
    },
    warnings,
    recentAudit: events,
  };
}

const chainPut = z.object({
  chain: z.enum(CHAIN_ORDER as [ChainId, ...ChainId[]]),
  state: z.enum(CHAIN_STATES as [string, ...string[]]),
  note: z.string().trim().max(280).nullable().optional(),
});
const padPut = z.object({
  launchpad: z.enum(LAUNCHPAD_ORDER as [LaunchpadId, ...LaunchpadId[]]),
  chain: z.enum(CHAIN_ORDER as [ChainId, ...ChainId[]]),
  state: z.enum(LAUNCHPAD_STATES as [string, ...string[]]),
  allowAgents: z.boolean(),
  note: z.string().trim().max(280).nullable().optional(),
});
const splPut = z.object({
  mint: z.string().trim().refine(isSolAddress, "must be a Solana address"),
  symbol: z.string().trim().regex(/^[A-Z0-9]{1,10}$/, "A–Z / 0–9, up to 10 characters"),
  name: z.string().trim().min(1).max(32),
  decimals: z.number().int().min(0).max(9),
});

export function registerPlatformRoutes(app: Express): void {
  app.get("/api/platform/config", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await platformConfig(closedFor(req)));
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/collector/status", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await collectorStatus());
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/admin/overview", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(await overview());
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/admin/chains", requireAdmin, async (_req, res) => {
    try {
      res.json({ chains: await chainRows() });
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.put("/api/admin/chains", requireAdmin, async (req: Request, res: Response) => {
    try {
      const b = chainPut.parse(req.body);
      const before = (await chainRows()).find((c) => c.chain === b.chain);
      await setChainState(b.chain, b.state as never, b.note || null, actorOf(res));
      invalidatePlatformConfig();
      const after = (await chainRows()).find((c) => c.chain === b.chain)!;
      audit({ actor: actorOf(res), action: "admin.chain_set", target: b.chain, severity: "warn", ip: req.ip, detail: { before: before && { state: before.state, note: before.note }, after: { state: after.state, note: after.note } } });
      res.json({ chain: after });
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/admin/launchpads", requireAdmin, async (_req, res) => {
    try {
      res.json({ launchpads: await launchpadRows() });
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.put("/api/admin/launchpads", requireAdmin, async (req: Request, res: Response) => {
    try {
      const b = padPut.parse(req.body);
      if (!deploymentPairs().some((p) => p.launchpad === b.launchpad && p.chain === b.chain)) {
        return res.status(400).json({ error: "not_deployed", message: `${LAUNCHPADS[b.launchpad].name} isn't deployed on ${CHAINS[b.chain].name}` });
      }
      const before = (await launchpadRows()).find((l) => l.launchpad === b.launchpad && l.chain === b.chain);
      await setLaunchpadState(b.launchpad, b.chain, b.state as never, b.allowAgents, b.note || null, actorOf(res));
      invalidatePlatformConfig();
      const after = (await launchpadRows()).find((l) => l.launchpad === b.launchpad && l.chain === b.chain)!;
      audit({
        actor: actorOf(res),
        action: "admin.launchpad_set",
        target: `${b.launchpad}:${b.chain}`,
        severity: "warn",
        ip: req.ip,
        detail: {
          before: before && { state: before.state, allowAgents: before.allowAgents, note: before.note },
          after: { state: after.state, effective: after.effective, allowAgents: b.allowAgents, note: after.note },
        },
      });
      res.json({ launchpad: after });
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/admin/spl-config", requireAdmin, async (_req, res) => {
    try {
      res.json(await getSplConfig());
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.put("/api/admin/spl-config", requireAdmin, async (req: Request, res: Response) => {
    try {
      const b = splPut.parse(req.body);
      const before = await getSplConfig();
      const after = await setSplConfig(b, actorOf(res));
      invalidatePlatformConfig();
      audit({ actor: actorOf(res), action: "admin.spl_config_set", target: "claudio", severity: "high", ip: req.ip, detail: { before: before.token, after: after.token } });
      res.json(after);
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/admin/collector", requireAdmin, async (_req, res) => {
    try {
      const [status, runs, payouts] = await Promise.all([collectorStatus(), recentRuns(20), recentPayouts(50)]);
      const detail: AdminCollectorDetail = { status, runs, payouts };
      res.json(detail);
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.post("/api/admin/collector/run", requireAdmin, async (req: Request, res: Response) => {
    try {
      const dryRun = !!(req.body as { dryRun?: unknown })?.dryRun;
      audit({ actor: actorOf(res), action: "admin.collector_run", severity: "info", ip: req.ip, detail: { dryRun } });
      const run = await runCollector("admin", { dryRun });
      res.json({ run });
    } catch (e) {
      sendErr(res, e);
    }
  });

  app.get("/api/admin/audit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const action = typeof req.query.action === "string" && req.query.action.trim() ? req.query.action.trim().slice(0, 64) : undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
      res.json({ events: await auditEvents(action, limit) });
    } catch (e) {
      sendErr(res, e);
    }
  });
}

/** Background work of this module: the launch reconciler (always) and the fee collector (with COLLECTOR_KEY). */
export function startCollector(): void {
  startLaunchReconciler();
  startCollectorBot();
}
