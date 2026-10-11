// The single $CLAUDIO row (table spl_config, key 'claudio'; migration 100 guarantees exactly one row).
// Falls back to the compiled-in CLAUDIO_TOKEN without a database. Cached 15 s.
import { CLAUDIO_TOKEN, type SplConfigRow } from "@shared/platform";
import { pool } from "../db";

export interface SplConfigRecord {
  token: SplConfigRow;
  updatedBy: string | null;
  updatedAt: string | null;
}

const DEFAULT: SplConfigRecord = {
  token: { key: CLAUDIO_TOKEN.key, chain: "solana", mint: CLAUDIO_TOKEN.mint, symbol: CLAUDIO_TOKEN.symbol, name: CLAUDIO_TOKEN.name, decimals: CLAUDIO_TOKEN.decimals },
  updatedBy: null,
  updatedAt: null,
};

let mem: SplConfigRecord = DEFAULT;
let cache: { at: number; v: SplConfigRecord } | null = null;

export async function getSplConfig(): Promise<SplConfigRecord> {
  if (cache && Date.now() - cache.at < 15_000) return cache.v;
  let v = mem;
  if (pool) {
    try {
      const r = await pool.query(`SELECT key, chain, mint, symbol, name, decimals, updated_by, updated_at FROM spl_config WHERE key = 'claudio' LIMIT 1`);
      const row = r.rows[0];
      if (row) {
        v = {
          token: { key: row.key, chain: "solana", mint: row.mint, symbol: row.symbol, name: row.name, decimals: Number(row.decimals) },
          updatedBy: row.updated_by ?? null,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        };
      }
    } catch (e) {
      console.warn("[platform] spl_config read failed:", (e as Error).message);
    }
  }
  cache = { at: Date.now(), v };
  return v;
}

export async function setSplConfig(input: { mint: string; symbol: string; name: string; decimals: number }, actor: string): Promise<SplConfigRecord> {
  const next: SplConfigRecord = {
    token: { key: "claudio", chain: "solana", mint: input.mint, symbol: input.symbol, name: input.name, decimals: input.decimals },
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  };
  if (pool) {
    await pool.query(
      `INSERT INTO spl_config (key, chain, mint, symbol, name, decimals, updated_by, updated_at) VALUES ('claudio','solana',$1,$2,$3,$4,$5,now())
       ON CONFLICT (key) DO UPDATE SET mint = EXCLUDED.mint, symbol = EXCLUDED.symbol, name = EXCLUDED.name, decimals = EXCLUDED.decimals,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.mint, input.symbol, input.name, input.decimals, actor],
    );
  }
  mem = next;
  cache = null;
  return getSplConfig();
}
