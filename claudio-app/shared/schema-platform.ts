// Drizzle tables for the platform workstream — chain_status, launchpad_status, spl_config, collector tables (migrations 100–199).
// Keep in sync with the matching server/migrations/*.sql files. (The launches columns agent_id / launched_by / fee_route
// added by 100_platform.sql are declared on `launches` in shared/schema.ts.)
import { pgTable, text, integer, bigint, bigserial, timestamp, jsonb, boolean, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";

/** Admin switch per chain: open | view_only | coming_soon. */
export const chainStatus = pgTable("chain_status", {
  chain: text("chain").primaryKey(),
  state: text("state").notNull().default("coming_soon"),
  note: text("note"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Admin switch per launchpad deployment: open | coming_soon | hidden, and whether agents may launch there. */
export const launchpadStatus = pgTable(
  "launchpad_status",
  {
    launchpad: text("launchpad").notNull(),
    chain: text("chain").notNull(),
    state: text("state").notNull().default("coming_soon"),
    allowAgents: boolean("allow_agents").notNull().default(false),
    note: text("note"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.launchpad, t.chain] })],
);

/** Exactly one row (key = 'claudio', CHECK constraint): the official $CLAUDIO token. */
export const splConfig = pgTable("spl_config", {
  key: text("key").primaryKey(),
  chain: text("chain").notNull().default("solana"),
  mint: text("mint").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  decimals: integer("decimals").notNull().default(6),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One pass of the Solana fee collector (server/platform/collector.ts). */
export const collectorRuns = pgTable(
  "collector_runs",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").notNull().default("timer"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    coinsChecked: integer("coins_checked").notNull().default(0),
    distributed: integer("distributed").notNull().default(0),
    paidLamports: bigint("paid_lamports", { mode: "number" }).notNull().default(0),
    txs: jsonb("txs").$type<string[]>().notNull().default([]),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    dryRun: boolean("dry_run").notNull().default(false),
  },
  (t) => [index("collector_runs_started_idx").on(t.startedAt)],
);

/** One distribute_creator_fees_v2 payout of one coin's creator vault. */
export const collectorPayouts = pgTable(
  "collector_payouts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id"),
    launchId: text("launch_id"),
    tokenKey: text("token_key").notNull(),
    tx: text("tx").notNull(),
    amountLamports: bigint("amount_lamports", { mode: "number" }).notNull(),
    recipients: jsonb("recipients").$type<{ address: string; bps: number; lamports: number }[]>().notNull().default([]),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("collector_payouts_tx_token_uidx").on(t.tx, t.tokenKey),
    index("collector_payouts_token_idx").on(t.tokenKey, t.at),
    index("collector_payouts_at_idx").on(t.at),
  ],
);
