// Boot-time SQL migrations: server/migrations/NNN_name.sql, applied once each in filename order and recorded in
// schema_migrations. Every statement is idempotent (CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) so a
// database first built with `drizzle-kit push` upgrades cleanly. Never edit an applied file — add a new one.
//
// Number ranges (one owner each, so parallel work never collides):
//   000–099 core/base · 100–199 platform (switches, spl_config, admin, collector, launches)
//   200–299 agents + thread · 300–399 hosted agents (escrow wallets, policies, runs) · 400–499 online MCP + OAuth
// shared/schema.ts (Drizzle) mirrors every table; keep both in sync.
import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";
import { pool } from "./db";
import { log } from "./vite";

const DIR = path.resolve(process.cwd(), "server/migrations");

let ran: Promise<void> | null = null;

/** Applies pending migrations once per process. Resolves immediately without a database. */
export function migrate(): Promise<void> {
  ran ??= run().catch((e) => {
    console.error("[migrate] failed:", (e as Error).message);
    throw e;
  });
  return ran;
}

async function run(): Promise<void> {
  if (!pool) return;
  if (!existsSync(DIR)) {
    log(`no ${DIR} — skipping migrations`, "migrate");
    return;
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const done = new Set((await pool.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name as string));
  const files = readdirSync(DIR)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(path.join(DIR, f), "utf8");
    // One parameterless multi-statement query runs as a single implicit transaction (simple query protocol),
    // so a failing file leaves nothing half-applied. (BEGIN/COMMIT via a pool could land on different clients.)
    try {
      await pool.query(sql);
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
    log(`applied ${f}`, "migrate");
  }
}
