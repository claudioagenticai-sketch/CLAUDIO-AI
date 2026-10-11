// Fee keeper: harvests creator fees for Claudio launches automatically, paid by the gas relayer, so creators (and social
// accounts) don't have to press "Harvest". Only runs when KEEPER=on and a RELAYER_KEY is configured.
//
//   KEEPER=on                 enable
//   KEEPER_INTERVAL_MIN=15    how often to scan
//   KEEPER_MIN_PROFIT_X=5     only harvest when claimable native fees ≥ X × estimated gas cost
//
// It also sweeps CLAIMED social vaults to their owner after a harvest, and harvests immediately when a launchpad
// proposes redirecting a Claudio token's creator fees (Pons' 3-day CTO path) so accrued fees are secured first.
import { encodeFunctionData } from "viem";
import { CHAINS, type ChainId } from "@shared/chains";
import { launchStore } from "./launch/store";
import { adapterFor } from "./launch/registry";
import type { LaunchRecord } from "./launch/types";
import { evmClient } from "./trade/evm";
import { RelayError, relay, relayerEnabled } from "./relayer";
import { SOCIAL_VAULT_ABI } from "./social/attest";
import { SHARE_SPLITTER_ABI, feeAssets, launchVaults, shareHarvestTxs, shareSplitterOf } from "./launch/shares";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const HARVEST_GAS_ESTIMATE = BigInt(450_000);

const env = (n: string) => process.env[n]?.trim();
let timer: NodeJS.Timeout | null = null;
let running = false;
const urgent = new Set<string>();

export interface KeeperReport {
  scanned: number;
  harvested: { id: string; symbol: string; chain: ChainId; hashes: string[] }[];
  swept: { vault: string; hash: string }[];
  skipped: number;
  errors: { id: string; error: string }[];
}
let lastReport: KeeperReport | null = null;

function log(msg: string) {
  console.log(`${new Date().toLocaleTimeString("en-US", { hour12: true })} [keeper] ${msg}`);
}

async function claimableNative(launch: LaunchRecord): Promise<number> {
  const adapter = adapterFor(launch.launchpad);
  if (!adapter.fees) return 0;
  const readings = await adapter.fees(launch).catch(() => []);
  const sym = CHAINS[launch.chain].nativeSymbol;
  return readings.filter((r) => r.symbol === sym || r.symbol === `W${sym}`).reduce((n, r) => n + r.amount, 0);
}

/** Splits whatever a launch's ShareSplitter holds (creator side shared with social accounts). */
async function distributeShares(launch: LaunchRecord, hashes: string[]) {
  const splitter = shareSplitterOf(launch);
  if (!splitter) return;
  const c = evmClient(launch.chain);
  const code = await c.getCode({ address: splitter }).catch(() => undefined);
  if (code && code !== "0x") {
    // Skip the tx when nothing is waiting in any fee asset.
    const pending = await Promise.all(
      feeAssets(launch).map((t) =>
        c.readContract({ address: splitter, abi: SHARE_SPLITTER_ABI, functionName: "distributable", args: [t] }).catch(() => BigInt(0)),
      ),
    );
    if (pending.every((v) => (v as bigint) === BigInt(0))) return;
  }
  for (const tx of await shareHarvestTxs(launch)) {
    if (tx.kind !== "evm") continue;
    const r = await relay(launch.chain, { to: tx.to, data: tx.data }, `${launch.symbol} · ${tx.description}`);
    hashes.push(r.hash);
    if (r.status !== "success") break;
  }
}

/** Sweeps every CLAIMED social vault this launch pays; unclaimed vaults keep the fees for their owner. */
async function sweepIfClaimed(launch: LaunchRecord, report: KeeperReport) {
  const c = evmClient(launch.chain);
  const tokens = feeAssets(launch);
  for (const vault of launchVaults(launch)) {
    const beneficiary = await c.readContract({ address: vault, abi: SOCIAL_VAULT_ABI, functionName: "beneficiary" }).catch(() => ZERO);
    if (beneficiary === ZERO) continue;
    const data = encodeFunctionData({ abi: SOCIAL_VAULT_ABI, functionName: "sweepMany", args: [tokens] });
    const r = await relay(launch.chain, { to: vault, data }, `sweep ${vault}`);
    report.swept.push({ vault, hash: r.hash });
  }
}

export async function runKeeperOnce(filter?: (l: LaunchRecord) => boolean): Promise<KeeperReport> {
  const report: KeeperReport = { scanned: 0, harvested: [], swept: [], skipped: 0, errors: [] };
  if (running) return lastReport ?? report;
  running = true;
  const minX = Number(env("KEEPER_MIN_PROFIT_X") ?? "5") || 5;
  try {
    const launches = (await launchStore.confirmed(500)).filter(
      (l) => CHAINS[l.chain].kind === "evm" && relayerEnabled(l.chain) && !!adapterFor(l.launchpad).harvest && (!filter || filter(l)),
    );
    for (const launch of launches) {
      report.scanned++;
      try {
        const key = `${launch.chain}:${(launch.token ?? "").toLowerCase()}`;
        const isUrgent = urgent.delete(key);
        const claimable = await claimableNative(launch);
        const gasPrice = await evmClient(launch.chain).getGasPrice();
        const gasCost = Number(HARVEST_GAS_ESTIMATE * gasPrice) / 1e18;
        const worth = claimable > 0 && claimable >= gasCost * minX;
        if (!worth && !isUrgent) {
          report.skipped++;
          const shareHashes: string[] = [];
          await distributeShares(launch, shareHashes).catch(() => undefined);
          if (shareHashes.length) report.harvested.push({ id: launch.id, symbol: launch.symbol, chain: launch.chain, hashes: shareHashes });
          await sweepIfClaimed(launch, report).catch(() => undefined);
          continue;
        }
        const { txs } = await adapterFor(launch.launchpad).harvest!(launch);
        const hashes: string[] = [];
        for (const tx of txs) {
          if (tx.kind !== "evm") continue;
          const r = await relay(launch.chain, { to: tx.to, data: tx.data }, `harvest ${launch.symbol} · ${tx.description}`);
          hashes.push(r.hash);
          if (r.status !== "success") break;
        }
        await distributeShares(launch, hashes).catch((e) => report.errors.push({ id: launch.id, error: `shares: ${(e as Error).message}` }));
        if (hashes.length) report.harvested.push({ id: launch.id, symbol: launch.symbol, chain: launch.chain, hashes });
        await sweepIfClaimed(launch, report).catch((e) => report.errors.push({ id: launch.id, error: `sweep: ${(e as Error).message}` }));
      } catch (e) {
        const msg = e instanceof RelayError ? `${e.code}: ${e.message}` : (e as Error).message;
        report.errors.push({ id: launch.id, error: msg });
        if (e instanceof RelayError && (e.code === "relayer_budget" || e.code === "relayer_empty")) break;
      }
    }
  } finally {
    running = false;
  }
  lastReport = report;
  if (report.harvested.length || report.swept.length || report.errors.length) {
    log(`scanned ${report.scanned}, harvested ${report.harvested.length}, swept ${report.swept.length}, errors ${report.errors.length}`);
  }
  return report;
}

/** Called by indexers when a Claudio token's fee recipient is about to be redirected: harvest it on the next tick. */
export function requestUrgentHarvest(chain: ChainId, token: string): void {
  urgent.add(`${chain}:${token.toLowerCase()}`);
  if (timer) void runKeeperOnce((l) => l.chain === chain && (l.token ?? "").toLowerCase() === token.toLowerCase());
}

export function keeperStatus() {
  return { enabled: !!timer, running, lastReport };
}

export function startKeeper(): void {
  if ((env("KEEPER") ?? "").toLowerCase() !== "on" || timer) return;
  const minutes = Math.max(1, Number(env("KEEPER_INTERVAL_MIN") ?? "15") || 15);
  timer = setInterval(() => void runKeeperOnce().catch((e) => log(`run failed: ${(e as Error).message}`)), minutes * 60_000);
  timer.unref();
  setTimeout(() => void runKeeperOnce().catch(() => undefined), 30_000).unref();
  log(`started (every ${minutes} min)`);
}
