// Migration check for 100_platform.sql (spl_config single row incl. a hand-made legacy table, switch seeds).
// Creates throwaway databases next to the one in DATABASE_URL (needs CREATEDB), applies server/migrations/*.sql
// exactly like server/migrate.ts (one multi-statement query per file) and drops them again.
//
//   DATABASE_URL=postgres://claudio:claudio@localhost:55440/c_launch npx tsx server/platform/migration.check.ts
import { readdirSync, readFileSync } from "fs";
import path from "path";
import pg from "pg";

const base = process.env.DATABASE_URL;
if (!base) {
  console.log("DATABASE_URL not set — skipping");
  process.exit(0);
}
let failures = 0;
function ok(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}
const DIR = path.resolve(process.cwd(), "server/migrations");
const files = readdirSync(DIR).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
const urlFor = (db: string) => base.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

async function withDb(name: string, fn: (c: pg.Client) => Promise<void>) {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const db = `c_migcheck_${name}_${process.pid}`;
  await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  await admin.query(`CREATE DATABASE ${db}`);
  const c = new pg.Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    await admin.end();
  }
}

async function migrateAll(c: pg.Client, only?: (f: string) => boolean) {
  for (const f of files) if (!only || only(f)) await c.query(readFileSync(path.join(DIR, f), "utf8"));
}
const rows = async (c: pg.Client, sql: string) => (await c.query(sql)).rows;
const tables = async (c: pg.Client) => (await rows(c, `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).map((r) => r.table_name as string);
const CLAUDIO = "2j5SaS7xy776qCBpyPQbZjyQSAtKiFgrwjfErthnW2ZM";

async function main() {
  console.log("\nfresh database");
  await withDb("fresh", async (c) => {
    await migrateAll(c);
    const s = await rows(c, `SELECT * FROM spl_config`);
    ok(s.length === 1 && s[0].key === "claudio" && s[0].mint === CLAUDIO && s[0].symbol === "CLAUDIO" && s[0].decimals === 6 && s[0].chain === "solana", "exactly the claudio row");
    ok(!(await tables(c)).some((t) => t.startsWith("spl_config_legacy")), "no legacy table");
    let refused = false;
    try {
      await c.query(`INSERT INTO spl_config (key, mint, symbol, name) VALUES ('other','x','X','X')`);
    } catch {
      refused = true;
    }
    ok(refused, "a second row is refused by the CHECK constraint");
    const pads = await rows(c, `SELECT launchpad, chain, state, allow_agents FROM launchpad_status`);
    const pump = pads.find((p) => p.launchpad === "pump" && p.chain === "sol");
    ok(pump?.state === "open" && pump.allow_agents === true, "pump/sol seeded open + allow agents");
    ok(pads.find((p) => p.launchpad === "stonkfun")?.state === "hidden", "stonkfun hidden");
    ok(pads.filter((p) => !(p.launchpad === "pump" && p.chain === "sol") && p.launchpad !== "stonkfun").every((p) => p.state === "coming_soon"), "every other deployment coming_soon");
    const chains = await rows(c, `SELECT chain, state FROM chain_status`);
    ok(chains.length === 5 && chains.every((x) => (x.chain === "sol") === (x.state === "open")), "sol open, other chains coming_soon");
    const cols = (await rows(c, `SELECT column_name FROM information_schema.columns WHERE table_name='launches'`)).map((r) => r.column_name);
    ok(["agent_id", "launched_by", "fee_route"].every((x) => cols.includes(x)), "launches has agent_id / launched_by / fee_route");
    { const t = await tables(c); ok(["collector_runs", "collector_payouts", "chain_status", "launchpad_status"].every((x) => t.includes(x)), "collector + switch tables exist"); }

    // Admin edits survive a re-run of the seed (ON CONFLICT DO NOTHING) — e.g. a database first built by db:push.
    await c.query(`UPDATE launchpad_status SET state='coming_soon', note='paused' WHERE launchpad='pump'`);
    await c.query(`UPDATE chain_status SET state='view_only' WHERE chain='sol'`);
    await migrateAll(c, (f) => f.startsWith("100_"));
    ok((await rows(c, `SELECT state, note FROM launchpad_status WHERE launchpad='pump'`))[0].note === "paused", "re-run keeps admin launchpad edits");
    ok((await rows(c, `SELECT state FROM chain_status WHERE chain='sol'`))[0].state === "view_only", "re-run keeps admin chain edits");
    ok((await rows(c, `SELECT count(*)::int n FROM spl_config`))[0].n === 1, "re-run is idempotent for spl_config");
  });

  console.log("\nproduction-style hand-made spl_config (3 rows, unknown columns)");
  await withDb("legacy", async (c) => {
    await migrateAll(c, (f) => f < "100_");
    await c.query(`CREATE TABLE spl_config (id serial primary key, token_name text, address text, ticker text, enabled boolean default true);
      INSERT INTO spl_config (token_name, address, ticker) VALUES ('Claudio','${CLAUDIO}','CLAUDIO'),('Old','So11111111111111111111111111111111111111112','WSOL'),('Test','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','USDC')`);
    await migrateAll(c, (f) => f >= "100_");
    const legacy = await rows(c, `SELECT * FROM spl_config_legacy ORDER BY id`);
    ok(legacy.length === 3 && legacy[1].ticker === "WSOL", "old table kept as spl_config_legacy with all 3 rows and its columns");
    const s = await rows(c, `SELECT * FROM spl_config`);
    ok(s.length === 1 && s[0].key === "claudio" && s[0].mint === CLAUDIO, "new spl_config has exactly the claudio row");
  });

  console.log("\nhand-made spl_config that already has the expected columns (3 rows)");
  await withDb("samecols", async (c) => {
    await migrateAll(c, (f) => f < "100_");
    await c.query(`CREATE TABLE spl_config (key text, chain text, mint text, symbol text, name text, decimals int, extra text);
      INSERT INTO spl_config VALUES ('claudio','solana','WRONGMINT','CLAUD','Claud',9,'x'),('bonus','solana','m2','B','B',6,'y'),('claudio','solana','dup','C','C',6,'z')`);
    await migrateAll(c, (f) => f >= "100_");
    const s = await rows(c, `SELECT key, mint, symbol, decimals, extra FROM spl_config`);
    ok(s.length === 1 && s[0].mint === CLAUDIO && s[0].symbol === "CLAUDIO" && s[0].decimals === 6, "other keys + duplicates removed, claudio row upserted to the official values");
    ok(!(await tables(c)).includes("spl_config_legacy"), "not renamed (columns matched)");
  });

  console.log("\nlegacy name already taken");
  await withDb("taken", async (c) => {
    await migrateAll(c, (f) => f < "100_");
    await c.query(`CREATE TABLE spl_config_legacy (a int); CREATE TABLE spl_config (id int, address text); INSERT INTO spl_config VALUES (1,'a'),(2,'b'),(3,'c')`);
    await migrateAll(c, (f) => f >= "100_");
    const t = await tables(c);
    const renamed = t.find((x) => /^spl_config_legacy_\d+$/.test(x));
    ok(!!renamed, `renamed to ${renamed}`);
    ok(renamed && (await rows(c, `SELECT count(*)::int n FROM ${renamed}`))[0].n === 3, "its 3 rows kept");
    ok((await rows(c, `SELECT count(*)::int n FROM spl_config`))[0].n === 1, "new spl_config has one row");
  });
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} failure(s)` : "\nmigrations: all checks passed");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
