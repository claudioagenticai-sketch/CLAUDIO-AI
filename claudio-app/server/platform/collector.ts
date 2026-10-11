// Solana fee collector: pays out the creator fees of Claudio's pump.fun launches to their shareholders, so creators
// (and hosted agents) never have to press "Harvest".
//
//   COLLECTOR_KEY              hot wallet secret (base58 64-byte secret, or a JSON array). Only pays tx fees.
//   COLLECTOR_INTERVAL_MIN     180   minutes between passes
//   COLLECTOR_MIN_SOL          0.05  only distribute a coin whose claimable fees reach this
//   COLLECTOR_ALERT_SOL        0.05  low-balance alert below this (audit + optional ALERT_WEBHOOK_URL)
//   COLLECTOR_PRIORITY_MICROLAMPORTS 50000
//   ALERT_WEBHOOK_URL          POST {content, text} (Discord / Slack compatible)
//
// One pass: every CONFIRMED Solana pump.fun launch → read its sharing config, bonding curve, creator vault and (for
// graduated coins) the PumpSwap creator vault. A coin is paid out only when its sharing config is exactly the planned
// route (creator-or-escrow 70% / PLATFORM_FEE_WALLET_SOL 30%, admin revoked) and claimable ≥ COLLECTOR_MIN_SOL:
// graduated coins first run transfer_creator_fees_to_pump_v2 (pump_amm, permissionless) to move PumpSwap creator fees
// into the curve vault, then distribute_creator_fees_v2 (pump, permissionless) with the collector as payer. 2–3 coins
// per transaction when it fits. Both instructions can only move fees to the on-chain shareholders; the bot never
// touches funds otherwise. Without COLLECTOR_KEY it is disabled (an admin can still run a read-only dry pass).
import { ComputeBudgetProgram, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { nanoid } from "nanoid";
import type { CollectorPayoutRow, CollectorRunSummary, CollectorStatus } from "@shared/platform";
import { pool } from "../db";
import { audit } from "../auth/audit";
import { recordAgentPayout } from "../hosted";
import { checkSharingConfig, expectedRoute } from "../launch/adapters/pump";
import { launchEnv } from "../launch/env";
import { compileTx, simulateSol, solConnection } from "../launch/sol";
import { launchStore } from "../launch/store";
import type { LaunchRecord } from "../launch/types";
import { WSOL, decodeBondingCurve, decodeSharingConfig, distributeCreatorFeesV2Ix, pumpPda, transferCreatorFeesToPumpV2Ix } from "../launch/pump/ixs";

/** Rent-exempt minimum of a 0-byte system account: the creator vault keeps this much. */
export const RENT_EXEMPT_EMPTY = 890_880;
/**
 * distribute_creator_fees_v2 is a no-op below this vault balance ("Insufficient fees for distribution. Minimum vault
 * balance needed: 3860480 lamports", observed in the mainnet-fork replay 2026-10-07; get_minimum_distributable_fee).
 */
export const MIN_DISTRIBUTABLE_VAULT = 3_860_480;
const LAMPORTS = 1e9;

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

export const collectorEnv = {
  intervalMin: () => Math.max(5, num("COLLECTOR_INTERVAL_MIN", 180)),
  minSol: () => num("COLLECTOR_MIN_SOL", 0.05),
  alertSol: () => num("COLLECTOR_ALERT_SOL", 0.05),
  priority: () => Math.floor(num("COLLECTOR_PRIORITY_MICROLAMPORTS", 50_000)),
};

/** Parses COLLECTOR_KEY. Never logs or returns the secret. */
export function loadCollectorKey(raw = process.env.COLLECTOR_KEY): { kp: Keypair | null; reason: string | null } {
  const v = raw?.trim();
  if (!v) return { kp: null, reason: "COLLECTOR_KEY not set" };
  try {
    let bytes: Uint8Array;
    if (v.startsWith("[")) bytes = Uint8Array.from(JSON.parse(v) as number[]);
    else bytes = bs58.decode(v);
    if (bytes.length === 64) return { kp: Keypair.fromSecretKey(bytes), reason: null };
    if (bytes.length === 32) return { kp: Keypair.fromSeed(bytes), reason: null };
    return { kp: null, reason: "COLLECTOR_KEY must be a 64-byte secret key (base58 or JSON array)" };
  } catch {
    return { kp: null, reason: "COLLECTOR_KEY could not be parsed (base58 or JSON array expected)" };
  }
}

// ─── Selection (pure — see collector.check.ts) ──────────────────────

export interface CoinReading {
  launch: Pick<LaunchRecord, "id" | "token" | "feeRoute" | "meta" | "request" | "symbol" | "agentId">;
  mint: string;
  /** Decoded sharing config, or null when missing. */
  cfg: ReturnType<typeof decodeSharingConfig>;
  /** Bonding curve decoded (null when missing). */
  curve: ReturnType<typeof decodeBondingCurve>;
  /** Lamports in the pump creator vault ["creator-vault", sharing_config]. */
  vaultLamports: number;
  /** wSOL amount (lamports) in the PumpSwap creator vault ATA; null when that account doesn't exist. */
  ammVaultLamports: number | null;
}

export interface CoinDecision {
  reading: CoinReading;
  action: "distribute" | "skip";
  /** Graduated coin with PumpSwap fees: sweep them into the curve vault first. */
  sweep: boolean;
  /** Lamports that will be paid out (curve vault above rent + swept AMM fees). */
  claimable: number;
  reason?: string;
  /** Split route mismatch — the coin is never touched and the admin is alerted. */
  mismatch?: boolean;
}

export function decideCoin(r: CoinReading, minLamports: number): CoinDecision {
  const base = { reading: r, sweep: false, claimable: 0 };
  // Launches planned before the fee route was recorded (pre-migration 100) used an env-configured platform address:
  // leave them alone (no alarm) — the owner can still harvest them from the Creator page.
  if (!r.launch.feeRoute && !r.launch.meta.platform) return { ...base, action: "skip", reason: "legacy launch without a recorded fee route" };
  if (!r.cfg) return { ...base, action: "skip", reason: "no sharing config" };
  const check = checkSharingConfig(r.cfg, expectedRoute(r.launch as LaunchRecord));
  if (!check.ok) return { ...base, action: "skip", reason: `split mismatch: ${check.reason}`, mismatch: true };
  if (!r.curve) return { ...base, action: "skip", reason: "no bonding curve" };
  if (!r.curve.creator.equals(pumpPda.sharingConfig(new PublicKey(r.mint)))) {
    return { ...base, action: "skip", reason: "bonding curve creator is not the sharing config (CTO / reset?)", mismatch: true };
  }
  const curveClaim = Math.max(0, r.vaultLamports - RENT_EXEMPT_EMPTY);
  const amm = r.curve.complete && r.ammVaultLamports && r.ammVaultLamports > 0 ? r.ammVaultLamports : 0;
  const claimable = curveClaim + amm;
  if (r.vaultLamports + amm < MIN_DISTRIBUTABLE_VAULT) {
    return { ...base, claimable, action: "skip", reason: `below pump.fun's minimum distributable vault balance (${MIN_DISTRIBUTABLE_VAULT} lamports)` };
  }
  if (claimable < minLamports) return { ...base, sweep: false, claimable, action: "skip", reason: `below minimum (${(claimable / LAMPORTS).toFixed(4)} SOL)` };
  return { reading: r, action: "distribute", sweep: amm > 0, claimable };
}

/** Groups coins into transactions of up to `perTx` (2–3) — the caller shrinks a batch that doesn't fit. */
export function batches<T>(items: T[], perTx = 3): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perTx) out.push(items.slice(i, i + perTx));
  return out;
}

export function coinIxs(d: CoinDecision, payer: PublicKey): TransactionInstruction[] {
  const mint = new PublicKey(d.reading.mint);
  const ixs: TransactionInstruction[] = [];
  if (d.sweep) ixs.push(transferCreatorFeesToPumpV2Ix(mint, payer));
  ixs.push(distributeCreatorFeesV2Ix(mint, payer, d.reading.cfg!.shareholders.map((h) => h.address)));
  return ixs;
}

// ─── Readings ───────────────────────────────────────────────────────

/** Confirmed Solana pump.fun launches the collector may pay out. */
export async function collectableLaunches(): Promise<LaunchRecord[]> {
  const list = await launchStore.byStatus(["confirmed"], { chain: "sol", limit: 2_000 });
  return list.filter((l) => l.launchpad === "pump" && !!(l.token ?? l.meta.mint));
}

export async function readCoins(launches: LaunchRecord[]): Promise<CoinReading[]> {
  const conn = solConnection();
  const rows = launches.map((l) => {
    const mint = new PublicKey(l.token ?? l.meta.mint);
    const sharing = pumpPda.sharingConfig(mint);
    const vaultAuth = pumpPda.ammCreatorVaultAuthority(sharing);
    return {
      l,
      mint,
      keys: [sharing, pumpPda.bondingCurve(mint), pumpPda.creatorVault(sharing), getAssociatedTokenAddressSync(WSOL, vaultAuth, true, TOKEN_PROGRAM_ID)],
    };
  });
  const flat = rows.flatMap((r) => r.keys);
  const infos: Awaited<ReturnType<typeof conn.getMultipleAccountsInfo>> = [];
  for (let i = 0; i < flat.length; i += 100) infos.push(...(await conn.getMultipleAccountsInfo(flat.slice(i, i + 100), "confirmed")));
  return rows.map((r, i) => {
    const [cfgI, bcI, vaultI, ammI] = infos.slice(i * 4, i * 4 + 4);
    let amm: number | null = null;
    if (ammI && ammI.data.length >= 72) amm = Number(Buffer.from(ammI.data).readBigUInt64LE(64)); // SPL token account amount
    return {
      launch: r.l,
      mint: r.mint.toBase58(),
      cfg: cfgI ? decodeSharingConfig(Buffer.from(cfgI.data)) : null,
      curve: bcI ? decodeBondingCurve(Buffer.from(bcI.data)) : null,
      vaultLamports: vaultI?.lamports ?? 0,
      ammVaultLamports: amm,
    };
  });
}

// ─── State, runs, payouts ───────────────────────────────────────────

interface State {
  running: boolean;
  lastRun: CollectorRunSummary | null;
  nextRunAt: number | null;
  balanceSol: number | null;
  lastAlertAt: number;
  memRuns: CollectorRunSummary[];
  memPayouts: CollectorPayoutRow[];
}
const state: State = { running: false, lastRun: null, nextRunAt: null, balanceSol: null, lastAlertAt: 0, memRuns: [], memPayouts: [] };

function log(msg: string) {
  console.log(`${new Date().toLocaleTimeString("en-US", { hour12: true })} [collector] ${msg}`);
}

async function saveRun(run: CollectorRunSummary): Promise<void> {
  state.memRuns = [run, ...state.memRuns.filter((r) => r.id !== run.id)].slice(0, 50);
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO collector_runs (id, trigger, started_at, finished_at, coins_checked, distributed, paid_lamports, txs, errors, dry_run)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET finished_at = EXCLUDED.finished_at, coins_checked = EXCLUDED.coins_checked, distributed = EXCLUDED.distributed,
         paid_lamports = EXCLUDED.paid_lamports, txs = EXCLUDED.txs, errors = EXCLUDED.errors`,
      [run.id, run.trigger, run.startedAt, run.finishedAt, run.coinsChecked, run.distributed, run.paidLamports, JSON.stringify(run.txs), JSON.stringify(run.errors), run.dryRun],
    );
  } catch (e) {
    log(`run save failed: ${(e as Error).message}`);
  }
}

/** Tells server/hosted about lamports paid to an agent escrow (idempotent on its side). */
async function notifyAgentPayout(p: CollectorPayoutRow, escrow: string | undefined, agentId: string | undefined): Promise<void> {
  if (!escrow || !agentId) return;
  const r = p.recipients.find((x) => x.address === escrow);
  if (!r) return;
  try {
    await recordAgentPayout(agentId, { signature: p.tx, amountSol: r.lamports / LAMPORTS, source: "collector" });
  } catch (e) {
    log(`recordAgentPayout failed: ${(e as Error).message}`);
  }
}

async function savePayout(p: CollectorPayoutRow, runId: string): Promise<void> {
  state.memPayouts = [p, ...state.memPayouts].slice(0, 200);
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO collector_payouts (run_id, launch_id, token_key, tx, amount_lamports, recipients, at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tx, token_key) DO NOTHING`,
      [runId, p.launchId, p.tokenKey, p.tx, p.amountLamports, JSON.stringify(p.recipients), p.at],
    );
  } catch (e) {
    log(`payout save failed: ${(e as Error).message}`);
  }
}

const runFromRow = (r: any): CollectorRunSummary => ({
  id: r.id,
  trigger: r.trigger,
  startedAt: new Date(r.started_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  coinsChecked: Number(r.coins_checked),
  distributed: Number(r.distributed),
  paidLamports: Number(r.paid_lamports),
  txs: r.txs ?? [],
  errors: r.errors ?? [],
  dryRun: !!r.dry_run,
});

export async function recentRuns(limit = 20): Promise<CollectorRunSummary[]> {
  if (pool) {
    try {
      const r = await pool.query(`SELECT * FROM collector_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
      return r.rows.map(runFromRow);
    } catch {
      /* fall back to memory */
    }
  }
  return state.memRuns.slice(0, limit);
}

export async function recentPayouts(limit = 50): Promise<CollectorPayoutRow[]> {
  if (pool) {
    try {
      const r = await pool.query(`SELECT * FROM collector_payouts ORDER BY at DESC LIMIT $1`, [limit]);
      return r.rows.map((p: any) => ({
        id: String(p.id),
        launchId: p.launch_id,
        tokenKey: p.token_key,
        tx: p.tx,
        amountLamports: Number(p.amount_lamports),
        recipients: p.recipients ?? [],
        at: new Date(p.at).toISOString(),
      }));
    } catch {
      /* fall back to memory */
    }
  }
  return state.memPayouts.slice(0, limit);
}

/** Payouts of one token (agents workstream: TokenAgentInfo.fees.payouts). */
export async function payoutsForToken(tokenKey: string, limit = 20): Promise<CollectorPayoutRow[]> {
  return (await recentPayouts(500)).filter((p) => p.tokenKey === tokenKey).slice(0, limit);
}

async function totals(): Promise<CollectorStatus["totals"]> {
  if (pool) {
    try {
      const [r, p] = await Promise.all([
        pool.query(`SELECT count(*)::int AS n FROM collector_runs`),
        pool.query(`SELECT count(*)::int AS n, coalesce(sum(amount_lamports), 0)::bigint AS s FROM collector_payouts`),
      ]);
      return { runs: r.rows[0].n, payouts: p.rows[0].n, paidOutSol: Number(p.rows[0].s) / LAMPORTS };
    } catch {
      /* memory */
    }
  }
  return {
    runs: state.memRuns.length,
    payouts: state.memPayouts.length,
    paidOutSol: state.memPayouts.reduce((a, p) => a + p.amountLamports, 0) / LAMPORTS,
  };
}

async function refreshBalance(kp: Keypair | null): Promise<number | null> {
  if (!kp) return null;
  try {
    state.balanceSol = (await solConnection().getBalance(kp.publicKey, "confirmed")) / LAMPORTS;
  } catch {
    /* keep last */
  }
  return state.balanceSol;
}

async function alertLowBalance(wallet: string, balanceSol: number): Promise<void> {
  if (Date.now() - state.lastAlertAt < 6 * 3600_000) return;
  state.lastAlertAt = Date.now();
  const text = `Claudio fee collector is low on SOL: ${balanceSol.toFixed(4)} SOL in ${wallet} (alert below ${collectorEnv.alertSol()} SOL). Top it up so creator fees keep being paid out.`;
  audit({ actor: "collector", action: "collector.low_balance", target: wallet, severity: "warn", detail: { balanceSol, alertBelowSol: collectorEnv.alertSol() } });
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    log(`alert webhook failed: ${(e as Error).message}`);
  }
}

export async function collectorStatus(): Promise<CollectorStatus> {
  const { kp, reason } = loadCollectorKey();
  const balance = kp ? (state.balanceSol ?? (await refreshBalance(kp))) : null;
  const last = state.lastRun ?? (await recentRuns(1))[0] ?? null;
  return {
    enabled: !!kp,
    reason,
    wallet: kp?.publicKey.toBase58() ?? null,
    balanceSol: balance,
    lowBalance: balance !== null && balance < collectorEnv.alertSol(),
    alertBelowSol: collectorEnv.alertSol(),
    minSol: collectorEnv.minSol(),
    intervalMin: collectorEnv.intervalMin(),
    running: state.running,
    lastRun: last,
    nextRunAt: state.nextRunAt ? new Date(state.nextRunAt).toISOString() : null,
    totals: await totals(),
  };
}

// ─── One pass ───────────────────────────────────────────────────────

async function sendBatch(kp: Keypair, group: CoinDecision[]): Promise<string> {
  const conn = solConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const units = Math.min(1_400_000, group.reduce((a, d) => a + 120_000 + (d.sweep ? 80_000 : 0), 20_000));
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: collectorEnv.priority() }),
    ...group.flatMap((d) => coinIxs(d, kp.publicKey)),
  ];
  let lut = null;
  const lutAddr = launchEnv.pumpLut();
  if (lutAddr) lut = (await conn.getAddressLookupTable(new PublicKey(lutAddr)).catch(() => null))?.value ?? null;
  const c = compileTx(kp.publicKey, blockhash, ixs, lut, [kp]);
  if (!c) throw new Error("too_large");
  const sim = await simulateSol(c.tx);
  if (!sim.ok) throw new Error(`simulation failed: ${sim.error}`);
  const sig = await conn.sendRawTransaction(c.bytes, { skipPreflight: false, maxRetries: 3 });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export async function runCollector(trigger: CollectorRunSummary["trigger"], opts: { dryRun?: boolean } = {}): Promise<CollectorRunSummary> {
  const { kp } = loadCollectorKey();
  const dryRun = !!opts.dryRun || !kp;
  const run: CollectorRunSummary = {
    id: nanoid(12),
    trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    coinsChecked: 0,
    distributed: 0,
    paidLamports: 0,
    txs: [],
    errors: [],
    dryRun,
  };
  if (state.running) {
    run.errors.push("a pass is already running");
    run.finishedAt = run.startedAt;
    return run;
  }
  state.running = true;
  try {
    await saveRun(run);
    if (kp) {
      const bal = await refreshBalance(kp);
      if (bal !== null && bal < collectorEnv.alertSol()) await alertLowBalance(kp.publicKey.toBase58(), bal);
    }
    const launches = await collectableLaunches();
    const readings = await readCoins(launches);
    run.coinsChecked = readings.length;
    const minLamports = Math.floor(collectorEnv.minSol() * LAMPORTS);
    const decisions = readings.map((r) => decideCoin(r, minLamports));
    for (const d of decisions.filter((x) => x.mismatch)) {
      audit({ actor: "collector", action: "collector.split_mismatch", target: `sol:${d.reading.mint}`, severity: "high", detail: { launchId: d.reading.launch.id, reason: d.reason } });
    }
    const todo = decisions.filter((d) => d.action === "distribute");
    if (dryRun) {
      run.errors.push(...todo.map((d) => `dry run: would distribute ${(d.claimable / LAMPORTS).toFixed(4)} SOL of $${d.reading.launch.symbol}${d.sweep ? " (after PumpSwap sweep)" : ""}`));
    } else {
      const queue = batches(todo, 3);
      while (queue.length) {
        const group = queue.shift()!;
        try {
          const sig = await sendBatch(kp!, group);
          run.txs.push(sig);
          // What actually left each vault (the estimate can be off; a no-op distribute pays nothing).
          const vaults = group.map((d) => pumpPda.creatorVault(pumpPda.sharingConfig(new PublicKey(d.reading.mint))));
          const after = await solConnection().getMultipleAccountsInfo(vaults, "confirmed").catch(() => null);
          for (const [i, d] of group.entries()) {
            const left = after?.[i]?.lamports;
            const amm = d.sweep ? d.reading.ammVaultLamports ?? 0 : 0;
            if (left !== undefined) d.claimable = Math.max(0, d.reading.vaultLamports + amm - left);
            if (d.claimable <= 0) {
              run.errors.push(`$${d.reading.launch.symbol}: distribute landed (${sig}) but paid nothing`);
              continue;
            }
            run.distributed += 1;
            run.paidLamports += d.claimable;
            const totalBps = d.reading.cfg!.shareholders.reduce((a, h) => a + h.bps, 0) || 10_000;
            const payout: CollectorPayoutRow = {
              id: nanoid(10),
              launchId: d.reading.launch.id,
              tokenKey: `sol:${d.reading.mint}`,
              tx: sig,
              amountLamports: d.claimable,
              recipients: d.reading.cfg!.shareholders.map((h) => ({ address: h.address.toBase58(), bps: h.bps, lamports: Math.floor((d.claimable * h.bps) / totalBps) })),
              at: new Date().toISOString(),
            };
            await savePayout(payout, run.id);
            if (d.reading.launch.feeRoute?.creator.kind === "agent") {
              await notifyAgentPayout(payout, d.reading.launch.feeRoute.creator.address, d.reading.launch.agentId);
            }
          }
        } catch (e) {
          const msg = (e as Error).message;
          if (group.length > 1) {
            // Too large or one coin failing the simulation: retry the coins one by one.
            for (const d of group) queue.unshift([d]);
            continue;
          }
          run.errors.push(`$${group[0].reading.launch.symbol} (${group[0].reading.mint.slice(0, 6)}…): ${msg}`);
        }
      }
    }
    if (kp) await refreshBalance(kp);
  } catch (e) {
    run.errors.push((e as Error).message);
  } finally {
    state.running = false;
    run.finishedAt = new Date().toISOString();
    state.lastRun = run;
    await saveRun(run);
  }
  log(`${trigger} pass${dryRun ? " (dry run)" : ""}: ${run.coinsChecked} coins, ${run.distributed} paid out, ${(run.paidLamports / LAMPORTS).toFixed(4)} SOL, ${run.errors.length} notes`);
  if (run.distributed || run.errors.length) {
    audit({ actor: "collector", action: "collector.run", severity: run.errors.length && !dryRun ? "warn" : "info", detail: { id: run.id, trigger, distributed: run.distributed, paidLamports: run.paidLamports, txs: run.txs, errors: run.errors.slice(0, 10), dryRun } });
  }
  return run;
}

let timer: NodeJS.Timeout | null = null;

export function startCollectorBot(): void {
  if (timer) return;
  const { kp, reason } = loadCollectorKey();
  if (!kp) {
    log(`disabled (${reason})`);
    return;
  }
  const every = collectorEnv.intervalMin() * 60_000;
  const tick = () => {
    state.nextRunAt = Date.now() + every;
    void runCollector("timer").catch((e) => log((e as Error).message));
  };
  // First pass shortly after boot (lets migrations / RPC settle), then every interval.
  state.nextRunAt = Date.now() + 90_000;
  setTimeout(() => {
    tick();
    timer = setInterval(tick, every);
    timer.unref?.();
  }, 90_000).unref?.();
  log(`enabled: wallet ${kp.publicKey.toBase58()}, every ${collectorEnv.intervalMin()} min, min ${collectorEnv.minSol()} SOL`);
}
