// In-memory TokenStore: token snapshots, trade ring buffers, candles, holder analytics, phase logic,
// eviction, search, chain status. Every mutation publishes to hub topics board:<chain>, token:<key>, trades:<key>.
// Persistence (Postgres) is optional and not required for the live board — everything here is rebuilt from feeds.
//
// Keys are `${chain}:${address}`; EVM addresses are lowercased (callers may pass checksummed keys).

import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, deploymentOf, type LaunchModel, type LaunchpadDeployment } from "@shared/launchpads";
import type { Candle, ChainStatus, TokenAlert, TokenDetail, TokenPhase, TokenSnapshot, Trade, TraderTag } from "@shared/types";
import { publish } from "../hub";
import { TokenAnalytics } from "../analytics";
import { devRecord, recordLaunch, recordMigration, recordRug } from "../analytics/devrep";
import { nativeUsdOf, onPricesChanged } from "../ingest/prices";
import { CandleSeries, RollingWindows } from "./series";
import { allChainStatuses, markEvent } from "./status";

export interface TokenStore {
  get(key: string): TokenSnapshot | undefined;
  detail(key: string): TokenDetail | undefined;
  list(chain: ChainId, phase?: TokenPhase, limit?: number): TokenSnapshot[];
  search(q: string, limit?: number): TokenSnapshot[];
  upsert(token: TokenSnapshot): void;
  patch(key: string, patch: Partial<TokenSnapshot>): void;
  addTrade(trade: Trade): void;
  trades(key: string, limit?: number): Trade[];
  candles(key: string, resolutionSec: number, limit?: number): Candle[];
  status(): ChainStatus[];
  /** Mark a token as launched through Claudio (from the launch module). */
  markLaunchedHere(key: string, feeSplit: TokenSnapshot["feeSplit"]): void;
}

// ─── Extended API used by ingest ────────────────────────────────────

export interface RegisterOpts {
  /** Human-unit total supply (default: launchpad registry totalSupply, else 1e9). */
  supply?: number;
  /** Curve / pool / locker addresses excluded from holder stats. */
  excluded?: string[];
  /** Fixed USD price of the quote asset (e.g. USDG = 1). Omit → chain native price. 0 → unknown (USD fields 0). */
  quoteUsd?: number;
  createBlock?: number;
  /** We observed the creation event (enables sniper/insider logic). */
  trackedFromCreation?: boolean;
  /** Synthetic token from the simulator. */
  simulated?: boolean;
  /**
   * Market fields (volume/txns/change) are fed from outside (e.g. DexScreener for $CLAUDIO) — the periodic window
   * recompute won't zero them, and the token is never evicted.
   */
  pinned?: boolean;
  /** Never evicted (Claudio launches), without the external-market semantics of `pinned`. */
  keep?: boolean;
  /** Registered by an on-demand lookup (coin page / search): evicted only after `ttlMs` of inactivity, not by column caps. */
  onDemand?: boolean;
  /** Inactivity TTL for this token (default 24 h). */
  ttlMs?: number;
}

type HolderField =
  | "holders" | "top10Pct" | "devHoldPct" | "snipersPct" | "snipersCount" | "insidersPct" | "bundlersPct" | "bundlersCount"
  | "freshWalletsPct" | "kolBuys" | "smartBuys" | "devLaunches" | "devMigrations" | "devSold" | "botPct" | "ratPct";
type MarketField =
  | "priceUsd" | "mcapUsd" | "liquidityUsd" | "volume5mUsd" | "volume1hUsd" | "volume24hUsd" | "buys5m" | "sells5m" | "txCount"
  | "change5mPct" | "change1hPct" | "athMcapUsd";

/**
 * Data about a token from an outside indexer (GMGN). The store keeps it as an overlay so trade-derived analytics and
 * the window recompute don't wipe it:
 *   • holders — wallet mix / dev numbers: win over our own analytics while fresh (the outside indexer sees every holder);
 *   • market  — price / mcap / change / liquidity only while our own trade feed is quiet (no trade newer than `at`, none in
 *               the last 30 s); volume / txns take the max of both (our feed only sees the slice since we indexed it);
 *   • meta    — names, image, socials, flags: fill what is missing (never blanks a known value).
 */
export interface ExternalEnrichment {
  /** Unix ms when the outside source produced the numbers. */
  at: number;
  holders?: Partial<Pick<TokenSnapshot, HolderField>>;
  market?: Partial<Pick<TokenSnapshot, MarketField>>;
  meta?: Partial<TokenSnapshot>;
  /** 0–100, applied while our own feed is quiet. */
  bondingPct?: number;
  /** The source's column: "migrated" migrates the token; "almost" lowers the almost-bonded threshold to 40 %. */
  phase?: TokenPhase;
  migratedAt?: number;
  venue?: string;
  pool?: string;
}

export interface MarketUpdate {
  /** Spot price in quote units per token (from reserves / sqrtPrice / postPrice). */
  spotPriceNative?: number;
  bondingPct?: number;
  /** Liquidity expressed in quote units (curve: real quote; AMM: both sides valued in quote). */
  liquidityNative?: number;
}

export interface TradeOpts extends MarketUpdate {
  /** Execution price in quote/token net of fees & taxes (default amountNative / amountToken). */
  execPriceNative?: number;
}

export interface TokenStoreEx extends TokenStore {
  has(key: string): boolean;
  register(token: TokenSnapshot, opts?: RegisterOpts): void;
  setMeta(key: string, opts: RegisterOpts): void;
  addTrade(trade: Trade, opts?: TradeOpts): void;
  updateMarket(key: string, m: MarketUpdate): void;
  migrate(key: string, info?: { venue?: string; pool?: string; at?: number }): void;
  alert(key: string, alert: TokenAlert): void;
  purge(pred: (t: TokenSnapshot) => boolean): number;
  count(chain?: ChainId): number;
  isSimulated(key: string): boolean;
  /**
   * Backfill USD candles (t in seconds, oldest first; `resSec` = their resolution, default 60) for a token whose own series
   * is thin. Buckets our own feed already has are kept (live data wins); returns how many candles were inserted.
   */
  seedCandles(key: string, candles: Candle[], resSec?: number): number;
  /** Merge outside-indexer data (GMGN) as an overlay — see ExternalEnrichment. Emits when something visible changed. */
  enrich(key: string, ext: ExternalEnrichment): void;
  /** Somebody looked at this token (keeps on-demand entries alive). */
  touch(key: string): void;
  /** Tokens launched through Claudio that are on the board. */
  launchedHereTokens(): TokenSnapshot[];
  /** Last activity (trade / price move / outside activity) and last own trade, unix ms. */
  activityOf(key: string): { lastActivity: number; lastTradeTs: number } | undefined;
}

// ─── Internals ──────────────────────────────────────────────────────

const MAX_TRADES = 500;
const MAX_ALERTS = 10;
const KEEP: Record<TokenPhase, number> = { new: 400, almost: 200, migrated: 300 };
const INACTIVE_MS = 24 * 3_600_000;
const HOUR = 3_600_000;
const DEFAULT_MILESTONE: NonNullable<LaunchpadDeployment["milestone"]> = { unit: "usd-mcap", value: 50_000 };
/** Outside wallet-mix numbers stay authoritative this long; outside market numbers this long. */
const EXT_HOLDERS_TTL = 20 * 60_000;
const EXT_MARKET_TTL = 5 * 60_000;
/** Our own trade feed counts as "live" for this long after its last trade. */
const OWN_FEED_LIVE_MS = 30_000;
const HOLDER_FIELDS: HolderField[] = [
  "holders", "top10Pct", "devHoldPct", "snipersPct", "snipersCount", "insidersPct", "bundlersPct", "bundlersCount",
  "freshWalletsPct", "kolBuys", "smartBuys", "devLaunches", "devMigrations", "devSold", "botPct", "ratPct",
];
const MAX_FIELDS: MarketField[] = ["volume5mUsd", "volume1hUsd", "volume24hUsd", "buys5m", "sells5m", "txCount", "athMcapUsd"];

interface Entry {
  t: TokenSnapshot;
  trades: Trade[]; // chronological
  tradeIds: Set<string>;
  an: TokenAnalytics;
  win: RollingWindows;
  c15: CandleSeries;
  c60: CandleSeries;
  supply: number;
  quoteUsd?: number;
  liquidityNative: number;
  model: LaunchModel;
  dep?: LaunchpadDeployment;
  simulated: boolean;
  lastActivity: number;
  lastTradeTs: number;
  athPriceUsd: number;
  creatorSoldPct: number;
  rugged: boolean;
  lastLargeSellAlert: number;
  lastQuoteUsd: number;
  pinned: boolean;
  keep: boolean;
  onDemand: boolean;
  ttlMs: number;
  ext?: ExternalEnrichment;
  extPhase?: { phase: TokenPhase; at: number };
}

const entries = new Map<string, Entry>();
const byChain = new Map<ChainId, Set<string>>();
const pendingLaunched = new Map<string, TokenSnapshot["feeSplit"]>();

/** Fields owned by the store/analytics — ingest merges never overwrite them. */
const COMPUTED_FIELDS = new Set<string>([
  "key", "chain", "address", "priceUsd", "mcapUsd", "liquidityUsd", "volume5mUsd", "volume1hUsd", "volume24hUsd",
  "buys5m", "sells5m", "txCount", "change5mPct", "change1hPct", "athMcapUsd", "holders", "top10Pct", "devHoldPct",
  "snipersPct", "snipersCount", "insidersPct", "bundlersPct", "bundlersCount", "freshWalletsPct", "kolBuys",
  "smartBuys", "devLaunches", "devMigrations", "devRugs", "devSold", "alerts", "updatedAt",
]);

export function normKey(key: string): string {
  const i = key.indexOf(":");
  if (i < 0) return key;
  const addr = key.slice(i + 1);
  return addr.startsWith("0x") || addr.startsWith("0X") ? `${key.slice(0, i)}:${addr.toLowerCase()}` : key;
}

function quoteUsdOf(e: Entry): number {
  return e.quoteUsd !== undefined ? e.quoteUsd : nativeUsdOf(e.t.chain);
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function emit(e: Entry): void {
  publish(`board:${e.t.chain}`, { t: "token", token: e.t });
  publish(`token:${e.t.key}`, { t: "token", token: e.t });
}

function applyDevStats(e: Entry): void {
  const r = devRecord(e.t.creator);
  if (!r) return;
  e.t.devLaunches = r.launches;
  e.t.devMigrations = r.migrations;
  e.t.devRugs = r.rugs;
  if (e.ext) applyExt(e, Date.now()); // outside dev numbers (GMGN sees the dev's whole history) stay on top
}

/** Push fresh dev stats to every indexed token of this creator (bounded list). */
function refreshCreatorTokens(creator: string): void {
  const r = devRecord(creator);
  if (!r) return;
  for (const k of r.tokens) {
    const e = entries.get(k);
    if (!e) continue;
    applyDevStats(e);
    emit(e);
  }
}

function instantPct(e: Entry): number {
  const m = e.dep?.milestone ?? DEFAULT_MILESTONE;
  if (m.value <= 0) return 0;
  if (m.unit === "native-liquidity") return (e.liquidityNative / 2 / m.value) * 100; // quote side of the pool
  return (e.t.mcapUsd / m.value) * 100;
}

function doMigrate(e: Entry, info: { venue?: string; pool?: string; at?: number }): void {
  const t = e.t;
  if (info.venue) t.venue = info.venue;
  if (info.pool) t.pool = info.pool;
  if (t.phase === "migrated") return;
  t.phase = "migrated";
  t.migratedAt = info.at ?? Date.now();
  if (e.model === "curve") t.bondingPct = 100;
  if (!t.venue) t.venue = e.dep?.migratesTo;
  const lp = LAUNCHPADS[t.launchpad];
  pushAlert(e, {
    kind: "migration",
    at: t.migratedAt,
    severity: "info",
    message: e.model === "curve" ? `Graduated to ${t.venue ?? "DEX"}` : `${lp?.name ?? t.launchpad} milestone reached`,
  });
  if (t.creator) {
    recordMigration(t.creator, t.key);
    refreshCreatorTokens(t.creator);
  }
}

/** Recompute derived USD fields, windows and phase. */
function recompute(e: Entry, now = Date.now()): void {
  const t = e.t;
  const q = quoteUsdOf(e);
  e.lastQuoteUsd = q;
  if (t.priceNative > 0 && q > 0) {
    t.priceUsd = t.priceNative * q;
    t.mcapUsd = t.priceUsd * e.supply;
  }
  if (e.liquidityNative > 0 && q > 0) t.liquidityUsd = e.liquidityNative * q;
  if (t.priceUsd > e.athPriceUsd) e.athPriceUsd = t.priceUsd;
  if (t.mcapUsd > t.athMcapUsd) t.athMcapUsd = t.mcapUsd;
  // Pinned tokens get volume/txns/change from an external feed; trade-derived windows would only cover our slice.
  if (!e.pinned) Object.assign(t, e.win.compute(now, t.priceUsd));

  applyExt(e, now);

  if (e.model === "instant") t.bondingPct = instantPct(e);
  t.bondingPct = clampPct(t.bondingPct);
  if (t.phase !== "migrated") {
    const almostHint = e.extPhase?.phase === "almost" && now - e.extPhase.at < EXT_MARKET_TTL;
    if (e.model === "instant" && t.bondingPct >= 100) doMigrate(e, {});
    else t.phase = t.bondingPct >= 70 || (almostHint && t.bondingPct >= 40) ? "almost" : "new";
  }
  t.updatedAt = now;
}

/** Re-apply the outside overlay (see ExternalEnrichment) on top of our own analytics / windows. */
function applyExt(e: Entry, now: number): void {
  const x = e.ext;
  if (!x) return;
  const t = e.t as unknown as Record<string, unknown>;
  const age = now - x.at;
  if (x.holders && age < EXT_HOLDERS_TTL) {
    for (const f of HOLDER_FIELDS) {
      const v = x.holders[f];
      if (v !== undefined && v !== null && (typeof v !== "number" || Number.isFinite(v))) t[f] = v;
    }
  }
  if (!x.market || age >= EXT_MARKET_TTL || e.pinned) return;
  const m = x.market;
  for (const f of MAX_FIELDS) {
    const v = m[f];
    if (typeof v === "number" && Number.isFinite(v) && v > ((t[f] as number) || 0)) t[f] = v;
  }
  if (!ownFeedQuiet(e, x.at, now)) return;
  const q = quoteUsdOf(e);
  if (m.priceUsd && m.priceUsd > 0 && Number.isFinite(m.priceUsd)) {
    e.t.priceUsd = m.priceUsd;
    if (q > 0) e.t.priceNative = m.priceUsd / q;
    if (m.priceUsd > e.athPriceUsd) e.athPriceUsd = m.priceUsd;
  }
  if (m.mcapUsd && m.mcapUsd > 0) e.t.mcapUsd = m.mcapUsd;
  else if (m.priceUsd && m.priceUsd > 0) e.t.mcapUsd = m.priceUsd * e.supply;
  if (m.liquidityUsd && m.liquidityUsd > 0) {
    e.t.liquidityUsd = m.liquidityUsd;
    if (q > 0) e.liquidityNative = m.liquidityUsd / q;
  }
  if (typeof m.change5mPct === "number" && Number.isFinite(m.change5mPct)) e.t.change5mPct = m.change5mPct;
  if (typeof m.change1hPct === "number" && Number.isFinite(m.change1hPct)) e.t.change1hPct = m.change1hPct;
  if (e.t.mcapUsd > e.t.athMcapUsd) e.t.athMcapUsd = e.t.mcapUsd;
}

/** Our own trade feed has nothing newer than `at` and has been silent for OWN_FEED_LIVE_MS. */
function ownFeedQuiet(e: Entry, at: number, now: number): boolean {
  return e.lastTradeTs < at && now - e.lastTradeTs > OWN_FEED_LIVE_MS;
}

function visibleSig(t: TokenSnapshot): string {
  return [
    t.name, t.symbol, t.image, t.phase, Math.round(t.bondingPct), Math.round(t.mcapUsd), Math.round(t.liquidityUsd),
    Math.round(t.volume5mUsd), Math.round(t.volume1hUsd), Math.round(t.volume24hUsd), t.txCount, t.holders,
    t.top10Pct.toFixed(1), t.devHoldPct.toFixed(1), t.snipersPct.toFixed(1), t.bundlersPct.toFixed(1), t.insidersPct.toFixed(1),
    t.freshWalletsPct.toFixed(1), t.kolBuys, t.smartBuys, t.devLaunches, t.devMigrations, t.devSold, t.dexPaid,
    t.change5mPct.toFixed(1), t.change1hPct.toFixed(1), t.botPct, t.ratPct, t.xFollowers, t.devStatus, t.cto, t.dexBoost, t.dexAd,
    t.kolCount, t.smartCount, t.rugRatio, !!t.analyticsAt,
    JSON.stringify(t.socials),
  ].join("|");
}

/** Meta fields an outside source may fill (never blanks a known value; socials merge). */
const META_FILL = new Set<string>([
  "name", "symbol", "image", "description", "creator", "createTx", "pool", "venue", "quoteSymbol", "migratedAt",
  "buyTaxBps", "sellTaxBps", "launchpadLabel",
]);
const META_SET = new Set<string>([
  "dexPaid", "rugRatio", "devStatus", "devFundedBy", "xFollowers", "dexBoost", "dexBoostFee", "dexAd", "dexTrending", "cto", "gmgnAt",
  "kolCount", "smartCount", "analyticsAt",
]);

function applyMeta(e: Entry, meta: Partial<TokenSnapshot>): void {
  const t = e.t as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (k === "socials" && typeof v === "object") {
      const merged = { ...e.t.socials } as Record<string, string>;
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) if (typeof sv === "string" && sv && !merged[sk]) merged[sk] = sv;
      e.t.socials = merged;
      continue;
    }
    if (META_SET.has(k)) {
      t[k] = v;
      continue;
    }
    if (!META_FILL.has(k)) continue;
    const cur = t[k];
    const blank = cur === undefined || cur === null || cur === "" || cur === 0 || cur === "Unknown" || cur === "???";
    if (blank && v !== "") t[k] = v;
  }
  if (meta.creator && !e.an.creator) e.an.setCreator(meta.creator);
  if (meta.pool) e.an.addExcluded([meta.pool]);
}

function pushAlert(e: Entry, alert: TokenAlert): void {
  const list = e.t.alerts;
  // Dedupe identical kind within 60s.
  if (list.some((a) => a.kind === alert.kind && Math.abs(a.at - alert.at) < 60_000 && a.message === alert.message)) return;
  list.push(alert);
  if (list.length > MAX_ALERTS) list.splice(0, list.length - MAX_ALERTS);
  publish(`token:${e.t.key}`, { t: "alert", key: e.t.key, alert });
  if (alert.severity === "danger" || e.t.launchedHere || alert.kind === "migration") {
    publish(`board:${e.t.chain}`, { t: "alert", key: e.t.key, alert });
  }
}

function mergeInto(e: Entry, patch: Partial<TokenSnapshot>, allowComputed: boolean): void {
  const t = e.t as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "key" || k === "chain" || k === "address") continue;
    if (!allowComputed && COMPUTED_FIELDS.has(k)) continue;
    if (k === "phase") continue; // handled below
    if (k === "socials" && v && typeof v === "object") {
      const merged = { ...e.t.socials };
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) if (typeof sv === "string" && sv) (merged as Record<string, string>)[sk] = sv;
      e.t.socials = merged;
      continue;
    }
    if (k === "launchedHere") {
      e.t.launchedHere = e.t.launchedHere || v === true;
      continue;
    }
    if ((k === "image" || k === "description" || k === "creator" || k === "name" || k === "symbol") && v === "") continue;
    // Re-registration merges (allowComputed=false) come from blank-ish snapshots: never let 0/false defaults
    // clobber market state learned since (price, bonding, flags). Explicit patches apply everything.
    if (!allowComputed && (v === 0 || v === false)) continue;
    t[k] = v;
  }
  if (patch.creator) e.an.setCreator(patch.creator);
  if (patch.phase === "migrated") doMigrate(e, { venue: patch.venue, pool: patch.pool, at: patch.migratedAt });
}

function makeEntry(token: TokenSnapshot, opts: RegisterOpts | undefined): Entry {
  const dep = deploymentOf(token.launchpad, token.chain);
  const lp = LAUNCHPADS[token.launchpad];
  const supply = opts?.supply && opts.supply > 0 ? opts.supply : dep?.totalSupply ?? 1e9;
  return {
    t: token,
    trades: [],
    tradeIds: new Set(),
    an: new TokenAnalytics({
      supply,
      creator: token.creator,
      createdAt: token.createdAt,
      createBlock: opts?.createBlock ?? 0,
      trackedFromCreation: opts?.trackedFromCreation ?? false,
      excluded: [token.address, ...(token.pool ? [token.pool] : []), ...(opts?.excluded ?? [])],
    }),
    win: new RollingWindows(),
    c15: new CandleSeries(15, 1920), // 8h
    c60: new CandleSeries(60, 1440), // 24h
    supply,
    quoteUsd: opts?.quoteUsd,
    liquidityNative: 0,
    model: lp?.model ?? "curve",
    dep,
    simulated: opts?.simulated ?? false,
    lastActivity: Date.now(),
    lastTradeTs: 0,
    athPriceUsd: 0,
    creatorSoldPct: 0,
    rugged: false,
    lastLargeSellAlert: 0,
    lastQuoteUsd: 0,
    pinned: opts?.pinned ?? false,
    keep: opts?.keep ?? false,
    onDemand: opts?.onDemand ?? false,
    ttlMs: opts?.ttlMs && opts.ttlMs > 0 ? opts.ttlMs : INACTIVE_MS,
  };
}

function normalizeToken(token: TokenSnapshot): TokenSnapshot {
  const key = normKey(token.key || `${token.chain}:${token.address}`);
  const isEvm = CHAINS[token.chain]?.kind === "evm";
  return {
    ...token,
    key,
    address: isEvm ? token.address.toLowerCase() : token.address,
    creator: token.creator ? (isEvm ? token.creator.toLowerCase() : token.creator) : "",
    socials: { ...(token.socials ?? {}) },
    alerts: [...(token.alerts ?? [])],
  };
}

function setMetaInternal(e: Entry, opts: RegisterOpts): void {
  if (opts.supply && opts.supply > 0) {
    e.supply = opts.supply;
    e.an.setSupply(opts.supply);
  }
  if (opts.excluded) e.an.addExcluded(opts.excluded);
  if (opts.quoteUsd !== undefined) e.quoteUsd = opts.quoteUsd;
  if (opts.createBlock) e.an.createBlock = opts.createBlock;
  if (opts.trackedFromCreation !== undefined) e.an.trackedFromCreation = opts.trackedFromCreation;
  if (opts.simulated !== undefined) e.simulated = opts.simulated;
  if (opts.pinned !== undefined) e.pinned = opts.pinned;
  if (opts.keep) e.keep = true;
  // A board/feed registration of an on-demand token makes it a regular board token (column caps apply again).
  if (opts.onDemand !== undefined) e.onDemand = e.onDemand && opts.onDemand;
  if (opts.ttlMs && opts.ttlMs > 0) e.ttlMs = Math.max(e.ttlMs, opts.ttlMs);
}

function register(token: TokenSnapshot, opts?: RegisterOpts): void {
  ensureTimers();
  const incoming = normalizeToken(token);
  const existing = entries.get(incoming.key);
  if (existing) {
    mergeInto(existing, incoming, false);
    if (opts) setMetaInternal(existing, opts);
    if (incoming.pool) existing.an.addExcluded([incoming.pool]);
    existing.lastActivity = Date.now();
    recompute(existing);
    emit(existing);
    return;
  }
  const e = makeEntry(incoming, opts);
  const t = e.t;
  const pend = pendingLaunched.get(t.key);
  if (pend !== undefined || pendingLaunched.has(t.key)) {
    t.launchedHere = true;
    if (pend) t.feeSplit = pend;
    pendingLaunched.delete(t.key);
  }
  if (t.creator) recordLaunch(t.creator, t.key, t.chain);
  applyDevStats(e);
  entries.set(t.key, e);
  let set = byChain.get(t.chain);
  if (!set) {
    set = new Set();
    byChain.set(t.chain, set);
  }
  set.add(t.key);
  const wasMigrated = t.phase === "migrated";
  if (wasMigrated) {
    // Registered already-migrated (bootstrap) → no alert, just record.
    t.migratedAt = t.migratedAt ?? t.createdAt;
    if (e.model === "curve") t.bondingPct = 100;
  }
  recompute(e);
  if (t.creator && t.devLaunches > 1) refreshCreatorTokens(t.creator);
  emit(e);
}

function insertTrade(e: Entry, trade: Trade): boolean {
  const list = e.trades;
  if (list.length === 0 || trade.ts >= list[list.length - 1].ts) list.push(trade);
  else {
    let i = list.length - 1;
    while (i > 0 && list[i - 1].ts > trade.ts) i--;
    if (i === 0 && list.length >= MAX_TRADES) return false; // older than everything we keep
    list.splice(i, 0, trade);
  }
  e.tradeIds.add(trade.id);
  if (list.length > MAX_TRADES) {
    const dropped = list.splice(0, list.length - MAX_TRADES);
    for (const d of dropped) e.tradeIds.delete(d.id);
  }
  return true;
}

function addTrade(trade: Trade, opts?: TradeOpts): void {
  const key = normKey(trade.key);
  const e = entries.get(key);
  if (!e || !trade.id || e.tradeIds.has(trade.id)) return;
  const t = e.t;
  const now = Date.now();
  const q = quoteUsdOf(e);
  const isEvm = CHAINS[t.chain]?.kind === "evm";

  trade.key = key;
  trade.chain = t.chain;
  if (isEvm) trade.trader = trade.trader.toLowerCase();
  if (!Number.isFinite(trade.amountToken) || trade.amountToken < 0) trade.amountToken = 0;
  if (!Number.isFinite(trade.amountNative) || trade.amountNative < 0) trade.amountNative = 0;
  const exec = opts?.execPriceNative && opts.execPriceNative > 0 ? opts.execPriceNative : trade.amountToken > 0 ? trade.amountNative / trade.amountToken : 0;
  if (!(trade.amountUsd > 0)) trade.amountUsd = trade.amountNative * q;
  if (!(trade.priceUsd > 0)) trade.priceUsd = exec * q;
  if (!(trade.mcapUsd > 0)) trade.mcapUsd = trade.priceUsd * e.supply;

  const an = e.an.onTrade(trade);
  const tags = new Set<TraderTag>(trade.tags ?? []);
  for (const tg of an.tags) tags.add(tg);
  trade.tags = [...tags];

  if (!insertTrade(e, trade)) return;
  const isLatest = trade.ts >= e.lastTradeTs;
  if (isLatest) e.lastTradeTs = trade.ts;
  t.txCount++;
  e.win.add(trade.ts, trade.amountUsd, trade.side, trade.priceUsd);
  if (trade.priceUsd > 0) {
    e.c15.add(trade.ts, trade.priceUsd, trade.amountUsd);
    e.c60.add(trade.ts, trade.priceUsd, trade.amountUsd);
  }

  if (opts?.spotPriceNative && opts.spotPriceNative > 0 && isLatest) t.priceNative = opts.spotPriceNative;
  else if (exec > 0 && isLatest) t.priceNative = exec;
  if (opts?.bondingPct !== undefined && Number.isFinite(opts.bondingPct) && isLatest) t.bondingPct = opts.bondingPct;
  if (opts?.liquidityNative !== undefined && opts.liquidityNative >= 0 && isLatest) e.liquidityNative = opts.liquidityNative;

  Object.assign(t, e.an.metrics());
  if (an.creatorSoldPct > 0) e.creatorSoldPct = Math.max(e.creatorSoldPct, an.creatorSoldPct);
  e.lastActivity = now;
  recompute(e, now);

  if (an.devSoldNow) {
    pushAlert(e, {
      kind: "dev-sold",
      at: trade.ts,
      severity: "warn",
      message:
        an.creatorSoldPct <= 0
          ? "Dev is selling (their buy predates our index)"
          : an.creatorSoldPct >= 99
            ? "Dev sold everything"
            : `Dev sold ${Math.round(an.creatorSoldPct)}% of their bag`,
    });
  }
  if (an.largeSell && now - e.lastLargeSellAlert > 60_000) {
    e.lastLargeSellAlert = now;
    pushAlert(e, {
      kind: "large-sell",
      at: trade.ts,
      severity: "warn",
      message: `Large sell: ${((trade.amountToken / e.supply) * 100).toFixed(1)}% of supply`,
    });
  }
  // Rug: dev sold > 80% within 1h of creation and price is down ≥ 70% from ATH.
  if (!e.rugged && t.devSold && e.creatorSoldPct > 80 && t.createdAt > 0 && trade.ts - t.createdAt < HOUR && e.athPriceUsd > 0 && t.priceUsd > 0 && t.priceUsd <= e.athPriceUsd * 0.3) {
    e.rugged = true;
    if (t.creator) {
      recordRug(t.creator, t.key);
      refreshCreatorTokens(t.creator);
    }
  }

  publish(`trades:${key}`, { t: "trade", trade });
  emit(e);
  markEvent(t.chain);
}

function updateMarket(key: string, m: MarketUpdate): void {
  const e = entries.get(normKey(key));
  if (!e) return;
  let changed = false;
  if (m.spotPriceNative !== undefined && m.spotPriceNative > 0 && Number.isFinite(m.spotPriceNative) && m.spotPriceNative !== e.t.priceNative) {
    e.t.priceNative = m.spotPriceNative;
    changed = true;
  }
  if (m.bondingPct !== undefined && Number.isFinite(m.bondingPct) && m.bondingPct !== e.t.bondingPct) {
    e.t.bondingPct = m.bondingPct;
    changed = true;
  }
  if (m.liquidityNative !== undefined && m.liquidityNative >= 0 && m.liquidityNative !== e.liquidityNative) {
    e.liquidityNative = m.liquidityNative;
    changed = true;
  }
  if (!changed) return;
  recompute(e);
  emit(e);
}

function removeKeys(keys: string[]): void {
  const perChain = new Map<ChainId, string[]>();
  for (const k of keys) {
    const e = entries.get(k);
    if (!e) continue;
    entries.delete(k);
    byChain.get(e.t.chain)?.delete(k);
    let arr = perChain.get(e.t.chain);
    if (!arr) {
      arr = [];
      perChain.set(e.t.chain, arr);
    }
    arr.push(k);
  }
  for (const [chain, arr] of perChain) {
    for (let i = 0; i < arr.length; i += 200) publish(`board:${chain}`, { t: "remove", keys: arr.slice(i, i + 200) });
  }
}

function sortPhase(list: Entry[], phase: TokenPhase): Entry[] {
  if (phase === "new") list.sort((a, b) => b.t.createdAt - a.t.createdAt);
  else if (phase === "almost") list.sort((a, b) => b.t.bondingPct - a.t.bondingPct || b.lastActivity - a.lastActivity);
  else list.sort((a, b) => (b.t.migratedAt ?? 0) - (a.t.migratedAt ?? 0));
  return list;
}

function entriesOf(chain: ChainId): Entry[] {
  const out: Entry[] = [];
  const set = byChain.get(chain);
  if (!set) return out;
  for (const k of set) {
    const e = entries.get(k);
    if (e) out.push(e);
  }
  return out;
}

function evict(): void {
  const now = Date.now();
  const drop: string[] = [];
  for (const chain of byChain.keys()) {
    const groups: Record<TokenPhase, Entry[]> = { new: [], almost: [], migrated: [] };
    for (const e of entriesOf(chain)) {
      if (e.pinned || e.keep || e.t.launchedHere) continue;
      if (now - e.lastActivity > e.ttlMs) {
        drop.push(e.t.key);
        continue;
      }
      if (e.onDemand) continue; // only its inactivity TTL evicts it
      groups[e.t.phase].push(e);
    }
    for (const phase of ["new", "almost", "migrated"] as const) {
      const list = groups[phase];
      if (list.length <= KEEP[phase]) continue;
      if (phase === "almost") list.sort((a, b) => b.lastActivity - a.lastActivity);
      else sortPhase(list, phase);
      for (const e of list.slice(KEEP[phase])) if (!e.t.launchedHere) drop.push(e.t.key);
    }
  }
  if (drop.length) removeKeys(drop);
}

/** Decay rolling windows and re-price USD fields when native prices move. */
function refresh(): void {
  const now = Date.now();
  for (const e of entries.values()) {
    const t = e.t;
    if (e.pinned) continue;
    const q = quoteUsdOf(e);
    const repriced = q > 0 && e.lastQuoteUsd > 0 ? Math.abs(q / e.lastQuoteUsd - 1) > 0.003 : q > 0 && e.lastQuoteUsd === 0 && t.priceNative > 0;
    const hadActivity = now - e.lastTradeTs < 25 * HOUR;
    if (!repriced && !hadActivity) continue;
    const before = `${t.volume5mUsd}|${t.volume1hUsd}|${t.volume24hUsd}|${t.buys5m}|${t.sells5m}|${t.change5mPct.toFixed(2)}|${t.change1hPct.toFixed(2)}|${t.phase}|${Math.round(t.mcapUsd)}`;
    recompute(e, now);
    const after = `${t.volume5mUsd}|${t.volume1hUsd}|${t.volume24hUsd}|${t.buys5m}|${t.sells5m}|${t.change5mPct.toFixed(2)}|${t.change1hPct.toFixed(2)}|${t.phase}|${Math.round(t.mcapUsd)}`;
    if (before !== after) emit(e);
  }
}

let timersStarted = false;
function ensureTimers(): void {
  if (timersStarted) return;
  timersStarted = true;
  setInterval(() => {
    try {
      evict();
    } catch (err) {
      console.error("[store] evict failed", err);
    }
  }, 30_000).unref();
  setInterval(() => {
    try {
      refresh();
    } catch (err) {
      console.error("[store] refresh failed", err);
    }
  }, 5_000).unref();
  onPricesChanged(() => {
    try {
      refresh();
    } catch {
      /* ignore */
    }
  });
}

/** Insert outside candles into buckets the series doesn't have yet (sorted, capped). Returns how many were inserted. */
function mergeCandles(series: CandleSeries, candles: Candle[]): number {
  const have = new Set<number>();
  for (const c of series.data) have.add(c.t);
  const add: Candle[] = [];
  for (const c of candles) {
    if (!(c.c > 0) || !(c.o > 0) || !Number.isFinite(c.t)) continue;
    const t = Math.floor(c.t / series.resSec) * series.resSec;
    if (have.has(t)) continue;
    have.add(t);
    add.push({ t, o: c.o, h: Math.max(c.h, c.o, c.c), l: Math.min(c.l > 0 ? c.l : c.o, c.o, c.c), c: c.c, v: c.v > 0 ? c.v : 0 });
  }
  if (!add.length) return 0;
  series.data.push(...add);
  series.data.sort((a, b) => a.t - b.t);
  if (series.data.length > series.max) series.data.splice(0, series.data.length - series.max);
  return add.length;
}

// ─── Public store object ────────────────────────────────────────────

export const tokenStore: TokenStoreEx = {
  get(key) {
    return entries.get(normKey(key))?.t;
  },

  has(key) {
    return entries.has(normKey(key));
  },

  detail(key) {
    const e = entries.get(normKey(key));
    if (!e) return undefined;
    const t = e.t;
    const holdersList = e.an.topHolders(50, t.priceUsd);
    if (t.pool && t.phase !== "migrated" && e.model === "curve") {
      const poolBal = Math.max(0, e.supply - e.an.totalHeld());
      holdersList.unshift({
        address: t.pool,
        balance: poolBal,
        pct: (poolBal / e.supply) * 100,
        tags: [],
        boughtUsd: 0,
        soldUsd: 0,
        pnlUsd: 0,
        isPool: true,
      });
    }
    const dep = e.dep;
    return {
      ...t,
      alerts: [...t.alerts],
      socials: { ...t.socials },
      holdersList,
      recentTrades: e.trades.slice(-50).reverse(),
      launchpadMeta: {
        graduationQuote: dep?.graduationQuote,
        curveSupplyShare: dep?.curveSupplyShare,
        migratesTo: dep?.migratesTo,
        snipeTax: dep?.snipeTax,
      },
    };
  },

  list(chain, phase, limit = 300) {
    const lim = Math.max(1, Math.min(1000, limit));
    const all = entriesOf(chain);
    if (phase) return sortPhase(all.filter((e) => e.t.phase === phase), phase).slice(0, lim).map((e) => e.t);
    const groups: Record<TokenPhase, Entry[]> = { new: [], almost: [], migrated: [] };
    for (const e of all) groups[e.t.phase].push(e);
    const quota: Record<TokenPhase, number> = { new: Math.ceil(lim * 0.5), almost: Math.floor(lim * 0.25), migrated: Math.floor(lim * 0.25) };
    const out: TokenSnapshot[] = [];
    const leftovers: Entry[] = [];
    for (const p of ["new", "almost", "migrated"] as const) {
      const sorted = sortPhase(groups[p], p);
      out.push(...sorted.slice(0, quota[p]).map((e) => e.t));
      leftovers.push(...sorted.slice(quota[p]));
    }
    if (out.length < lim) out.push(...leftovers.slice(0, lim - out.length).map((e) => e.t));
    return out;
  },

  search(q, limit = 20) {
    const raw = q.trim();
    if (!raw) return [];
    const ql = raw.toLowerCase();
    const bare = ql.startsWith("0x") ? ql.slice(2) : ql;
    const scored: { s: number; t: TokenSnapshot }[] = [];
    for (const e of entries.values()) {
      const t = e.t;
      const addr = t.address.toLowerCase();
      const addrBare = addr.startsWith("0x") ? addr.slice(2) : addr;
      const sym = t.symbol.toLowerCase();
      const name = t.name.toLowerCase();
      let s = 0;
      if (t.key.toLowerCase() === ql || addr === ql) s = 100;
      else if (bare.length >= 4 && addrBare.startsWith(bare)) s = 80;
      else if (sym === ql || sym === ql.replace(/^\$/, "")) s = 70;
      else if (sym.startsWith(ql.replace(/^\$/, ""))) s = 50;
      else if (name.startsWith(ql)) s = 40;
      else if (ql.length >= 3 && name.includes(ql)) s = 20;
      if (s > 0) scored.push({ s, t });
    }
    scored.sort((a, b) => b.s - a.s || b.t.mcapUsd - a.t.mcapUsd);
    return scored.slice(0, Math.max(1, Math.min(100, limit))).map((x) => x.t);
  },

  upsert(token) {
    register(token);
  },

  register,

  setMeta(key, opts) {
    const e = entries.get(normKey(key));
    if (!e) return;
    setMetaInternal(e, opts);
    recompute(e);
    emit(e);
  },

  patch(key, patch) {
    const e = entries.get(normKey(key));
    if (!e) return;
    mergeInto(e, patch, true);
    if (patch.priceNative !== undefined || patch.bondingPct !== undefined) e.lastActivity = Date.now();
    recompute(e);
    emit(e);
  },

  addTrade,
  updateMarket,

  migrate(key, info = {}) {
    const e = entries.get(normKey(key));
    if (!e) return;
    doMigrate(e, info);
    e.lastActivity = Date.now();
    recompute(e);
    emit(e);
  },

  alert(key, alert) {
    const e = entries.get(normKey(key));
    if (!e) return;
    pushAlert(e, alert);
    emit(e);
  },

  trades(key, limit = 100) {
    const e = entries.get(normKey(key));
    if (!e) return [];
    const n = Math.max(1, Math.min(MAX_TRADES, limit));
    return e.trades.slice(-n).reverse();
  },

  seedCandles(key, candles, resSec = 60) {
    const e = entries.get(normKey(key));
    if (!e) return 0;
    const res = Math.max(1, Math.round(resSec));
    // Sub-minute candles only fit the 15 s series; minute-and-up candles go into both.
    const n60 = res >= 60 ? mergeCandles(e.c60, candles) : 0;
    const n15 = mergeCandles(e.c15, candles);
    return Math.max(n60, n15);
  },

  enrich(key, ext) {
    const e = entries.get(normKey(key));
    if (!e) return;
    const now = Date.now();
    const before = visibleSig(e.t);
    if (ext.meta) applyMeta(e, ext.meta);
    const prev = e.ext;
    e.ext = {
      at: ext.at,
      holders: ext.holders ? { ...(prev && now - prev.at < EXT_HOLDERS_TTL ? prev.holders : {}), ...ext.holders } : prev?.holders,
      market: ext.market ?? (prev && now - prev.at < EXT_MARKET_TTL ? prev.market : undefined),
    };
    if (ext.phase) e.extPhase = { phase: ext.phase, at: ext.at };
    if (ext.bondingPct !== undefined && Number.isFinite(ext.bondingPct) && ownFeedQuiet(e, ext.at, now) && e.t.phase !== "migrated") {
      e.t.bondingPct = ext.bondingPct;
    }
    // Outside activity keeps a token alive on the board like our own trades do.
    const m = ext.market;
    if (m && ((m.volume5mUsd ?? 0) > 0 || (m.buys5m ?? 0) + (m.sells5m ?? 0) > 0 || (m.txCount ?? 0) > e.t.txCount)) e.lastActivity = now;
    if (ext.phase === "migrated" && e.t.phase !== "migrated") {
      doMigrate(e, { venue: ext.venue, pool: ext.pool, at: ext.migratedAt });
      e.lastActivity = now;
    }
    recompute(e, now);
    if (visibleSig(e.t) !== before) emit(e);
  },

  touch(key) {
    const e = entries.get(normKey(key));
    if (e) e.lastActivity = Math.max(e.lastActivity, Date.now());
  },

  launchedHereTokens() {
    const out: TokenSnapshot[] = [];
    for (const e of entries.values()) if (e.t.launchedHere) out.push(e.t);
    return out;
  },

  activityOf(key) {
    const e = entries.get(normKey(key));
    return e ? { lastActivity: e.lastActivity, lastTradeTs: e.lastTradeTs } : undefined;
  },

  candles(key, resolutionSec, limit = 300) {
    const e = entries.get(normKey(key));
    if (!e) return [];
    const lim = Math.max(1, Math.min(2000, limit));
    const res = Math.max(15, Math.round(resolutionSec));
    if (res < 60) return e.c15.aggregate(Math.round(res / 15) * 15 || 15, lim);
    return e.c60.aggregate(Math.round(res / 60) * 60, lim);
  },

  status() {
    return allChainStatuses();
  },

  markLaunchedHere(key, feeSplit) {
    const k = normKey(key);
    const e = entries.get(k);
    if (!e) {
      pendingLaunched.set(k, feeSplit);
      if (pendingLaunched.size > 5000) {
        const first = pendingLaunched.keys().next().value;
        if (first !== undefined) pendingLaunched.delete(first);
      }
      return;
    }
    e.t.launchedHere = true;
    if (feeSplit) e.t.feeSplit = feeSplit;
    emit(e);
  },

  purge(pred) {
    const drop: string[] = [];
    for (const [k, e] of entries) if (pred(e.t)) drop.push(k);
    removeKeys(drop);
    return drop.length;
  },

  count(chain) {
    if (!chain) return entries.size;
    return byChain.get(chain)?.size ?? 0;
  },

  isSimulated(key) {
    return entries.get(normKey(key))?.simulated ?? false;
  },
};

/** Run one eviction pass now (tests; production runs it every 30 s). */
export function evictNowForTests(): void {
  evict();
}

/** USD price of each chain's native token (kept fresh by ingest/prices). */
export function nativeUsd(chain: ChainId): number {
  return nativeUsdOf(chain);
}

/** Build an empty snapshot with sane defaults (adapters fill what they know). */
export function blankToken(init: Pick<TokenSnapshot, "chain" | "address" | "launchpad" | "name" | "symbol" | "creator" | "createdAt"> & Partial<TokenSnapshot>): TokenSnapshot {
  const isEvm = CHAINS[init.chain]?.kind === "evm";
  const address = isEvm ? init.address.toLowerCase() : init.address;
  // Explicit `undefined`s in init must not clobber defaults (e.g. quoteSymbol).
  const clean = Object.fromEntries(Object.entries(init).filter(([, v]) => v !== undefined)) as typeof init;
  return {
    key: `${init.chain}:${address}`,
    socials: {},
    phase: "new",
    bondingPct: 0,
    quoteSymbol: CHAINS[init.chain]?.nativeSymbol ?? "ETH",
    priceUsd: 0,
    priceNative: 0,
    mcapUsd: 0,
    liquidityUsd: 0,
    volume5mUsd: 0,
    volume1hUsd: 0,
    volume24hUsd: 0,
    buys5m: 0,
    sells5m: 0,
    txCount: 0,
    change5mPct: 0,
    change1hPct: 0,
    athMcapUsd: 0,
    buyTaxBps: 0,
    sellTaxBps: 0,
    holders: 0,
    top10Pct: 0,
    devHoldPct: 0,
    snipersPct: 0,
    snipersCount: 0,
    insidersPct: 0,
    bundlersPct: 0,
    bundlersCount: 0,
    freshWalletsPct: 0,
    kolBuys: 0,
    smartBuys: 0,
    devLaunches: 0,
    devMigrations: 0,
    devRugs: 0,
    devSold: false,
    dexPaid: false,
    launchedHere: false,
    alerts: [],
    updatedAt: Date.now(),
    ...clean,
    address,
  };
}
