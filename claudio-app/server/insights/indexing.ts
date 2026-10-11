// Board indexing on top of the GMGN gateway (memory only — the token store; nothing is written to the database):
//   • on-demand lookup: a coin page / API hit for a token we don't index → GMGN token/info → register it (evictable after
//     30 min without views); GMGN can't answer → the caller keeps its 404;
//   • candle backfill: a thin series is filled from GMGN kline at the requested resolution;
//   • Trenches merge (board lane, every 10 s while someone is on the site, every 60 s otherwise): GMGN new / near /
//     completed → register unknown tokens, overlay wallet mix / dev / socials / counts on known ones (our own live prices
//     win), migrate completed ones;
//   • Claudio launches: registered the moment pump.fun confirms (and on boot from the launches table, read only),
//     launchedHere + never evicted, then enriched from GMGN; active ones are refreshed every ~15 s;
//   • GMGN search results merged into /api/search.
// Every store mutation publishes through the hub, so open boards update live.
import { CHAINS, type ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import type { Socials, TokenSnapshot } from "@shared/types";
import { blankToken, normKey, tokenStore } from "../store";
import { hasSubscribers, hubStats } from "../hub";
import { resolveUri } from "../ingest/meta";
import { gateway, gm, gmgnChain, type CallOpts, type Lane } from "./gmgn";
import { KLINE_RES, arr, candlesFrom, mapInfo, mapItem, obj, storeCandles, type GmgnSection } from "./normalize";

export const ON_DEMAND_TTL_MS = 30 * 60_000;
const INFO_TTL_WATCHED = 12_000;
const INFO_TTL = 60_000;

function log(msg: string): void {
  console.log(`${new Date().toLocaleTimeString("en-US", { hour12: true })} [insights] ${msg}`);
}

// ─── keys ───────────────────────────────────────────────────────────

export interface ParsedKey {
  key: string;
  chain: ChainId;
  address: string;
  /** GMGN chain name (null → GMGN doesn't cover this chain). */
  gchain: string | null;
}

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

export function parseKey(raw: string): ParsedKey | null {
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const chain = raw.slice(0, i) as ChainId;
  const info = CHAINS[chain];
  if (!info) return null;
  const addr = raw.slice(i + 1).trim();
  const ok = info.kind === "evm" ? EVM_ADDR.test(addr) : SOL_ADDR.test(addr);
  if (!ok) return null;
  const key = normKey(`${chain}:${addr}`);
  return { key, chain, address: key.slice(i + 1), gchain: gmgnChain(chain) };
}

/** 12 s while a page is watching the token, 60 s otherwise. */
export function infoTtl(key: string): number {
  return hasSubscribers(`token:${key}`) ? INFO_TTL_WATCHED : INFO_TTL;
}

// ─── viewers (cadence of the board merge) ───────────────────────────

let lastViewerAt = 0;
/** A request from a browser (board / token / insights) — keeps the 10 s cadence going. */
export function noteViewer(): void {
  lastViewerAt = Date.now();
}
function siteHasViewers(): boolean {
  return hubStats().clients > 0 || Date.now() - lastViewerAt < 2 * 60_000;
}

// ─── trenches items (dev summary for /token) ────────────────────────

const trenchItems = new Map<string, unknown>();
function rememberItem(key: string, item: unknown): void {
  trenchItems.delete(key);
  trenchItems.set(key, item);
  while (trenchItems.size > 3_000) {
    const first = trenchItems.keys().next().value;
    if (first === undefined) break;
    trenchItems.delete(first);
  }
}
export function trenchItemOf(key: string): unknown {
  return trenchItems.get(key);
}

// ─── info → store ───────────────────────────────────────────────────

/** Apply a GMGN token/info answer: enrich a known token, or register it on demand. Returns whether it is indexed now. */
export function applyInfo(key: string, chain: ChainId, info: unknown, opts: { register?: boolean } = {}): boolean {
  const m = mapInfo(info, chain);
  if (!m || m.snapshot.key !== key) return tokenStore.has(key);
  if (tokenStore.has(key)) {
    tokenStore.enrich(key, m.ext);
    return true;
  }
  if (!opts.register) return false;
  tokenStore.register(m.snapshot, {
    supply: m.supply,
    quoteUsd: m.quoteUsd,
    excluded: m.snapshot.pool ? [m.snapshot.pool] : [],
    onDemand: true,
    ttlMs: ON_DEMAND_TTL_MS,
  });
  tokenStore.enrich(key, m.ext);
  return true;
}

/** GMGN token/info for a token on the board (or to register it). Never throws. */
export async function enrichToken(key: string, opts: { lane?: Lane; register?: boolean; maxWaitMs?: number; ttlMs?: number } = {}): Promise<{ ok: boolean; info?: unknown; reason?: string }> {
  const pk = parseKey(key);
  if (!pk || !pk.gchain) return { ok: false, reason: "chain not covered by GMGN" };
  const call: CallOpts = { lane: opts.lane ?? "interactive", ttlMs: opts.ttlMs ?? infoTtl(pk.key) };
  const p = gm.tokenInfo(pk.gchain, pk.address, call).then((r) => {
    if (r.ok) applyInfo(pk.key, pk.chain, r.data, { register: opts.register });
    return r;
  });
  const r = opts.maxWaitMs ? await Promise.race([p, sleep(opts.maxWaitMs).then(() => null)]) : await p;
  if (!r) return { ok: false, reason: "timeout" };
  return r.ok ? { ok: true, info: r.data } : { ok: false, reason: r.reason };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

/**
 * On-demand lookup: make sure `key` is on the board. Waits up to `waitMs` for GMGN (interactive lane); a slower answer
 * still registers the token when it lands (so the page's retry finds it). False → keep the 404.
 */
export async function lookupToken(rawKey: string, waitMs = 2_500): Promise<boolean> {
  const pk = parseKey(rawKey);
  if (!pk) return tokenStore.has(rawKey);
  if (tokenStore.has(pk.key)) {
    tokenStore.touch(pk.key);
    return true;
  }
  if (!pk.gchain || !gateway().enabled) return false;
  await enrichToken(pk.key, { lane: "interactive", register: true, maxWaitMs: waitMs });
  return tokenStore.has(pk.key);
}

// ─── candles ────────────────────────────────────────────────────────

const backfilled = new Map<string, number>();

/** Fill a thin candle series from GMGN kline (resolution matching the request). Returns candles inserted. */
export async function backfillCandles(rawKey: string, resSec: number, limit: number, waitMs = 2_500): Promise<number> {
  const pk = parseKey(rawKey);
  if (!pk || !pk.gchain || !gateway().enabled || !tokenStore.has(pk.key)) return 0;
  const map = KLINE_RES[resSec] ?? KLINE_RES[60];
  const k = `${pk.key}|${map.res}`;
  const now = Date.now();
  if ((backfilled.get(k) ?? 0) > now - 60_000) return 0;
  backfilled.set(k, now);
  if (backfilled.size > 5_000) {
    for (const [kk, at] of backfilled) if (at < now - 60_000) backfilled.delete(kk);
  }
  const span = Math.min(Math.max(limit, 30), 300) * map.sec * 1000;
  const p = gm.kline(pk.gchain, pk.address, map.res, now - span, now, { lane: "interactive" }).then((r) => {
    if (!r.ok) return 0;
    return tokenStore.seedCandles(pk.key, storeCandles(candlesFrom(r.data)), map.sec);
  });
  const n = await Promise.race([p, sleep(waitMs).then(() => 0)]);
  return n;
}

// ─── trenches merge ─────────────────────────────────────────────────

export interface MergeResult {
  seen: number;
  registered: number;
  enriched: number;
  migrated: number;
  skipped: number;
}

/** Merge a GMGN trenches answer into the store. */
export function mergeTrenches(data: unknown, chain: ChainId = "sol", now = Date.now()): MergeResult {
  const d = obj(data);
  const res: MergeResult = { seen: 0, registered: 0, enriched: 0, migrated: 0, skipped: 0 };
  const sections: [GmgnSection, unknown][] = [
    ["new_creation", d.new_creation],
    ["near_completion", d.near_completion ?? d.pump],
    ["completed", d.completed],
  ];
  for (const [section, list] of sections) {
    for (const item of arr(list)) {
      const m = mapItem(item, chain, { section, now });
      if (!m) continue;
      res.seen++;
      const key = m.snapshot.key;
      rememberItem(key, item);
      const before = tokenStore.get(key);
      if (before) {
        const wasMigrated = before.phase === "migrated";
        tokenStore.enrich(key, m.ext);
        res.enriched++;
        if (!wasMigrated && tokenStore.get(key)?.phase === "migrated") res.migrated++;
        continue;
      }
      if (!m.known) {
        res.skipped++;
        continue;
      }
      tokenStore.register(m.snapshot, { supply: m.supply, quoteUsd: m.quoteUsd, excluded: m.snapshot.pool ? [m.snapshot.pool] : [] });
      tokenStore.enrich(key, m.ext);
      res.registered++;
    }
  }
  return res;
}

/** Board-shaped snapshots for rank / hot / search items: the store's copy when we index the token, else the mapped one. */
export function boardItems(list: unknown[], chain: ChainId, opts: { interval?: string; enrichKnown?: boolean } = {}): TokenSnapshot[] {
  const out: TokenSnapshot[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  for (const item of list) {
    const m = mapItem(item, chain, { interval: opts.interval, now });
    if (!m || seen.has(m.snapshot.key)) continue;
    seen.add(m.snapshot.key);
    if (tokenStore.has(m.snapshot.key)) {
      if (opts.enrichKnown) tokenStore.enrich(m.snapshot.key, m.ext);
      out.push(tokenStore.get(m.snapshot.key)!);
    } else out.push(m.snapshot);
  }
  return out;
}

// ─── search ─────────────────────────────────────────────────────────

/** GMGN search (interactive, cached 30 s) → board snapshots not already in `exclude`. */
export async function searchGmgn(q: string, exclude: Set<string>, limit: number, waitMs = 2_000): Promise<TokenSnapshot[]> {
  if (!gateway().enabled || q.trim().length < 2) return [];
  const r = await gm.search(q.trim(), "sol", { lane: "interactive", maxWaitMs: waitMs });
  if (!r.ok) return [];
  const coins = arr(obj(r.data).coins);
  return boardItems(coins, "sol")
    .filter((t) => !exclude.has(t.key))
    .slice(0, limit);
}

// ─── Claudio launches ───────────────────────────────────────────────

/** What indexing needs from a launch record (server/launch/types LaunchRecord satisfies it). */
export interface LaunchLike {
  chain: ChainId;
  launchpad: LaunchpadId;
  token?: string;
  name: string;
  symbol: string;
  imageUri?: string;
  creator: string;
  createdAt: number;
  curve?: string;
  splitter?: string;
  splitKind?: string;
  request?: { description?: string; socials?: Socials; creator?: string };
}

const FEE_KINDS = new Set(["native-locked", "splitter", "native-mutable", "splitter-weak"]);

/**
 * Put a Claudio launch on the board right away (launchedHere, never evicted) from its launch record, then enrich it from
 * GMGN (interactive lane, no wait). Idempotent.
 */
export function indexClaudioLaunch(r: LaunchLike, opts: { feeSplit?: TokenSnapshot["feeSplit"]; enrich?: boolean; lane?: Lane } = {}): string | null {
  if (!r.token) return null;
  const pk = parseKey(`${r.chain}:${r.token}`);
  if (!pk) return null;
  const key = pk.key;
  if (!tokenStore.has(key)) {
    const socials: Socials = {};
    for (const [k, v] of Object.entries(r.request?.socials ?? {})) if (typeof v === "string" && v) (socials as Record<string, string>)[k] = v;
    tokenStore.register(
      blankToken({
        chain: r.chain,
        address: pk.address,
        launchpad: r.launchpad,
        name: (r.name ?? "").slice(0, 64) || "Unknown",
        symbol: (r.symbol ?? "").slice(0, 16) || "???",
        creator: r.creator ?? "",
        createdAt: r.createdAt || Date.now(),
        image: resolveUri(r.imageUri),
        description: r.request?.description?.slice(0, 500) || undefined,
        socials,
        pool: r.curve,
        launchedHere: true,
      }),
      { keep: true, excluded: r.curve ? [r.curve] : [] },
    );
  } else {
    tokenStore.setMeta(key, { keep: true });
  }
  const feeSplit =
    opts.feeSplit ?? (r.splitKind && FEE_KINDS.has(r.splitKind) ? { kind: r.splitKind as NonNullable<TokenSnapshot["feeSplit"]>["kind"], splitter: r.splitter } : undefined);
  tokenStore.markLaunchedHere(key, feeSplit);
  if (opts.enrich !== false && pk.gchain && gateway().enabled) void enrichToken(key, { lane: opts.lane ?? "interactive" });
  return key;
}

/** Boot: every confirmed Claudio launch back on the board (launches table, read only), the newest enriched. */
export async function reloadClaudioLaunches(): Promise<number> {
  const { launchStore } = await import("../launch/store");
  const rows = await launchStore.confirmed(1_000).catch(() => []);
  let n = 0;
  rows.forEach((r, i) => {
    if (!r.token) return;
    // Newest 30 get a GMGN refresh in the background lane; the rest wait for activity / the slow sweep.
    if (indexClaudioLaunch(r, { enrich: i < 30, lane: "background" })) n++;
  });
  if (n) log(`re-indexed ${n} confirmed Claudio launch(es)`);
  return n;
}

// ─── loops ──────────────────────────────────────────────────────────

const TRENCHES_FAST_MS = 10_000;
const TRENCHES_IDLE_MS = 60_000;
const CLAUDIO_ACTIVE_MS = 15_000;
const CLAUDIO_SWEEP_MS = 5 * 60_000;

let started = false;
let lastTrenches = 0;
let lastSweep = 0;
const loopStats = { trenchesRuns: 0, lastMerge: null as MergeResult | null, lastMergeAt: 0, claudioRefreshes: 0 };

export function indexingStatus() {
  return { ...loopStats, lastMergeAt: loopStats.lastMergeAt || null, viewers: siteHasViewers() };
}

function trenchesChains(): ChainId[] {
  const raw = (process.env.GMGN_TRENCHES_CHAINS ?? "sol").split(",").map((s) => s.trim()).filter(Boolean);
  return raw.filter((c): c is ChainId => !!CHAINS[c as ChainId] && !!gmgnChain(c));
}

async function trenchesTick(): Promise<void> {
  const g = gateway();
  if (!g.enabled || g.isPaused()) return;
  const now = Date.now();
  if (now - lastTrenches < (siteHasViewers() ? TRENCHES_FAST_MS : TRENCHES_IDLE_MS) - 500) return;
  if (g.queued("board") > 10) return; // backed up: skip a round rather than pile up
  lastTrenches = now;
  for (const chain of trenchesChains()) {
    const r = await gm.trenches(gmgnChain(chain)!, { lane: "board", fresh: true, ttlMs: TRENCHES_FAST_MS - 2_000 });
    if (!r.ok || r.stale) continue;
    loopStats.lastMerge = mergeTrenches(r.data, chain);
    loopStats.lastMergeAt = Date.now();
    loopStats.trenchesRuns++;
  }
}

function claudioTick(): void {
  const g = gateway();
  if (!g.enabled || g.isPaused()) return;
  const now = Date.now();
  const sweep = now - lastSweep > CLAUDIO_SWEEP_MS;
  if (sweep) lastSweep = now;
  const coins = tokenStore
    .launchedHereTokens()
    .filter((t) => gmgnChain(t.chain))
    .map((t) => ({ t, act: tokenStore.activityOf(t.key)?.lastActivity ?? 0 }));
  const active = coins
    .filter(({ t, act }) => now - t.createdAt < 3_600_000 || now - act < 3_600_000 || t.volume1hUsd > 0)
    .sort((a, b) => b.act - a.act)
    .slice(0, 12);
  for (const { t } of active) {
    loopStats.claudioRefreshes++;
    void enrichToken(t.key, { lane: "board", ttlMs: 12_000 });
  }
  if (sweep) {
    const activeKeys = new Set(active.map((a) => a.t.key));
    for (const { t } of coins.filter((c) => !activeKeys.has(c.t.key)).slice(0, 30)) void enrichToken(t.key, { lane: "background" });
  }
}

export function startIndexingLoops(): void {
  if (started) return;
  started = true;
  if (!gateway().enabled) log("GMGN_API_KEY not set — GMGN enrichment off (endpoints answer with `partial`)");
  void reloadClaudioLaunches().catch((e) => log(`launch reload failed: ${(e as Error).message}`));
  const t1 = setInterval(() => void trenchesTick().catch((e) => log(`trenches merge failed: ${(e as Error).message}`)), 1_000);
  const t2 = setInterval(() => {
    try {
      claudioTick();
    } catch (e) {
      log(`claudio refresh failed: ${(e as Error).message}`);
    }
  }, CLAUDIO_ACTIVE_MS);
  t1.unref?.();
  t2.unref?.();
}
