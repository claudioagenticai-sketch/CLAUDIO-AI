// Insights module (owner: GMGN gateway workstream): the GMGN OpenAPI gateway (gmgn.ts — adaptive rate limiter, lanes,
// coalescing, in-memory cache; never the database), normalizers (normalize.ts), /api/insights/* endpoints (routes.ts),
// and board indexing (indexing.ts — on-demand token lookup, candle backfill, the Trenches merge, Claudio launch indexing
// and enrichment, GMGN search). Scores live in ./scores (pure functions, another workstream).
import type { Express } from "express";
import { registerInsightsRoutes as registerRoutes } from "./routes";
import { startIndexingLoops } from "./indexing";

export { backfillCandles, enrichToken, indexClaudioLaunch, lookupToken, noteViewer, searchGmgn } from "./indexing";

export function registerInsightsRoutes(app: Express): void {
  registerRoutes(app);
}

/** Background work (only when the site is open): Trenches merge, Claudio coin refresh, launch reload. */
export function startInsights(): void {
  startIndexingLoops();
}
