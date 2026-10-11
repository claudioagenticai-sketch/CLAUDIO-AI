// Route + realtime wiring. Each module owns its own register function; keep this file tiny.
//   access gate (coming soon + preview) → public site files (llms.txt, .md twins) → auth → platform → board/trade/launch/social/ops → agents → hosted → insights → MCP
import type { Express } from "express";
import { createServer, type Server } from "http";
import { attachHub } from "../hub";
import { startIngest } from "../ingest";
import { registerBoardRoutes } from "./board";
import { registerTradeRoutes } from "./trade";
import { registerLaunchRoutes } from "./launch";
import { registerSocialRoutes } from "./social";
import { registerOpsRoutes } from "./ops";
import { startKeeper } from "../keeper";
import { BRAND } from "@shared/brand";
import { closedFor, comingSoon, previewEnabled, registerAccessGate } from "../access";
import { registerSiteRoutes } from "../site";
import { registerAuthRoutes } from "../auth";
import { registerRpcProxy } from "../rpcProxy";
import { registerInsightsRoutes, startInsights } from "../insights";
import { startLiveTrades } from "../trades/live";
import { migrate } from "../migrate";
import { registerPlatformRoutes, startCollector } from "../platform";
import { registerAgentRoutes, startResidentAgents } from "../agents";
import { registerHostedRoutes, startHostedRunner } from "../hosted";
import { addRelayTokenVerifier, registerRelayRoutes } from "../relay";
import { registerMcpRoutes, verifyAccessToken } from "../mcp";
import { registerSkillsRoutes } from "../skills";
import { log } from "../vite";

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);

  // Tables first: every module below may read/write them. A failed migration is logged, the app still serves.
  await migrate().catch(() => log("database migrations failed — database features may be unavailable", "migrate"));

  app.get("/api/health", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      name: BRAND.full,
      comingSoon: closedFor(req),
      version: BRAND.version,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  registerAccessGate(app);
  registerSiteRoutes(app); // /llms.txt, /index.md, /claudio.md, robots, sitemap, /claudio meta
  registerAuthRoutes(app);
  registerPlatformRoutes(app);
  registerRpcProxy(app);

  attachHub(server);
  registerBoardRoutes(app);
  registerTradeRoutes(app);
  registerLaunchRoutes(app);
  registerSocialRoutes(app);
  registerOpsRoutes(app);
  registerAgentRoutes(app);
  registerHostedRoutes(app);
  registerInsightsRoutes(app);
  registerRelayRoutes(app);
  registerMcpRoutes(app); // /mcp/data, /mcp/trade, OAuth (/oauth/*, /.well-known/*), /api/oauth/*, /api/mcp/*
  registerSkillsRoutes(app); // /api/skills*, /skills/:slug.md, /skills/:slug/SKILL.md, /skills.md (zips are static files)
  // `claudio login` access tokens and MCP keys may upload to the media relay with a plain Bearer header.
  addRelayTokenVerifier(async (token) => {
    const v = await verifyAccessToken(token);
    return v ? { ok: true, principal: { id: `mcp:${v.tokenId}`, kind: "oauth", label: v.wallet } } : null;
  });

  // Any /api path nobody handled is a JSON 404 — never the SPA's index.html (clients key off content-type).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found", message: "No such API endpoint" });
  });

  // Background work runs when the site is open, or when a preview key exists (so the preview has live data).
  // Previewing in development must never trigger automatic on-chain fee transfers, so the fee keeper (EVM) and the
  // Solana collector only start outside development; published deployments keep their own explicit gates
  // (KEEPER=on, COLLECTOR_KEY).
  const dev = app.get("env") === "development";
  if (!comingSoon() || previewEnabled()) {
    startIngest();
    startInsights();
    startLiveTrades();
    if (!dev) {
      startKeeper();
      startCollector();
    } else {
      log("development: fee keeper and collector are off (no automatic on-chain transfers while previewing)", "access");
    }
    startResidentAgents();
    startHostedRunner();
  } else {
    log("coming-soon mode without PREVIEW_KEY: indexers, keeper, collector and agents are off", "access");
  }
  return server;
}
