// Escrow ledger: live balances (cached) and inflow detection. Every few minutes each escrow's new signatures are
// fetched, and the SOL delta of the escrow in each confirmed transaction is recorded once (unique per signature).
// A positive delta in a transaction that touches pump.fun / pump_fees / pump_amm is a creator-fee payout
// ("creator_fee"); any other positive delta is a plain "inflow". The collector can also report payouts directly
// (recordPayout), which is idempotent with the poller.
import type { AgentLedgerEntry, AgentLedgerKind } from "@shared/agents";
import { pool } from "../db";
import { primaryRpc } from "../rpc";
import { LAMPORTS } from "./config";

const PUMP_PROGRAMS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
]);

async function rpc<T>(method: string, params: unknown[], timeoutMs = 10_000): Promise<T> {
  const r = await fetch(primaryRpc("sol"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error || j.result === undefined) throw new Error(`rpc ${method}: ${j.error?.message ?? r.status}`);
  return j.result;
}

// ─── balances ────────────────────────────────────────────────────────

const balCache = new Map<string, { sol: number; at: number }>();

/** Cached ~60 s in memory, persisted on the wallet row; falls back to the last stored value when the RPC fails. */
export async function balanceOf(address: string, opts: { maxAgeMs?: number } = {}): Promise<{ sol: number | null; at: string | null }> {
  const hit = balCache.get(address);
  if (hit && Date.now() - hit.at < (opts.maxAgeMs ?? 60_000)) return { sol: hit.sol, at: new Date(hit.at).toISOString() };
  try {
    const v = await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }], 6_000);
    const sol = v.value / LAMPORTS;
    const now = Date.now();
    balCache.set(address, { sol, at: now });
    if (balCache.size > 10_000) balCache.clear();
    await pool?.query(`UPDATE agent_wallets SET balance_lamports = $2, balance_at = now() WHERE address = $1`, [address, v.value]).catch(() => {});
    return { sol, at: new Date(now).toISOString() };
  } catch {
    if (!pool) return { sol: null, at: null };
    const r = await pool.query(`SELECT balance_lamports, balance_at FROM agent_wallets WHERE address = $1`, [address]).catch(() => ({ rows: [] as any[] }));
    const row = r.rows[0];
    return row?.balance_lamports != null ? { sol: Number(row.balance_lamports) / LAMPORTS, at: new Date(row.balance_at).toISOString() } : { sol: null, at: null };
  }
}

// ─── ledger reads ────────────────────────────────────────────────────

export async function ledgerOf(agentId: string, limit = 50): Promise<{ entries: AgentLedgerEntry[]; earnedSol: number; totalInSol: number }> {
  if (!pool) return { entries: [], earnedSol: 0, totalInSol: 0 };
  const [rows, sums] = await Promise.all([
    pool.query(`SELECT id, kind, amount_sol, signature, source, COALESCE(block_time, created_at) AS at FROM agent_ledger WHERE agent_id = $1 ORDER BY id DESC LIMIT $2`, [agentId, limit]),
    pool.query(
      `SELECT COALESCE(sum(amount_sol) FILTER (WHERE kind = 'creator_fee'), 0) AS earned,
              COALESCE(sum(amount_sol) FILTER (WHERE kind IN ('creator_fee','inflow')), 0) AS total_in
       FROM agent_ledger WHERE agent_id = $1`,
      [agentId],
    ),
  ]);
  return {
    entries: rows.rows.map((x) => ({ id: Number(x.id), kind: x.kind as AgentLedgerKind, amountSol: Number(x.amount_sol), signature: x.signature, source: x.source, at: new Date(x.at).toISOString() })),
    earnedSol: Number(sums.rows[0]?.earned ?? 0),
    totalInSol: Number(sums.rows[0]?.total_in ?? 0),
  };
}

export async function earnedByAgent(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!pool) return out;
  const r = await pool.query(`SELECT agent_id, sum(amount_sol) AS s FROM agent_ledger WHERE kind = 'creator_fee' GROUP BY agent_id`);
  for (const x of r.rows) out.set(x.agent_id, Number(x.s));
  return out;
}

/** Idempotent record of a payout (e.g. reported by the collector right after it distributes creator fees). */
export async function recordPayout(agentId: string, p: { signature: string; amountSol: number; source?: string; at?: Date }): Promise<boolean> {
  if (!pool || !(p.amountSol > 0) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(p.signature)) return false;
  const r = await pool.query(
    `INSERT INTO agent_ledger (agent_id, address, kind, amount_sol, signature, source, block_time)
     SELECT agent_id, address, 'creator_fee', $2, $3, $4, $5 FROM agent_wallets WHERE agent_id = $1
     ON CONFLICT (agent_id, signature, kind) DO NOTHING RETURNING id`,
    [agentId, p.amountSol, p.signature, (p.source ?? "collector").slice(0, 40), p.at ?? null],
  );
  return !!r.rows[0];
}

// ─── inflow poller ───────────────────────────────────────────────────

interface ParsedTx {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; loadedAddresses?: { writable: string[]; readonly: string[] } } | null;
  transaction: { message: { accountKeys: ({ pubkey: string } | string)[]; instructions: { programId?: string }[] } };
}

/** Classifies one transaction for `address` → ledger row fields, or null when the address balance didn't change. */
export function classify(tx: ParsedTx, address: string): { kind: AgentLedgerKind; amountSol: number } | null {
  if (!tx.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const all = [...keys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const i = all.indexOf(address);
  if (i < 0) return null;
  const delta = (tx.meta.postBalances[i] ?? 0) - (tx.meta.preBalances[i] ?? 0);
  if (delta === 0) return null;
  const pump = all.some((k) => PUMP_PROGRAMS.has(k)) || tx.transaction.message.instructions.some((x) => x.programId && PUMP_PROGRAMS.has(x.programId));
  if (delta > 0) return { kind: pump ? "creator_fee" : "inflow", amountSol: delta / LAMPORTS };
  return { kind: "outflow", amountSol: delta / LAMPORTS };
}

async function pollWallet(agentId: string, address: string, lastSig: string | null): Promise<number> {
  const sigs = await rpc<{ signature: string; err: unknown }[]>("getSignaturesForAddress", [address, { limit: 50, ...(lastSig ? { until: lastSig } : {}), commitment: "confirmed" }]);
  if (!sigs.length) {
    await pool!.query(`UPDATE agent_wallets SET polled_at = now() WHERE agent_id = $1`, [agentId]);
    return 0;
  }
  let recorded = 0;
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const tx = await rpc<ParsedTx | null>("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null);
    if (!tx) continue;
    const c = classify(tx, address);
    if (!c) continue;
    // Our own live trades are recorded by the signer path as 'trade'; don't double count them as outflows.
    if (c.kind === "outflow") {
      const own = await pool!.query(`SELECT 1 FROM agent_ledger WHERE agent_id = $1 AND signature = $2 AND kind = 'trade'`, [agentId, s.signature]);
      if (own.rows[0]) continue;
    }
    const r = await pool!.query(
      `INSERT INTO agent_ledger (agent_id, address, kind, amount_sol, signature, source, slot, block_time) VALUES ($1,$2,$3,$4,$5,'chain',$6,$7)
       ON CONFLICT (agent_id, signature, kind) DO NOTHING RETURNING id`,
      [agentId, address, c.kind, c.amountSol, s.signature, tx.slot, tx.blockTime ? new Date(tx.blockTime * 1000) : null],
    );
    recorded += r.rows.length;
  }
  await pool!.query(`UPDATE agent_wallets SET last_signature = $2, polled_at = now() WHERE agent_id = $1`, [agentId, sigs[0].signature]);
  balCache.delete(address);
  return recorded;
}

let polling = false;

/** One pass over every escrow wallet (oldest-polled first, ≤ 40 per pass). One wallet's failure never stops it. */
export async function pollLedgers(): Promise<{ wallets: number; recorded: number; errors: number }> {
  if (!pool || polling) return { wallets: 0, recorded: 0, errors: 0 };
  polling = true;
  let recorded = 0;
  let errors = 0;
  try {
    const r = await pool.query(`SELECT agent_id, address, last_signature FROM agent_wallets ORDER BY polled_at NULLS FIRST LIMIT 40`);
    for (const w of r.rows) {
      try {
        recorded += await pollWallet(w.agent_id, w.address, w.last_signature);
      } catch {
        errors += 1;
      }
    }
    return { wallets: r.rows.length, recorded, errors };
  } finally {
    polling = false;
  }
}
