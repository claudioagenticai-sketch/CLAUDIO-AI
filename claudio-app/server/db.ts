// Optional Postgres. Returns null when DATABASE_URL is not set so the board/launch features run in-memory
// (dev, previews). Agents, the thread, hosted wallets and admin login need it (see features in /api/platform/config).
//
// Replit's database is Neon → the Neon serverless driver (WebSocket). A plain local Postgres (localhost /
// 127.0.0.1, e.g. the embedded one used for local tests) can't speak that protocol, so it gets node-postgres.
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL?.trim();
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

/** Minimal surface both drivers share (used by migrations and raw queries). */
export interface QueryPool {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

async function connect() {
  if (!url) return { pool: null, db: null };
  if (local) {
    const pg = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new pg.default.Pool({ connectionString: url, max: 10 });
    return { pool: pool as unknown as QueryPool, db: drizzle(pool, { schema }) as unknown as ReturnType<typeof drizzleNeon<typeof schema>> };
  }
  const pool = new NeonPool({ connectionString: url });
  return { pool: pool as unknown as QueryPool, db: drizzleNeon({ client: pool, schema }) };
}

const conn = await connect();
export const pool: QueryPool | null = conn.pool;
export const db = conn.db;
