// /api/insights/* (docs/API.md "Insights"). Public, per-IP rate limited; every GMGN read goes through the gateway queue +
// memory cache. When GMGN is disabled / paused / slow, answers fall back to our own store and carry `partial`.
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ChainId } from "@shared/chains";
import type {
  DevProfile, FeedSignal, FeedTrade, HolderRow, InsightsStatus, TokenInsights, TokenScores, TokenStats, WalletProfile, WalletTag,
} from "@shared/insights";
import type { Holder, TokenSnapshot } from "@shared/types";
import { nativeUsd, tokenStore } from "../store";
import { liveTradesStatus } from "../trades/live";
import { isOffensiveName } from "@shared/nameFilter";
import { UNKNOWN_SCORE, contractDD, devScore, holderAnalysis, klinePattern, walletProfileScores } from "./scores";
import { gateway, gm, gmgnChain, type GmgnResult } from "./gmgn";
import { applyInfo, boardItems, indexingStatus, infoTtl, noteViewer, parseKey, trenchItemOf, type ParsedKey } from "./indexing";
import {
  arr, candlesFrom, devCoinsFrom, devSummaryFrom, feedTradesFrom, holderRows, obj, poolFrom, securityFrom, signalsFrom, str,
  tokenSignalsFor, tokenStatsFromInfo, walletProfileFrom, walletRecentFrom,
} from "./normalize";

const WAIT_MS = 6_000; // a page waits at most this long for GMGN before we answer with what we have

// ─── per-IP rate limit ──────────────────────────────────────────────

const RATE = 10;
const BURST = 40;
const buckets = new Map<string, { tokens: number; at: number }>();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60_000).unref();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = typeof fwd === "string" ? fwd.split(",")[0].trim() : "";
  return first || req.socket.remoteAddress || "unknown";
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = clientIp(req);
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: BURST, at: now };
    buckets.set(ip, b);
  }
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE);
  b.at = now;
  if (b.tokens < 1) {
    res.setHeader("Retry-After", "1");
    res.status(429).json({ message: "Too many requests" });
    return;
  }
  b.tokens -= 1;
  noteViewer();
  next();
}

type Handler = (req: Request, res: Response) => Promise<void>;
function wrap(fn: Handler) {
  return (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    fn(req, res).catch((e) => {
      console.error("[insights] route failed:", e instanceof Error ? e.message : e);
      if (!res.headersSent) res.status(500).json({ message: "insights failed" });
    });
  };
}

function keyOf(req: Request, res: Response): ParsedKey | null {
  let raw = String(req.params.key ?? "");
  try {
    if (/%[0-9a-f]{2}/i.test(raw)) raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const pk = raw.length <= 200 ? parseKey(raw) : null;
  if (!pk) res.status(400).json({ message: "bad token key (expected <chain>:<address>)" });
  return pk;
}

const chainSchema = z.enum(["sol", "hood", "bsc", "base", "arc"]);
const intervalSchema = z.enum(["1m", "5m", "1h", "6h", "24h"]);
const ORDERS: Record<string, string> = {
  volume: "volume", swaps: "swaps", liquidity: "liquidity", marketcap: "marketcap", mcap: "marketcap", holders: "holders",
  price: "price", change: "change", change1m: "change1m", change5m: "change5m", change1h: "change1h", kol: "renowned_count",
  renowned_count: "renowned_count", smart: "smart_degen_count", smart_degen_count: "smart_degen_count", created: "creation_timestamp",
  creation_timestamp: "creation_timestamp", ath: "history_highest_market_cap",
};

function partialOf(...rs: (GmgnResult | null | undefined | string)[]): string | null {
  const parts: string[] = [];
  for (const r of rs) {
    if (!r) continue;
    if (typeof r === "string") parts.push(r);
    else if (!r.ok) parts.push(r.reason === "disabled" ? "GMGN disabled" : r.reason === "rate_limited" || gateway().isPaused() ? "GMGN rate limited" : `GMGN ${r.reason}`);
    else if (r.stale) parts.push("some data is from the cache");
  }
  return parts.length ? [...new Set(parts)].join("; ") : null;
}

function noGmgn(pk: ParsedKey): string | null {
  if (!pk.gchain) return "GMGN doesn't cover this chain";
  if (!gateway().enabled) return "GMGN disabled";
  return null;
}

// ─── fallbacks from our own store ───────────────────────────────────

function statsFromSnapshot(t: TokenSnapshot): TokenStats {
  const p = (v: number | undefined) => (typeof v === "number" ? v / 100 : null);
  return {
    priceUsd: t.priceUsd || null,
    mcapUsd: t.mcapUsd || null,
    liquidityUsd: t.liquidityUsd || null,
    holders: t.holders || null,
    windows: {
      "5m": { buys: t.buys5m, sells: t.sells5m, volumeUsd: t.volume5mUsd, buyVolumeUsd: 0, sellVolumeUsd: 0, swaps: t.buys5m + t.sells5m, priceChangePct: t.change5mPct },
      "1h": { buys: 0, sells: 0, volumeUsd: t.volume1hUsd, buyVolumeUsd: 0, sellVolumeUsd: 0, swaps: 0, priceChangePct: t.change1hPct },
      "24h": { buys: 0, sells: 0, volumeUsd: t.volume24hUsd, buyVolumeUsd: 0, sellVolumeUsd: 0, swaps: t.txCount },
    },
    top10Pct: p(t.top10Pct),
    snipersPct: p(t.snipersPct),
    bundlersPct: p(t.bundlersPct),
    insidersPct: p(t.insidersPct),
    freshPct: p(t.freshWalletsPct),
    botPct: p(t.botPct),
    ratPct: p(t.ratPct),
    devHoldPct: p(t.devHoldPct),
    counts: { sniper: t.snipersCount, bundler: t.bundlersCount, kol: t.kolBuys, smart: t.smartBuys },
    bondingPct: t.bondingPct,
    launchpad: t.launchpadLabel ?? t.launchpad,
    migrated: t.phase === "migrated",
    createdAt: t.createdAt,
    migratedAt: t.migratedAt ?? null,
  };
}

const TRADER_TO_WALLET: Partial<Record<string, WalletTag>> = {
  dev: "dev", sniper: "sniper", insider: "insider", bundler: "bundler", fresh: "fresh", kol: "kol", smart: "smart", whale: "whale",
};

function holdersFromStore(key: string, limit: number): HolderRow[] {
  const d = tokenStore.detail(key);
  if (!d || !d.holdersList.some((h: Holder) => !h.isPool)) return [];
  return d.holdersList.slice(0, limit).map((h: Holder, i) => {
    const tags = new Set<WalletTag>();
    for (const t of h.tags) if (TRADER_TO_WALLET[t]) tags.add(TRADER_TO_WALLET[t]!);
    if (h.isPool) tags.add("pool");
    if (i < 10 && !h.isPool) tags.add("top10");
    return {
      address: h.address,
      tags: [...tags],
      tools: [],
      rank: i + 1,
      pct: h.pct / 100,
      amount: h.balance,
      usdValue: d.priceUsd > 0 ? h.balance * d.priceUsd : null,
      realizedPnlUsd: null,
      unrealizedPnlUsd: null,
      pnlRatio: h.boughtUsd > 0 ? h.pnlUsd / h.boughtUsd : null,
    };
  });
}

/** Pool / curve addresses + creator of a token (for holder tags). */
function holderContext(key: string, info: unknown): { pools: Set<string>; creator: string | null } {
  const pools = new Set<string>();
  const t = tokenStore.get(key);
  if (t?.pool) pools.add(t.pool);
  const d = obj(info);
  for (const v of [d.biggest_pool_address, d.migrated_pool, obj(d.pool).pool_address]) {
    const s = str(v);
    if (s) pools.add(s);
  }
  return { pools, creator: str(obj(d.dev).creator_address) ?? (t?.creator || null) };
}

async function infoFor(pk: ParsedKey): Promise<GmgnResult | null> {
  if (noGmgn(pk)) return null;
  return gm.tokenInfo(pk.gchain!, pk.address, { lane: "interactive", ttlMs: infoTtl(pk.key), maxWaitMs: WAIT_MS });
}

// ─── handlers ───────────────────────────────────────────────────────

async function tokenInsights(pk: ParsedKey): Promise<TokenInsights | null> {
  const skip = noGmgn(pk);
  const o = { lane: "interactive" as const, maxWaitMs: WAIT_MS };
  const [ri, rs, rp] = skip
    ? [null, null, null]
    : await Promise.all([
        gm.tokenInfo(pk.gchain!, pk.address, { ...o, ttlMs: infoTtl(pk.key) }),
        gm.tokenSecurity(pk.gchain!, pk.address, o),
        gm.tokenPool(pk.gchain!, pk.address, o),
      ]);
  const info = ri?.ok ? ri.data : undefined;
  if (info) applyInfo(pk.key, pk.chain, info, { register: true }); // on-demand indexing / enrichment
  const snap = tokenStore.get(pk.key);
  if (!info && !snap) return null;
  if (snap) tokenStore.touch(pk.key);

  // Signals: the cached market-wide feed, filtered to this token; refreshed in the background when old.
  let signals: TokenInsights["signals"] = [];
  if (!skip) {
    const feed = gm.peekSignals(pk.gchain!);
    if (!feed || Date.now() - feed.at > 30_000) void gm.signals(pk.gchain!, { lane: "background" });
    if (feed) signals = tokenSignalsFor(signalsFrom(feed.data, pk.chain), pk.key);
  }
  const trench = trenchItemOf(pk.key);
  const dev = info || trench ? devSummaryFrom(info ?? {}, trench) : null;
  const d = obj(info);
  const link = obj(d.link);
  const ats = [ri, rs, rp].filter((r): r is Extract<GmgnResult, { ok: true }> => !!r && r.ok).map((r) => r.at);
  return {
    key: pk.key,
    chain: pk.chain,
    address: pk.address,
    name: str(d.name) ?? snap?.name ?? null,
    symbol: str(d.symbol) ?? snap?.symbol ?? null,
    image: str(d.logo) ?? snap?.image ?? null,
    socials: {
      twitter: snap?.socials.twitter ?? (str(link.twitter_username) ? `https://x.com/${str(link.twitter_username)}` : null),
      telegram: snap?.socials.telegram ?? str(link.telegram),
      website: snap?.socials.website ?? str(link.website),
      xFollowers: snap?.xFollowers ?? null,
    },
    stats: info ? tokenStatsFromInfo(info, { nativeUsd: nativeUsd(pk.chain) }) : statsFromSnapshot(snap!),
    security: rs?.ok ? securityFrom(rs.data, info) : null,
    pool: rp?.ok ? poolFrom(rp.data) : null,
    signals,
    dev,
    source: info ? "gmgn" : "claudio",
    updatedAt: ats.length ? Math.max(...ats) : snap?.updatedAt ?? Date.now(),
    partial: partialOf(skip, ri, rs, rp),
  };
}

function limitOf(req: Request, def: number): number {
  const n = Number(req.query.limit);
  return Number.isFinite(n) ? Math.max(20, Math.min(100, Math.round(n))) : def;
}

function chainQuery(req: Request): ChainId {
  const c = chainSchema.safeParse(req.query.chain ?? "sol");
  return c.success ? c.data : "sol";
}

async function feed(kind: "kol" | "smart", req: Request): Promise<{ data: FeedTrade[]; updatedAt: number | null; partial: string | null }> {
  const chain = chainQuery(req);
  const gchain = gmgnChain(chain);
  if (!gchain || !gateway().enabled) return { data: [], updatedAt: null, partial: gchain ? "GMGN disabled" : "GMGN doesn't cover this chain" };
  const r = kind === "kol" ? await gm.kol(gchain, { lane: "interactive", maxWaitMs: WAIT_MS }) : await gm.smartmoney(gchain, { lane: "interactive", maxWaitMs: WAIT_MS });
  const side = req.query.side === "buy" || req.query.side === "sell" ? req.query.side : null;
  const data = r.ok ? feedTradesFrom(r.data, chain).filter((t) => (!side || t.side === side) && !isOffensiveName(t.symbol, t.name)) : [];
  return { data, updatedAt: r.ok ? r.at : null, partial: partialOf(r) };
}

export function registerInsightsRoutes(app: Express): void {
  app.get("/api/insights/status", rateLimit, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body: InsightsStatus & { indexing: ReturnType<typeof indexingStatus> } = {
      gmgn: gateway().status(),
      liveTrades: liveTradesStatus(),
      indexing: indexingStatus(),
    };
    res.json(body);
  });

  app.get(
    "/api/insights/token/:key",
    rateLimit,
    wrap(async (req, res) => {
      const pk = keyOf(req, res);
      if (!pk) return;
      const out = await tokenInsights(pk);
      if (!out) return void res.status(404).json({ message: "token not indexed", partial: noGmgn(pk) ?? "GMGN has no data for this token" });
      res.json(out);
    }),
  );

  for (const kind of ["holders", "traders"] as const) {
    app.get(
      `/api/insights/token/:key/${kind}`,
      rateLimit,
      wrap(async (req, res) => {
        const pk = keyOf(req, res);
        if (!pk) return;
        const limit = limitOf(req, 50);
        const skip = noGmgn(pk);
        const r = skip ? null : kind === "holders" ? await gm.holders(pk.gchain!, pk.address, { lane: "interactive", maxWaitMs: WAIT_MS }) : await gm.traders(pk.gchain!, pk.address, { lane: "interactive", maxWaitMs: WAIT_MS });
        if (r?.ok) {
          const cachedInfo = gateway().peek("info", { query: { chain: pk.gchain!, address: pk.address } })?.data;
          res.json({ data: holderRows(r.data, holderContext(pk.key, cachedInfo)).slice(0, limit), updatedAt: r.at, source: "gmgn", partial: partialOf(r) });
          return;
        }
        res.json({ data: kind === "holders" ? holdersFromStore(pk.key, limit) : [], updatedAt: Date.now(), source: "claudio", partial: partialOf(skip, r) });
      }),
    );
  }

  app.get(
    "/api/insights/token/:key/dev",
    rateLimit,
    wrap(async (req, res) => {
      const pk = keyOf(req, res);
      if (!pk) return;
      const skip = noGmgn(pk);
      const ri = await infoFor(pk);
      const info = ri?.ok ? ri.data : undefined;
      const creator = str(obj(obj(info).dev).creator_address) ?? (tokenStore.get(pk.key)?.creator || null);
      if (!creator) return void res.status(404).json({ message: "dev unknown", partial: partialOf(skip, ri) });
      const o = { lane: "interactive" as const, maxWaitMs: WAIT_MS };
      const [rc, rw, ra] = skip
        ? [null, null, null]
        : await Promise.all([
            gm.createdTokens(pk.gchain!, creator, o),
            gm.walletStats(pk.gchain!, creator, "7d", o),
            gm.walletActivity(pk.gchain!, creator, { token: pk.address, limit: 50 }, o),
          ]);
      const created = rc?.ok ? rc.data : undefined;
      // The dev's highest-peaking coin (exit audit, real age): this coin's info when it is the flagship, else one more
      // token/info (weight 1, cached).
      const flagship = str(obj(obj(created).creator_ath_info).ath_token);
      let flagshipInfo: unknown = undefined;
      if (flagship && flagship === pk.address) flagshipInfo = info;
      else if (flagship && !skip) {
        const rf = await gm.tokenInfo(pk.gchain!, flagship, { lane: "interactive", maxWaitMs: 3_000 });
        if (rf.ok) flagshipInfo = rf.data;
      }
      const scores = devScore({
        createdTokens: created ?? null,
        walletStats: rw?.ok ? rw.data : undefined,
        devActivity: ra?.ok ? { [pk.address]: ra.data } : undefined,
        flagshipInfo,
      });
      const summary = devSummaryFrom(info ?? {}, trenchItemOf(pk.key), created) ?? {
        address: creator,
        launches: tokenStore.get(pk.key)?.devLaunches ?? 0,
        migrated: tokenStore.get(pk.key)?.devMigrations ?? 0,
        migratedRatio: 0,
        status: "unknown" as const,
      };
      const out: DevProfile & { partial: string | null; updatedAt: number } = {
        summary: { ...summary, address: creator },
        ...scores,
        coins: devCoinsFrom(created),
        partial: partialOf(skip, ri, rc, rw, ra),
        updatedAt: Date.now(),
      };
      res.json(out);
    }),
  );

  app.get(
    "/api/insights/token/:key/scores",
    rateLimit,
    wrap(async (req, res) => {
      const pk = keyOf(req, res);
      if (!pk) return;
      const skip = noGmgn(pk);
      const o = { lane: "interactive" as const, maxWaitMs: WAIT_MS };
      const now = Date.now();
      const [ri, rs, rh, rk] = skip
        ? [null, null, null, null]
        : await Promise.all([
            gm.tokenInfo(pk.gchain!, pk.address, { ...o, ttlMs: infoTtl(pk.key) }),
            gm.tokenSecurity(pk.gchain!, pk.address, o),
            gm.holders(pk.gchain!, pk.address, o),
            gm.kline(pk.gchain!, pk.address, "5m", now - 8 * 3_600_000, now, o),
          ]);
      const info = ri?.ok ? ri.data : null;
      const holders = rh?.ok ? rh.data : null;
      // A failed kline is "price not checked", not "0 candles" (that would be scored as a thin history).
      const candles = rk?.ok ? candlesFrom(rk.data) : undefined;
      const safe = <T>(fn: () => T, fallback: T): T => {
        try {
          return fn();
        } catch {
          return fallback;
        }
      };
      const out: TokenScores & { partial: string | null; updatedAt: number } = {
        safety: safe(() => contractDD({ info, security: rs?.ok ? rs.data : null, holders, candles }), UNKNOWN_SCORE),
        holders: rh && !rh.ok
          ? { ...UNKNOWN_SCORE, title: "Holders loading", summary: "Holder data is busy right now, so the holder structure can't be read yet. It retries on its own.", breakdown: [] }
          : safe(() => holderAnalysis({ info, holders }), { ...UNKNOWN_SCORE, breakdown: [] }),
        chart: safe(() => klinePattern({ candles: candles ?? [] }), { ...UNKNOWN_SCORE, pattern: "unknown" }),
        partial: partialOf(skip, ri, rs, rh, rk),
        updatedAt: Date.now(),
      };
      res.json(out);
    }),
  );

  app.get(
    "/api/insights/wallet/:chain/:address",
    rateLimit,
    wrap(async (req, res) => {
      const pk = parseKey(`${req.params.chain}:${req.params.address}`);
      if (!pk) return void res.status(400).json({ message: "bad wallet (expected /wallet/<chain>/<address>)" });
      const skip = noGmgn(pk);
      const o = { lane: "interactive" as const, maxWaitMs: WAIT_MS };
      const [rw, ra] = skip ? [null, null] : await Promise.all([gm.walletStats(pk.gchain!, pk.address, "7d", o), gm.walletActivity(pk.gchain!, pk.address, { limit: 50 }, o)]);
      const profile: WalletProfile = walletProfileFrom(rw?.ok ? rw.data : {}, pk.chain, pk.address);
      const { address, name, twitter, avatar, tags, tools } = profile;
      profile.recent = ra?.ok ? walletRecentFrom(ra.data, pk.chain, { address, name, twitter, avatar, tags, tools }).slice(0, 50) : [];
      let extra: Pick<WalletProfile, "style" | "score" | "review"> & { copy?: unknown } = { style: null, score: null, review: null };
      try {
        extra = walletProfileScores({ stats: rw?.ok ? rw.data : null, activity: ra?.ok ? ra.data : undefined });
      } catch {
        /* scores are best-effort */
      }
      res.json({ ...profile, ...extra, partial: partialOf(skip, rw, ra), updatedAt: Date.now() });
    }),
  );

  app.get("/api/insights/feed/kol", rateLimit, wrap(async (req, res) => void res.json(await feed("kol", req))));
  app.get("/api/insights/feed/smart", rateLimit, wrap(async (req, res) => void res.json(await feed("smart", req))));

  app.get(
    "/api/insights/feed/signals",
    rateLimit,
    wrap(async (req, res) => {
      const chain = chainQuery(req);
      const gchain = gmgnChain(chain);
      if (!gchain || !gateway().enabled) return void res.json({ data: [], updatedAt: null, partial: gchain ? "GMGN disabled" : "GMGN doesn't cover this chain" });
      const r = await gm.signals(gchain, { lane: "interactive", maxWaitMs: WAIT_MS });
      const data: FeedSignal[] = r.ok ? signalsFrom(r.data, chain).filter((x) => !isOffensiveName(x.symbol, x.name)) : [];
      res.json({ data, updatedAt: r.ok ? r.at : null, partial: partialOf(r) });
    }),
  );

  app.get(
    "/api/insights/trending",
    rateLimit,
    wrap(async (req, res) => {
      const chain = chainQuery(req);
      const gchain = gmgnChain(chain);
      const iv = intervalSchema.safeParse(req.query.interval ?? "1h");
      const interval = iv.success ? iv.data : "1h";
      const order = ORDERS[String(req.query.order ?? "volume")] ?? "volume";
      if (!gchain || !gateway().enabled) return void res.json({ data: [], updatedAt: null, partial: gchain ? "GMGN disabled" : "GMGN doesn't cover this chain" });
      const r = await gm.rank(gchain, interval, order, { lane: "interactive", maxWaitMs: WAIT_MS });
      const d = obj(r.ok ? r.data : null);
      const list = arr(obj(d.data).rank ?? d.rank);
      res.json({ data: boardItems(list, chain, { interval, enrichKnown: true }), updatedAt: r.ok ? r.at : null, partial: partialOf(r) });
    }),
  );

  app.get(
    "/api/insights/hot",
    rateLimit,
    wrap(async (req, res) => {
      const chain = chainQuery(req);
      const gchain = gmgnChain(chain);
      const iv = intervalSchema.safeParse(req.query.interval ?? "1h");
      const interval = iv.success ? iv.data : "1h";
      if (!gchain || !gateway().enabled) return void res.json({ data: [], updatedAt: null, partial: gchain ? "GMGN disabled" : "GMGN doesn't cover this chain" });
      const r = await gm.hot(gchain, interval, { lane: "interactive", maxWaitMs: WAIT_MS });
      const blocks = r.ok ? (Array.isArray(r.data) ? r.data : arr(obj(r.data).list)) : [];
      const list = blocks.flatMap((b) => arr(obj(b).tokens));
      res.json({ data: boardItems(list, chain, { interval, enrichKnown: true }), updatedAt: r.ok ? r.at : null, partial: partialOf(r) });
    }),
  );
}
