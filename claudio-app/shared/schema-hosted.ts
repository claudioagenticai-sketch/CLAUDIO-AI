// Drizzle tables for the hosted workstream — escrow wallets, policies, runs, ledger (migrations 300–399).
// Keep in sync with the matching server/migrations/*.sql files (300_hosted.sql, 310_cloud.sql).
import { pgTable, text, integer, bigint, bigserial, timestamp, jsonb, boolean, doublePrecision, date, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import type { AgentPolicy } from "./agents";

/** Claudio-held escrow wallet per hosted agent. Secrets are envelope-encrypted (see server/hosted/vault.ts). */
export const agentWallets = pgTable(
  "agent_wallets",
  {
    agentId: text("agent_id").primaryKey(),
    address: text("address").notNull().unique(),
    encKey: text("enc_key").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    keyVersion: text("key_version").notNull(),
    balanceLamports: bigint("balance_lamports", { mode: "number" }),
    balanceAt: timestamp("balance_at", { withTimezone: true }),
    lastSignature: text("last_signature"),
    polledAt: timestamp("polled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (t) => [index("agent_wallets_key_version_idx").on(t.keyVersion)],
);

export const agentPolicies = pgTable("agent_policies", {
  agentId: text("agent_id").primaryKey(),
  policy: jsonb("policy").$type<AgentPolicy>().notNull(),
  adminKilled: boolean("admin_killed").notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentLedger = pgTable(
  "agent_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: text("agent_id").notNull(),
    address: text("address").notNull(),
    kind: text("kind").notNull(), // creator_fee | inflow | outflow | trade
    amountSol: doublePrecision("amount_sol").notNull(),
    signature: text("signature").notNull(),
    source: text("source"),
    slot: bigint("slot", { mode: "number" }),
    blockTime: timestamp("block_time", { withTimezone: true }),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_ledger_sig_idx").on(t.agentId, t.signature, t.kind),
    index("agent_ledger_agent_idx").on(t.agentId, t.createdAt),
  ],
);

export const agentPaperTrades = pgTable(
  "agent_paper_trades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: text("agent_id").notNull(),
    mint: text("mint").notNull(),
    symbol: text("symbol"),
    side: text("side").notNull(), // buy | sell
    amountSol: doublePrecision("amount_sol").notNull(),
    tokens: doublePrecision("tokens").notNull(),
    priceSol: doublePrecision("price_sol").notNull(),
    feeSol: doublePrecision("fee_sol").notNull().default(0),
    reason: text("reason"),
    approvalId: text("approval_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_paper_trades_agent_idx").on(t.agentId, t.createdAt), index("agent_paper_trades_mint_idx").on(t.agentId, t.mint)],
);

export const agentApprovals = pgTable(
  "agent_approvals",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    kind: text("kind").notNull(),
    intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
    intentHash: text("intent_hash").notNull(),
    amountSol: doublePrecision("amount_sol").notNull().default(0),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | expired | executed | failed
    result: jsonb("result").$type<Record<string, unknown>>(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_approvals_agent_idx").on(t.agentId, t.status, t.createdAt)],
);

export const agentActions = pgTable(
  "agent_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: text("agent_id").notNull(),
    kind: text("kind").notNull(),
    ok: boolean("ok").notNull().default(true),
    model: text("model"),
    summary: text("summary"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_actions_agent_idx").on(t.agentId, t.id), index("agent_actions_day_idx").on(t.createdAt)],
);

export const agentRuntime = pgTable(
  "agent_runtime",
  {
    agentId: text("agent_id").primaryKey(),
    running: boolean("running").notNull().default(false),
    goals: text("goals").notNull().default(""),
    memory: text("memory").notNull().default(""),
    runs: integer("runs").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    startedBy: text("started_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_runtime_due_idx").on(t.running, t.nextRunAt)],
);

export const hostedSettings = pgTable("hosted_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Cloud workspace (migration 310_cloud.sql, server/hosted/workspace) ───────────────────────────────────────

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    ownerWallet: text("owner_wallet").notNull(),
    title: text("title").notNull().default("New chat"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_sessions_agent_idx").on(t.agentId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: text("session_id").notNull(),
    agentId: text("agent_id").notNull(),
    role: text("role").notNull(), // user | agent | tool | helper | approval | error
    content: text("content").notNull().default(""),
    helper: text("helper"),
    model: text("model"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_session_idx").on(t.sessionId, t.id), index("chat_messages_agent_idx").on(t.agentId, t.createdAt)],
);

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: text("agent_id").notNull(),
    kind: text("kind").notNull().default("note"), // note | owner | chat
    content: text("content").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_memories_agent_idx").on(t.agentId, t.pinned, t.id)],
);

export const agentFiles = pgTable(
  "agent_files",
  {
    agentId: text("agent_id").notNull(),
    path: text("path").notNull(),
    content: text("content").notNull().default(""),
    size: integer("size").notNull().default(0),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.path] })],
);

export const agentWorkspace = pgTable("agent_workspace", {
  agentId: text("agent_id").primaryKey(),
  skills: jsonb("skills").$type<Record<string, boolean>>().notNull().default({}),
  helpers: jsonb("helpers").$type<Record<string, boolean>>().notNull().default({}),
  postApproval: boolean("post_approval").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cloudUsage = pgTable(
  "cloud_usage",
  {
    agentId: text("agent_id").notNull(),
    ownerWallet: text("owner_wallet").notNull(),
    day: date("day").notNull(),
    messages: integer("messages").notNull().default(0),
    modelCalls: integer("model_calls").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.ownerWallet, t.day] }),
    index("cloud_usage_owner_day_idx").on(t.ownerWallet, t.day),
    index("cloud_usage_day_idx").on(t.day),
  ],
);
