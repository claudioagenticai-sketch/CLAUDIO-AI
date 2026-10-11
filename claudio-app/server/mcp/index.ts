// Online MCP server for useclaudio.xyz (no subdomains: everything is a path on the main site).
//
//   POST /mcp/data      read-only tools, resources, prompts, MCP Apps views (no sign-in needed)
//   POST /mcp/trade     quote / prepare trade / prepare launch / trade status / post in the thread (Bearer token)
//   OAuth 2.1 + discovery: see oauth.ts · /connect + /confirm/:id APIs: see manage.ts
//
// Files: rpc.ts (JSON-RPC over Streamable HTTP), tools.ts (tool + resource implementations), oauth.ts (authorization
// server), manage.ts (keys, connected apps, watchlist, prepared actions), store.ts (SQL), internal.ts (loopback).
// The tool catalog is generated into shared/mcpCatalog.ts from claudio-sdk (scripts/sync-catalog.mjs).
import type { Express } from "express";
import { registerOAuthRoutes } from "./oauth";
import { registerManageRoutes } from "./manage";
import { registerMcpEndpoints } from "./rpc";

/** Token check other modules can reuse (the media relay registers it at merge). */
export { verifyAccessToken } from "./store";

export function registerMcpRoutes(app: Express): void {
  registerOAuthRoutes(app);
  registerManageRoutes(app);
  registerMcpEndpoints(app);
}
