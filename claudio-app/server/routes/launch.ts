// Launch + upload REST routes. Owner: launch module.
//
//   GET  /uploads/:file                 dev-only local uploads (safe filenames only)
//   POST /api/upload/image              multipart `file` (≤4 MB, png/jpeg/gif/webp by magic bytes)
//   POST /api/upload/metadata           JSON token metadata → pinned JSON URI
//   GET  /api/launch/adapters           adapter registry + statuses + platform config for the UI
//   POST /api/launch/plan               LaunchRequest (+ agentSlug) → { id, plan } — see ../launch/plan.ts
//   POST /api/launch/confirm            { id, hashes } → { launch } (only the plan's own signatures; 20/min/IP)
//   GET  /api/launch/mine?creator=a,b   submitted/confirmed launches for these creators
//   GET  /api/launch/fees?launchId=     accrued-fee readings (best effort)
//   POST /api/launch/harvest            { launchId } → { txs: PreparedTx[], notes }
//   POST /api/launch/pump/lut           { authority } → ops: txs creating the pump Address Lookup Table
import path from "path";
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { CHAINS, CHAIN_ORDER, type ChainId } from "@shared/chains";
import { LAUNCHPADS, LAUNCHPAD_ORDER, deploymentOf, type LaunchpadId } from "@shared/launchpads";
import { BRAND } from "@shared/brand";
import { isSolAddress, launchEnv } from "../launch/env";
import { buildLutSetup } from "../launch/pump/lut";
import { ADAPTERS, adapterFor } from "../launch/registry";
import { launchStore } from "../launch/store";
import { LaunchError, toPublicLaunch } from "../launch/types";
import { IS_TESTNET } from "../network";
import { hostedAgentRoute, isPinnedUri, parseLaunchRequest, planLaunchFor, type LaunchContext } from "../launch/plan";
import { confirmLaunch } from "../launch/reconcile";
import { verifySolHashes } from "../launch/verify";
import { audit, getSession } from "../auth";
import { PLATFORM_FEE_WALLET_SOL } from "@shared/platform";
import { MAX_IMAGE_BYTES, SAFE_UPLOAD_NAME, UPLOAD_DIR, sniffImage, storeImage, storeJson } from "../launch/uploads";
import { shareHarvestTxs } from "../launch/shares";

// ─── Small per-IP rate limiter (fixed window) ───────────────────────
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return next();
    }
    h.n += 1;
    if (h.n > max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests — slow down." });
    }
    return next();
  };
}

// ─── Validation (the LaunchRequest schema lives in ../launch/plan) ──
const urlish = z
  .string()
  .trim()
  .max(512)
  .refine((v) => /^(https?:\/\/|ipfs:\/\/)/i.test(v), "must be an http(s):// or ipfs:// URI");
const social = z.string().trim().max(256).optional();

const metadataSchema = z.object({
  name: z.string().trim().min(1).max(64),
  symbol: z.string().trim().min(1).max(16),
  description: z.string().max(2048).optional().default(""),
  image: urlish,
  twitter: social,
  telegram: social,
  website: social,
  showName: z.boolean().optional().default(true),
});

const confirmSchema = z.object({
  id: z.string().min(8).max(64),
  hashes: z.array(z.string().trim().min(32).max(128)).min(1).max(8),
});

const harvestSchema = z.object({ launchId: z.string().min(8).max(64) });

function sendError(res: Response, e: unknown) {
  if (e instanceof LaunchError) return res.status(e.status).json({ error: e.code, message: e.message });
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return res.status(400).json({ error: "invalid_request", message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request" });
  }
  console.error("[launch]", e);
  return res.status(500).json({ error: "internal", message: e instanceof Error ? e.message : "Internal error" });
}

function baseUrl(req: Request): string {
  return launchEnv.publicBaseUrl() ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 4 },
});

export function registerLaunchRoutes(app: Express): void {
  const uploadLimit = rateLimit(30, 60_000);
  const planLimit = rateLimit(40, 60_000);
  const confirmLimit = rateLimit(20, 60_000);

  // ── Dev uploads (./uploads is gitignored) ────────────────────────
  app.get("/uploads/:file", (req: Request, res: Response) => {
    const file = String(req.params.file ?? "");
    if (!SAFE_UPLOAD_NAME.test(file)) return res.status(404).end();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.sendFile(path.join(UPLOAD_DIR, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.post("/api/upload/image", uploadLimit, (req: Request, res: Response) => {
    upload.single("file")(req, res, async (err: unknown) => {
      if (err) {
        const tooBig = err instanceof multer.MulterError && (err as { code?: string }).code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({
          error: tooBig ? "too_large" : "bad_upload",
          message: tooBig ? "Image must be 4 MB or smaller" : err instanceof Error ? err.message : "Upload failed",
        });
      }
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "no_file", message: "Send the image as multipart field `file`" });
        const kind = sniffImage(file.buffer);
        if (!kind) return res.status(415).json({ error: "unsupported_type", message: "Only PNG, JPEG, GIF or WEBP images" });
        const stored = await storeImage(file.buffer, kind, baseUrl(req));
        return res.json({ ...stored, kind, bytes: file.size });
      } catch (e) {
        return sendError(res, e);
      }
    });
  });

  app.post("/api/upload/metadata", uploadLimit, async (req: Request, res: Response) => {
    try {
      const m = metadataSchema.parse(req.body);
      if (!IS_TESTNET && process.env.NODE_ENV === "production" && !isPinnedUri(m.image)) {
        throw new LaunchError(400, "image_not_pinned", "The image must be pinned to IPFS before it goes into the coin metadata — upload it again.");
      }
      const json = {
        name: m.name,
        symbol: m.symbol,
        description: m.description,
        image: m.image,
        showName: m.showName,
        createdOn: BRAND.name,
        ...(m.twitter ? { twitter: m.twitter } : {}),
        ...(m.telegram ? { telegram: m.telegram } : {}),
        ...(m.website ? { website: m.website } : {}),
      };
      const stored = await storeJson(json, baseUrl(req));
      return res.json(stored);
    } catch (e) {
      return sendError(res, e);
    }
  });

  // ── Registry ─────────────────────────────────────────────────────
  app.get("/api/launch/adapters", (_req: Request, res: Response) => {
    res.json({
      adapters: LAUNCHPAD_ORDER.map((id) => {
        const a = ADAPTERS[id];
        return { id, name: LAUNCHPADS[id].name, chains: a.chains, status: a.status, note: a.note ?? null };
      }),
      platform: {
        evm: launchEnv.platformTreasuryEvm("hood") ?? null,
        sol: PLATFORM_FEE_WALLET_SOL,
      },
      splitterFactory: CHAIN_ORDER.reduce(
        (acc, c) => {
          acc[c] = CHAINS[c].kind === "evm" ? launchEnv.splitterFactory(c) ?? null : null;
          return acc;
        },
        {} as Record<ChainId, string | null>,
      ),
      shareFactory: CHAIN_ORDER.reduce(
        (acc, c) => {
          acc[c] = CHAINS[c].kind === "evm" ? launchEnv.shareFactory(c) ?? null : null;
          return acc;
        },
        {} as Record<ChainId, string | null>,
      ),
      pinning: launchEnv.pinataJwt() ? "pinata" : "local",
      pumpLut: launchEnv.pumpLut() ?? null,
    });
  });

  // ── Plan ─────────────────────────────────────────────────────────
  app.post("/api/launch/plan", planLimit, async (req: Request, res: Response) => {
    try {
      const request = parseLaunchRequest(req.body);
      const session = await getSession(req);
      const ctx: LaunchContext = { launchedBy: "human", actor: session?.wallet, ip: req.ip };
      if (request.agentSlug) {
        // Launching "with" a hosted agent: the creator share goes to the agent's escrow, never to the launcher.
        if (!session) throw new LaunchError(401, "sign_in_required", "Sign in with your wallet to launch with your agent");
        const route = await hostedAgentRoute(request.agentSlug, session.wallet);
        Object.assign(ctx, { agentId: route.agentId, agentSlug: route.agentSlug, agentName: route.agentName, creatorShareTo: route.escrow });
      }
      const planned = await planLaunchFor(request, ctx);
      if (ctx.agentId) {
        audit({ actor: session?.wallet, action: "launch.plan_with_agent", target: planned.id, ip: req.ip, detail: { agent: ctx.agentSlug, escrow: ctx.creatorShareTo } });
      }
      return res.json(planned);
    } catch (e) {
      return sendError(res, e);
    }
  });

  // ── Confirm ──────────────────────────────────────────────────────
  // Only signatures that belong to the plan are accepted (Solana: the creator's signature over a planned message,
  // see launch/verify.ts), so a third party can't attach or overwrite hashes. Rate-limited per IP.
  app.post("/api/launch/confirm", confirmLimit, async (req: Request, res: Response) => {
    try {
      const { id, hashes } = confirmSchema.parse(req.body);
      const launch = await launchStore.get(id);
      if (!launch) throw new LaunchError(404, "not_found", "Unknown launch id");
      if (launch.status === "confirmed" || launch.status === "unverified") return res.json({ launch: toPublicLaunch(launch) });
      if (CHAINS[launch.chain].kind === "svm") {
        const v = await verifySolHashes(launch, hashes);
        if (v.rejected.length) {
          audit({ action: "launch.confirm_rejected", target: id, severity: "warn", ip: req.ip, detail: { rejected: v.rejected.slice(0, 4) } });
        }
        // Keep hashes that already verified; add the new verified ones.
        const merged = [...launch.txHashes, ...v.accepted.filter((h) => !launch.txHashes.includes(h))];
        if (!merged.length) {
          if (v.pending.length) {
            launch.meta.candidates = JSON.stringify(v.pending.slice(0, 4));
            await launchStore.save(launch);
            return res.status(202).json({ launch: toPublicLaunch(launch), pending: true });
          }
          throw new LaunchError(403, "hash_mismatch", "These transactions don't belong to this launch");
        }
        launch.txHashes = merged;
        if (v.pending.length) launch.meta.candidates = JSON.stringify(v.pending.slice(0, 4));
      } else {
        // EVM (launchpads currently closed): never let a later call replace hashes that were already recorded.
        if (launch.status === "submitted" && launch.txHashes.length) return res.json({ launch: toPublicLaunch(launch) });
        launch.txHashes = hashes;
      }
      launch.status = "submitted";
      await launchStore.save(launch);
      await confirmLaunch(launch);
      return res.json({ launch: toPublicLaunch(launch) });
    } catch (e) {
      return sendError(res, e);
    }
  });

  // ── My launches ──────────────────────────────────────────────────
  app.get("/api/launch/mine", async (req: Request, res: Response) => {
    try {
      const raw = ([] as unknown[]).concat(req.query.creator ?? []);
      const creators = raw
        .flatMap((v) => String(v).split(","))
        .map((s) => s.trim())
        .filter((s) => s.length >= 32 && s.length <= 64)
        .slice(0, 8);
      if (!creators.length) return res.json({ launches: [] });
      const list = await launchStore.byCreators(creators);
      // Prepared-but-unsent launches stay private (they would leak unreleased names/tickers).
      return res.json({ launches: list.filter((l) => l.status !== "prepared").map(toPublicLaunch) });
    } catch (e) {
      return sendError(res, e);
    }
  });

  app.get("/api/launch/fees", async (req: Request, res: Response) => {
    try {
      const id = String(req.query.launchId ?? "");
      const launch = id ? await launchStore.get(id) : undefined;
      if (!launch || launch.status === "prepared") throw new LaunchError(404, "not_found", "Unknown launch id");
      const adapter = adapterFor(launch.launchpad);
      const items = adapter.fees ? await adapter.fees(launch) : [];
      return res.json({ items, at: Date.now() });
    } catch (e) {
      return sendError(res, e);
    }
  });

  // ── Harvest ──────────────────────────────────────────────────────
  app.post("/api/launch/harvest", planLimit, async (req: Request, res: Response) => {
    try {
      const { launchId } = harvestSchema.parse(req.body);
      const launch = await launchStore.get(launchId);
      if (!launch || launch.status === "prepared") throw new LaunchError(404, "not_found", "Unknown launch id");
      const adapter = adapterFor(launch.launchpad);
      if (!adapter.harvest) throw new LaunchError(501, "harvest_unsupported", `Harvest is not available for ${LAUNCHPADS[launch.launchpad].name} yet`);
      const result = await adapter.harvest(launch);
      // Split launches: the harvest pays the ShareSplitter; split it on to the launcher and the social vaults.
      const shareTxs = await shareHarvestTxs(launch);
      if (shareTxs.length) {
        result.txs.push(...shareTxs);
        result.notes.push("Then splits the creator share between you and the social accounts.");
      }
      return res.json(result);
    } catch (e) {
      return sendError(res, e);
    }
  });

  // ── Ops: pump lookup table ───────────────────────────────────────
  app.post("/api/launch/pump/lut", planLimit, async (req: Request, res: Response) => {
    try {
      const authority = String((req.body as { authority?: unknown })?.authority ?? "");
      if (!isSolAddress(authority)) throw new LaunchError(400, "bad_authority", "authority must be a Solana address");
      const setup = await buildLutSetup(authority);
      return res.json({
        ...setup,
        next: "Sign & send every tx with the authority wallet (in order), wait ~1 slot, then set the PUMP_LUT_ADDRESS secret to `address` and restart. Without it, launches that don't fit one transaction are refused (split_not_atomic).",
      });
    } catch (e) {
      return sendError(res, e);
    }
  });
}
