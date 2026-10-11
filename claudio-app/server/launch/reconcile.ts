// Launch reconciler: re-confirms launches the browser didn't finish confirming.
//   • submitted  → verify candidate hashes (if any) and re-run the adapter's confirm until confirmed / failed /
//                  unverified; after 24 h with nothing on-chain → failed.
//   • prepared   → Solana only, 1–15 min old: look for a landed tx signed over a planned message (the user closed the
//                  tab before /api/launch/confirm) via getSignaturesForAddress(mint).
// Runs every RECONCILE_INTERVAL_SEC (default 60) when background work is on (started by server/platform).
import { PublicKey } from "@solana/web3.js";
import { CHAINS } from "@shared/chains";
import { adapterFor } from "./registry";
import { solConnection } from "./sol";
import { launchStore } from "./store";
import type { LaunchRecord } from "./types";
import { plannedIndexOf, verifySolHashes } from "./verify";

function log(msg: string) {
  console.log(`${new Date().toLocaleTimeString("en-US", { hour12: true })} [reconcile] ${msg}`);
}

/** Runs the adapter's confirm for `launch` (its stored hashes) and saves the outcome. Never throws. */
export async function confirmLaunch(launch: LaunchRecord): Promise<LaunchRecord> {
  const adapter = adapterFor(launch.launchpad);
  if (!adapter.confirm || !launch.txHashes.length) return launch;
  try {
    // Split launches prepend the ShareSplitter create tx; adapters only see their own transactions.
    const own = launch.meta.shareSplitter && launch.txHashes.length >= 2 ? launch.txHashes.slice(1) : launch.txHashes;
    const r = await adapter.confirm(launch, own);
    launch.status = r.status;
    if (r.token) launch.token = r.token;
    if (r.curve) launch.curve = r.curve;
    if (r.splitter) launch.splitter = r.splitter;
    launch.error = r.error;
  } catch (e) {
    launch.error = e instanceof Error ? e.message : String(e);
  }
  await launchStore.save(launch);
  return launch;
}

const preparedChecks = new Map<string, number>();
const DAY = 24 * 3600_000;

async function reconcileSubmitted(l: LaunchRecord): Promise<void> {
  if (CHAINS[l.chain].kind === "svm" && l.meta.candidates) {
    let cands: string[] = [];
    try {
      cands = JSON.parse(l.meta.candidates);
    } catch {
      /* ignore */
    }
    const v = await verifySolHashes(l, cands);
    if (v.accepted.length) l.txHashes = [...l.txHashes, ...v.accepted.filter((h) => !l.txHashes.includes(h))];
    if (v.pending.length) l.meta.candidates = JSON.stringify(v.pending);
    else delete l.meta.candidates;
  }
  if (!l.txHashes.length) {
    if (Date.now() - l.createdAt > DAY) {
      l.status = "failed";
      l.error = "No transaction of this launch was found on-chain";
    }
    await launchStore.save(l);
    return;
  }
  const before = l.status;
  await confirmLaunch(l);
  if (l.status === "submitted" && Date.now() - l.createdAt > DAY) {
    l.status = "failed";
    l.error = l.error ?? "Not confirmed within 24 hours";
    await launchStore.save(l);
  }
  if (l.status !== before) log(`${l.id} $${l.symbol}: ${before} → ${l.status}${l.error ? ` (${l.error})` : ""}`);
}

async function reconcilePrepared(l: LaunchRecord): Promise<void> {
  const n = preparedChecks.get(l.id) ?? 0;
  if (n >= 3 || !l.meta.mint || !l.meta.planMsgs) return;
  preparedChecks.set(l.id, n + 1);
  if (preparedChecks.size > 5_000) preparedChecks.clear();
  const sigs = await solConnection().getSignaturesForAddress(new PublicKey(l.meta.mint), { limit: 20 }, "confirmed");
  const mine = sigs.filter((s) => plannedIndexOf(l, s.signature) >= 0).map((s) => s.signature);
  if (!mine.length) return;
  const v = await verifySolHashes(l, mine, { online: false });
  if (!v.accepted.length) return;
  l.txHashes = v.accepted;
  l.status = "submitted";
  await launchStore.save(l);
  log(`${l.id} $${l.symbol}: found ${v.accepted.length} landed tx(s) for a launch that was never confirmed`);
  await reconcileSubmitted(l);
}

let running = false;

export async function reconcileOnce(): Promise<{ submitted: number; prepared: number }> {
  if (running) return { submitted: 0, prepared: 0 };
  running = true;
  try {
    const submitted = await launchStore.byStatus(["submitted"], { since: Date.now() - 7 * DAY, limit: 200 });
    for (const l of submitted) await reconcileSubmitted(l).catch((e) => log(`${l.id}: ${(e as Error).message}`));
    const now = Date.now();
    const prepared = (await launchStore.byStatus(["prepared"], { chain: "sol", since: now - 15 * 60_000, limit: 100 })).filter(
      (l) => now - l.createdAt > 60_000,
    );
    for (const l of prepared) await reconcilePrepared(l).catch((e) => log(`${l.id}: ${(e as Error).message}`));
    return { submitted: submitted.length, prepared: prepared.length };
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startLaunchReconciler(): void {
  if (timer) return;
  const sec = Math.max(15, Number(process.env.RECONCILE_INTERVAL_SEC ?? 60) || 60);
  timer = setInterval(() => void reconcileOnce().catch((e) => log((e as Error).message)), sec * 1000);
  timer.unref?.();
  log(`every ${sec}s`);
}
