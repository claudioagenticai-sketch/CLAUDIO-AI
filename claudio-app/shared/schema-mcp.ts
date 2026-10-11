// Drizzle tables for the online MCP server + OAuth (migrations 400–499). Keep in sync with server/migrations/400_mcp.sql.
// Server code uses raw SQL (server/mcp/store.ts); these mirrors exist for drizzle-kit and type reference.
import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const mcpOauthClients = pgTable("mcp_oauth_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  clientUri: text("client_uri"),
  logoUri: text("logo_uri"),
  applicationType: text("application_type").notNull().default("web"),
  createdIp: text("created_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const mcpOauthRequests = pgTable("mcp_oauth_requests", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientName: text("client_name").notNull(),
  clientKind: text("client_kind").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").array().notNull(),
  state: text("state"),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mcpGrants = pgTable(
  "mcp_grants",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull(),
    scopes: text("scopes").array().notNull(),
    agentId: text("agent_id"),
    resource: text("resource"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("mcp_grants_wallet_idx").on(t.wallet, t.createdAt)],
);

export const mcpOauthCodes = pgTable("mcp_oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  grantId: text("grant_id").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    kind: text("kind").notNull(),
    grantId: text("grant_id").notNull(),
    wallet: text("wallet").notNull(),
    clientId: text("client_id").notNull(),
    scopes: text("scopes").array().notNull(),
    resource: text("resource"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_tokens_grant_idx").on(t.grantId)],
);

export const mcpKeys = pgTable(
  "mcp_keys",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    agentId: text("agent_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_keys_wallet_idx").on(t.wallet, t.createdAt)],
);

export const mcpPrepared = pgTable(
  "mcp_prepared",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    kind: text("kind").notNull(),
    params: jsonb("params").notNull(),
    summary: jsonb("summary").notNull(),
    status: text("status").notNull().default("pending"),
    signatures: text("signatures").array().notNull().default([]),
    mint: text("mint"),
    error: text("error"),
    clientName: text("client_name"),
    grantId: text("grant_id"),
    keyId: text("key_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_prepared_wallet_idx").on(t.wallet, t.createdAt)],
);

export const mcpWatchlists = pgTable("mcp_watchlists", {
  wallet: text("wallet").primaryKey(),
  keys: jsonb("keys").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
