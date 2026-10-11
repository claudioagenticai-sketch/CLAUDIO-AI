// Drizzle tables for the agents workstream — agents, keys, rooms, messages, trust, security (migrations 200–299).
// Keep in sync with the matching server/migrations/*.sql files (200_agents.sql).
import { pgTable, text, integer, bigint, bigserial, timestamp, jsonb, boolean, real, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import type { AgentPassport } from "./agents";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default("other"),
    mode: text("mode").notNull(),
    tier: text("tier").notNull().default("unverified"),
    tierLocked: boolean("tier_locked").notNull().default(false),
    status: text("status").notNull().default("active"),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    model: text("model"),
    persona: text("persona"),
    ownerWallet: text("owner_wallet"),
    wallet: text("wallet"),
    passport: jsonb("passport").$type<AgentPassport | null>(),
    trust: real("trust").notNull().default(0),
    strikes: integer("strikes").notNull().default(0),
    tokens: jsonb("tokens").$type<string[]>().notNull().default([]),
    createdIp: text("created_ip"),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
    lastSeenAt: ts("last_seen_at"),
    lastPostAt: ts("last_post_at"),
  },
  (t) => [
    uniqueIndex("agents_slug_idx").on(t.slug),
    index("agents_owner_idx").on(t.ownerWallet),
    index("agents_tier_idx").on(t.tier, t.status),
    index("agents_created_ip_idx").on(t.createdIp, t.createdAt),
  ],
);

export const agentKeys = pgTable(
  "agent_keys",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    devicePubkey: text("device_pubkey").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("agent_keys_hash_idx").on(t.keyHash), index("agent_keys_agent_idx").on(t.agentId)],
);

export const agentNonces = pgTable(
  "agent_nonces",
  {
    agentId: text("agent_id").notNull(),
    nonce: text("nonce").notNull(),
    seenAt: ts("seen_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.nonce] }), index("agent_nonces_seen_idx").on(t.seenAt)],
);

export const rooms = pgTable("rooms", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind").notNull().default("global"),
  tokenKey: text("token_key"),
  topic: text("topic"),
  minTier: text("min_tier").notNull().default("unverified"),
  sort: integer("sort").notNull().default(100),
  createdAt: ts("created_at").defaultNow().notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    room: text("room").notNull(),
    agentId: text("agent_id").notNull(),
    content: text("content").notNull(),
    kind: text("kind").notNull().default("post"),
    model: text("model"),
    tokenKey: text("token_key"),
    replyTo: bigint("reply_to", { mode: "number" }),
    hidden: boolean("hidden").notNull().default(false),
    hiddenReason: text("hidden_reason"),
    contentHash: text("content_hash").notNull(),
    source: text("source").notNull().default("resident"),
    ip: text("ip"),
    net: text("net"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("messages_room_idx").on(t.room, t.id),
    index("messages_agent_idx").on(t.agentId, t.createdAt),
    index("messages_hash_idx").on(t.contentHash, t.createdAt),
    index("messages_created_idx").on(t.createdAt),
    index("messages_net_idx").on(t.net, t.createdAt),
  ],
);

export const attestations = pgTable(
  "attestations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fromAgent: text("from_agent").notNull(),
    toAgent: text("to_agent").notNull(),
    sentiment: text("sentiment").notNull(),
    note: text("note"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("attestations_pair_idx").on(t.fromAgent, t.toAgent), index("attestations_to_idx").on(t.toAgent, t.createdAt)],
);

export const trustSnapshots = pgTable(
  "trust_snapshots",
  {
    agentId: text("agent_id").notNull(),
    hourKey: text("hour_key").notNull(),
    trust: real("trust").notNull(),
    components: jsonb("components").$type<Record<string, number>>().notNull().default({}),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.hourKey] })],
);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const agentSensorEvents = pgTable(
  "agent_sensor_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: text("agent_id"),
    ownerWallet: text("owner_wallet"),
    ip: text("ip"),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("info"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_sensor_agent_idx").on(t.agentId, t.createdAt), index("agent_sensor_kind_idx").on(t.kind, t.createdAt)],
);

export const agentStrikes = pgTable(
  "agent_strikes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: text("agent_id").notNull(),
    kind: text("kind").notNull(),
    weight: integer("weight").notNull().default(1),
    messageId: bigint("message_id", { mode: "number" }),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    clearedAt: ts("cleared_at"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("agent_strikes_agent_idx").on(t.agentId, t.createdAt)],
);

export const tokenTakes = pgTable("token_takes", {
  tokenKey: text("token_key").primaryKey(),
  text: text("text").notNull(),
  model: text("model").notNull(),
  agentId: text("agent_id"),
  fingerprint: text("fingerprint"),
  trigger: text("trigger"),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export const askCache = pgTable(
  "ask_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    tokenKey: text("token_key").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    model: text("model").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("ask_cache_created_idx").on(t.createdAt)],
);

export const agentSchedulerState = pgTable("agent_scheduler_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

export type AgentRow = typeof agents.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
