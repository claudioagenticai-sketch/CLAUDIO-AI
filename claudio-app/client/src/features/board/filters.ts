// Pure filter logic for board columns. Kept framework-free so it's cheap to run on every update.
import type { TokenSnapshot } from "@shared/types";
import type { ColumnFilters } from "@/lib/store";

export interface FilterContext {
  blockedDevs: string[];
  blockedKeywords: string[];
  now: number;
}

/** "pepe, frog  moon" → ["pepe","frog","moon"] */
export function splitKeywords(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,\s]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
}

function num(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function hasSocials(t: TokenSnapshot): boolean {
  const s = t.socials ?? {};
  return Boolean(s.twitter || s.telegram || s.website || s.discord || s.farcaster);
}

export function makeFilter(f: ColumnFilters, ctx: FilterContext): (t: TokenSnapshot) => boolean {
  const include = splitKeywords(f.includeKeywords);
  const exclude = [...splitKeywords(f.excludeKeywords), ...ctx.blockedKeywords.map((k) => k.toLowerCase()).filter(Boolean)];
  const blockedDevs = new Set(ctx.blockedDevs.map((d) => d.toLowerCase()));
  const lps = f.launchpads && f.launchpads.length ? new Set<string>(f.launchpads) : null;
  const maxAgeMs = num(f.maxAgeMin) ? f.maxAgeMin * 60_000 : null;

  return (t) => {
    if (blockedDevs.size && blockedDevs.has((t.creator ?? "").toLowerCase())) return false;
    if (lps && !lps.has(t.launchpad)) return false;
    if (num(f.minMcap) && t.mcapUsd < f.minMcap) return false;
    if (num(f.maxMcap) && t.mcapUsd > f.maxMcap) return false;
    if (num(f.minLiquidity) && t.liquidityUsd < f.minLiquidity) return false;
    if (num(f.minHolders) && t.holders < f.minHolders) return false;
    if (num(f.maxTop10Pct) && t.top10Pct > f.maxTop10Pct) return false;
    if (num(f.maxDevPct) && t.devHoldPct > f.maxDevPct) return false;
    if (num(f.maxSnipersPct) && t.snipersPct > f.maxSnipersPct) return false;
    if (num(f.maxBundlersPct) && t.bundlersPct > f.maxBundlersPct) return false;
    if (num(f.maxInsidersPct) && t.insidersPct > f.maxInsidersPct) return false;
    if (maxAgeMs !== null && ctx.now - t.createdAt > maxAgeMs) return false;
    if (f.requireSocials && !hasSocials(t)) return false;
    if (f.requireTwitter && !t.socials?.twitter) return false;
    if (f.dexPaidOnly && !t.dexPaid) return false;
    if (f.stockPairedOnly && !t.stockPaired) return false;
    if (f.launchedHereOnly && !t.launchedHere) return false;
    if (f.hideDevSold && t.devSold) return false;
    if (num(f.maxTaxBps) && Math.max(t.buyTaxBps, t.sellTaxBps) > f.maxTaxBps) return false;
    if (include.length || exclude.length) {
      const hay = `${t.name} ${t.symbol}`.toLowerCase();
      if (include.length && !include.some((k) => hay.includes(k))) return false;
      if (exclude.length && exclude.some((k) => hay.includes(k))) return false;
    }
    return true;
  };
}

/** Number of non-default filters, for the badge on the filter button. */
export function activeFilterCount(f: ColumnFilters): number {
  let n = 0;
  if (f.launchpads && f.launchpads.length) n++;
  const numeric: (keyof ColumnFilters)[] = [
    "minMcap", "maxMcap", "minLiquidity", "minHolders", "maxTop10Pct", "maxDevPct",
    "maxSnipersPct", "maxBundlersPct", "maxInsidersPct", "maxAgeMin", "maxTaxBps",
  ];
  for (const k of numeric) if (num(f[k] as number | undefined)) n++;
  const flags: (keyof ColumnFilters)[] = [
    "requireSocials", "requireTwitter", "dexPaidOnly", "stockPairedOnly", "launchedHereOnly", "hideDevSold",
  ];
  for (const k of flags) if (f[k] === true) n++;
  if (splitKeywords(f.includeKeywords).length) n++;
  if (splitKeywords(f.excludeKeywords).length) n++;
  return n;
}

/** Risk tones for card stats. Thresholds follow common trench heuristics. */
export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

export function riskTone(v: number, warnAt: number, badAt: number): Tone {
  if (!Number.isFinite(v)) return "neutral";
  if (v > badAt) return "bad";
  if (v > warnAt) return "warn";
  return "neutral";
}
