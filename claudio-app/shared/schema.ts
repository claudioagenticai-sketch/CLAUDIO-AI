// Postgres schema (Drizzle). Board/launch persistence is optional (in-memory without DATABASE_URL); agents, the
// thread, hosted wallets and admin login need it. Tables are created at boot by server/migrations/*.sql —
// keep each table here in sync with its SQL. Area files: schema-platform (100s), schema-agents (200s),
// schema-hosted (300s).
import { pgTable, text, integer, bigint, bigserial, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

export * from "./schema-platform";
export * from "./schema-agents";
export * from "./schema-hosted";
export * from "./schema-mcp";

/** Every launch prepared/confirmed through Claudio (drives the Creator dashboard + fee harvesting). */
export const launches = pgTable(
  "launches",
  {
    id: text("id").primaryKey(), // nanoid
    chain: text("chain").notNull(),
    launchpad: text("launchpad").notNull(),
    creator: text("creator").notNull(),
    token: text("token"), // set once confirmed
    splitter: text("splitter"),
    splitKind: text("split_kind").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    imageUri: text("image_uri"),
    metadataUri: text("metadata_uri"),
    txHashes: jsonb("tx_hashes").$type<string[]>().default([]),
    status: text("status").notNull().default("prepared"), // prepared | submitted | confirmed | failed
    referralCode: text("referral_code"),
    /** Set when the creator share goes to a social account instead of the launcher: "x:44196397". */
    beneficiaryIdentity: text("beneficiary_identity"),
    /** That identity's SocialVault (EVM) / escrow (Solana) address on this chain. */
    beneficiaryVault: text("beneficiary_vault"),
    /** Agent the launch belongs to (hosted: creator share → its escrow). Migration 100. */
    agentId: text("agent_id"),
    /** "human" | "agent". Migration 100. */
    launchedBy: text("launched_by").default("human"),
    /** Planned on-chain fee route: { creator: { address, bps, kind, agentSlug? }, platform: { address, bps } }. Migration 100. */
    feeRoute: jsonb("fee_route"),
    request: jsonb("request").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("launches_creator_idx").on(t.creator),
    index("launches_token_idx").on(t.token),
    index("launches_beneficiary_idx").on(t.beneficiaryIdentity),
  ],
);

/** Dev reputation across chains (creator → launches / migrations / rugs). */
export const devStats = pgTable("dev_stats", {
  creator: text("creator").primaryKey(),
  launches: integer("launches").notNull().default(0),
  migrations: integer("migrations").notNull().default(0),
  rugs: integer("rugs").notNull().default(0),
  chains: jsonb("chains").$type<string[]>().default([]),
  lastSeen: bigint("last_seen", { mode: "number" }),
});

/** Referral codes: share of our 30% platform fee goes to the referrer. */
export const referrals = pgTable("referrals", {
  code: text("code").primaryKey(),
  owner: text("owner").notNull(),
  shareBps: integer("share_bps").notNull().default(2000),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Social accounts fees can be routed to. Created when someone launches "for" a handle (resolved to the provider's
 * stable id at that moment) or when the owner signs in. Keyed by "provider:id", never by handle.
 */
export const socialIdentities = pgTable(
  "social_identities",
  {
    key: text("key").primaryKey(), // "x:44196397"
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    idHash: text("id_hash").notNull(), // keccak256(key), the on-chain vault key
    handle: text("handle"), // last known, display only
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    /** The owner asked not to receive launches (impersonation / opt-out). New launches to it are refused. */
    optedOut: boolean("opted_out").notNull().default(false),
    /** Set once the owner has signed in with this account at least once. */
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("social_identities_handle_idx").on(t.provider, t.handle)],
);

/** Which signed-in auth account (Auth0 or Clerk user) has proven control of which social identity. */
export const socialLinks = pgTable(
  "social_links",
  {
    id: text("id").primaryKey(), // nanoid
    authProvider: text("auth_provider").notNull(), // "auth0" | "clerk"
    authSubject: text("auth_subject").notNull(), // Auth0 `sub` / Clerk user id
    identityKey: text("identity_key").notNull(),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("social_links_subject_identity_idx").on(t.authProvider, t.authSubject, t.identityKey),
    index("social_links_identity_idx").on(t.identityKey),
  ],
);

/** Every claim attestation the server signed: an audit trail, and the guardian's review queue during the delay. */
export const socialClaims = pgTable(
  "social_claims",
  {
    id: text("id").primaryKey(), // nanoid
    identityKey: text("identity_key").notNull(),
    chain: text("chain").notNull(),
    wallet: text("wallet").notNull(),
    vault: text("vault").notNull(),
    authProvider: text("auth_provider").notNull(),
    authSubject: text("auth_subject").notNull(),
    nonce: text("nonce").notNull(),
    deadline: bigint("deadline", { mode: "number" }).notNull(),
    signature: text("signature").notNull(),
    status: text("status").notNull().default("signed"), // signed | submitted | pending | bound | cancelled | expired
    txHash: text("tx_hash"),
    ip: text("ip"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("social_claims_identity_idx").on(t.identityKey), index("social_claims_status_idx").on(t.status)],
);

// ─── wallet sign-in + audit (server/migrations/001_auth.sql) ──────────

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authSessions = pgTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  wallet: text("wallet").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  adminUntil: timestamp("admin_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor"),
  action: text("action").notNull(),
  target: text("target"),
  severity: text("severity").notNull().default("info"),
  detail: jsonb("detail").notNull().default({}),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Launch = typeof launches.$inferSelect;
export type NewLaunch = typeof launches.$inferInsert;
export type SocialIdentityRow = typeof socialIdentities.$inferSelect;
export type SocialClaimRow = typeof socialClaims.$inferSelect;
