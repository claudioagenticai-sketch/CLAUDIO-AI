// Operator endpoints: relayer/keeper status (public: it's all on-chain anyway) and admin actions behind ADMIN_TOKEN.
//   GET  /api/ops/status                         relayer address, balances, today's spend, keeper last report
//   POST /api/ops/keeper/run    (admin)          run the fee keeper now
//   GET  /api/ops/claims/pending (admin)         claims waiting out the bind delay (guardian review queue)
import type { Express, NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { keeperStatus, runKeeperOnce } from "../keeper";
import { relayerStatus } from "../relayer";
import { socialStore } from "../social/store";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const want = process.env.ADMIN_TOKEN?.trim();
  const got = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || want.length < 24) return res.status(501).json({ error: "admin_unconfigured", message: "Set ADMIN_TOKEN (24+ chars) to use operator endpoints" });
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "unauthorized", message: "Bad admin token" });
  return next();
}

export function registerOpsRoutes(app: Express): void {
  app.get("/api/ops/status", async (_req, res) => {
    try {
      res.json({ relayer: await relayerStatus(), keeper: keeperStatus() });
    } catch (e) {
      res.status(500).json({ error: "internal", message: (e as Error).message });
    }
  });

  app.post("/api/ops/keeper/run", requireAdmin, async (_req, res) => {
    try {
      res.json(await runKeeperOnce());
    } catch (e) {
      res.status(500).json({ error: "internal", message: (e as Error).message });
    }
  });

  app.get("/api/ops/claims/pending", requireAdmin, async (_req, res) => {
    try {
      res.json({ claims: await socialStore.pendingClaims() });
    } catch (e) {
      res.status(500).json({ error: "internal", message: (e as Error).message });
    }
  });
}
