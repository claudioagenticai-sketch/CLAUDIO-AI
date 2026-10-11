// Cross-token wallet registry: first time we saw a wallet anywhere, and KOL / smart-money labels.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ilog } from "../ingest/log";

// ─── Address normalization ──────────────────────────────────────────

/** EVM addresses are case-insensitive → lowercase. Base58 (Solana) is case-sensitive → unchanged. */
export function normAddr(a: string): string {
  return a.startsWith("0x") || a.startsWith("0X") ? a.toLowerCase() : a;
}

// ─── First-seen registry (fresh-wallet heuristic) ───────────────────

const MAX_WALLETS = 400_000;
const firstSeenMap = new Map<string, number>();
const startedAt = Date.now();
export const FRESH_WINDOW_MS = 10 * 60_000;

/** Record a sighting; returns the first time we ever saw this wallet (ms). */
export function sawWallet(addr: string, ts: number): number {
  const a = normAddr(addr);
  const prev = firstSeenMap.get(a);
  if (prev !== undefined) return prev;
  firstSeenMap.set(a, ts);
  if (firstSeenMap.size > MAX_WALLETS) {
    // Map iterates in insertion order → drop the oldest ~5%.
    let n = Math.floor(MAX_WALLETS * 0.05);
    for (const k of firstSeenMap.keys()) {
      firstSeenMap.delete(k);
      if (--n <= 0) break;
    }
  }
  return ts;
}

/**
 * "fresh (heuristic)": the first time we saw this wallet anywhere is within 10 min before this buy.
 * We only see wallets through launchpad trades we index, so during the first 10 minutes after boot every
 * wallet would look fresh — the heuristic is disabled until the registry has warmed up.
 */
export function isFreshAt(firstSeen: number, buyTs: number): boolean {
  if (Date.now() - startedAt < FRESH_WINDOW_MS) return false;
  if (firstSeen < startedAt + FRESH_WINDOW_MS) return false; // seen during warm-up → unknown age
  return buyTs - firstSeen <= FRESH_WINDOW_MS;
}

// ─── KOL / smart-money labels ───────────────────────────────────────

export type WalletLabelKind = "kol" | "smart";
const labels = new Map<string, { label: string; kind: WalletLabelKind }>();

function loadLabels(): void {
  const here = (() => {
    try {
      return path.dirname(fileURLToPath(import.meta.url));
    } catch {
      return process.cwd();
    }
  })();
  const candidates = [
    process.env.KOLS_FILE,
    path.resolve(process.cwd(), "server/analytics/kols.json"),
    path.resolve(here, "kols.json"),
    path.resolve(here, "analytics/kols.json"),
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
      if (!raw || typeof raw !== "object") continue;
      for (const [addr, label] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof label !== "string") continue;
        // Convention: labels containing "smart" (e.g. "smart: top pons trader") count as smart money.
        labels.set(normAddr(addr), { label, kind: /smart/i.test(label) ? "smart" : "kol" });
      }
      if (labels.size) ilog("analytics", `loaded ${labels.size} wallet labels from ${p}`);
      return;
    } catch (e) {
      ilog("analytics", `failed to read ${p}: ${(e as Error).message}`);
    }
  }
}
loadLabels();

export function walletLabel(addr: string): { label: string; kind: WalletLabelKind } | undefined {
  return labels.get(normAddr(addr));
}
