// GMGN gateway + insights check (offline: fetch is mocked, nothing reaches GMGN). Covers:
//   • limiter: burst + steady rate, weight bucket, 429 → global pause until X-RateLimit-Reset (no sends while paused),
//     rate halved, AIMD recovery, lane priority, queue drops, deadlines;
//   • coalescing (+ lane promotion), cache TTL, stale-while-revalidate, negative cache, disabled mode, key redaction;
//   • normalizers against every recorded fixture (wallet tags incl. every tag value seen, stats windows, signals 1–21,
//     security warnings, feeds, wallet profile, candles, trenches / rank / hot / search → board snapshots);
//   • Trenches merge into a fresh store (register / enrich / migrate, our live price wins, overlay survives trades);
//   • on-demand lookup with a mocked fetch (hit, miss → 404 path, slow answer registers later);
//   • Claudio launch registration (launchedHere, never evicted) + boot reload from the launches table.
//
//   npx tsx server/insights/gmgn.check.ts                     (committed trimmed fixtures in server/insights/fixtures)
//   GMGN_FIXTURES=<dir of full recorded envelopes> npx tsx …  (the full recordings)
delete process.env.DATABASE_URL;
delete process.env.GMGN_API_KEY;
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { GmgnGateway, setGatewayForTests, type FetchLike } from "./gmgn";
import * as N from "./normalize";

let failures = 0;
function ok(cond: unknown, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FIX = process.env.GMGN_FIXTURES || join(import.meta.dirname ?? __dirname, "fixtures");
function fx(name: string): { code: number; data: unknown } {
  return JSON.parse(readFileSync(join(FIX, `${name}.json`), "utf8"));
}

// ─── mock fetch ─────────────────────────────────────────────────────

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; delayMs?: number; throws?: string };
interface MockCall {
  at: number;
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
function mockFetch(handler: (c: MockCall, n: number) => Reply | Promise<Reply>): { fetch: FetchLike; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const c: MockCall = { at: Date.now(), url, path: u.pathname, method: init.method, headers: init.headers, body: init.body };
    calls.push(c);
    const r = await handler(c, calls.length);
    if (r.delayMs) await sleep(r.delayMs);
    if (r.throws) throw new Error(r.throws);
    const h = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status ?? 200, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => JSON.stringify(r.body ?? { code: 0, data: { ok: true } }) };
  };
  return { fetch, calls };
}
const KEY = "test-secret-key-0123456789";
function gw(fetch: FetchLike, o: ConstructorParameters<typeof GmgnGateway>[0] = {}) {
  return new GmgnGateway({ apiKey: KEY, fetch, jitterMs: [0, 5], log: () => {}, ...o });
}

async function limiterChecks(): Promise<void> {
  console.log("\nlimiter");
  {
    const m = mockFetch(() => ({}));
    const g = gw(m.fetch, { rps: 20, maxRps: 20, burst: 2, weightRate: 1000, weightBurst: 1000, maxConcurrent: 10 });
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 10 }, (_, i) => g.call("info", { query: { address: `a${i}` } })));
    const dt = Date.now() - t0;
    ok(m.calls.length === 10, "10 distinct calls → 10 sends");
    ok(m.calls[1].at - t0 < 40, "burst of 2 goes out at once");
    ok(dt >= 8 * 50 * 0.85, `the other 8 are paced at 20/s (took ${dt} ms ≥ ~400)`);
    const q = new URL(m.calls[0].url).searchParams;
    ok(m.calls[0].headers["X-APIKEY"] === KEY && /^\d{10}$/.test(q.get("timestamp") ?? "") && /^[0-9a-f-]{36}$/.test(q.get("client_id") ?? ""), "exist auth: X-APIKEY header + timestamp (s) + fresh client_id");
    ok(new Set(m.calls.map((c) => new URL(c.url).searchParams.get("client_id"))).size === 10, "client_id is unique per request");
  }
  {
    // Weight bucket: holders (weight 5) with capacity 5 at 50 w/s → ~100 ms apart even though req tokens allow more.
    const m = mockFetch(() => ({}));
    const g = gw(m.fetch, { rps: 100, maxRps: 100, burst: 10, weightRate: 50, weightBurst: 5, maxConcurrent: 10 });
    await Promise.all(Array.from({ length: 3 }, (_, i) => g.call("holders", { query: { address: `h${i}` } })));
    const gaps = [m.calls[1].at - m.calls[0].at, m.calls[2].at - m.calls[1].at];
    ok(gaps.every((x) => x >= 85), `weight-5 calls are spaced by the weight bucket (gaps ${gaps.join(", ")} ms)`);
  }
  {
    // 429 with X-RateLimit-Reset → global pause, nothing sent during it, rate halved, the job retried after the reset.
    let resetAt = 0;
    const m = mockFetch((c, n) => {
      if (n === 1) {
        resetAt = Math.ceil(Date.now() / 1000) + 1; // unix seconds
        return { status: 429, headers: { "X-RateLimit-Reset": String(resetAt) }, body: { code: 429, error: "RATE_LIMIT_EXCEEDED", message: "rate limit" } };
      }
      return { body: { code: 0, data: { path: c.path } } };
    });
    const g = gw(m.fetch, { rps: 20, maxRps: 20, burst: 5, weightRate: 1000, weightBurst: 1000, maxConcurrent: 1 });
    const first = g.call("info", { query: { address: "x" } });
    await sleep(30);
    const st = g.status();
    ok(st.pausedUntil && st.pausedUntil >= resetAt * 1000, "429 → paused until X-RateLimit-Reset");
    ok(st.ratePerSec === 10, `rate halved 20 → ${st.ratePerSec}`);
    const others = [g.call("security", { query: { address: "x" } }, { lane: "interactive" }), g.call("pool", { query: { address: "x" } }, { lane: "board" })];
    const r = await first;
    ok(r.ok, "the rate-limited call is retried once after the pause and succeeds");
    await Promise.all(others);
    const during = m.calls.filter((c) => c.at > m.calls[0].at && c.at < resetAt * 1000);
    ok(during.length === 0, `no request sent while paused (${during.length})`);
    ok(m.calls.length === 4, "after the reset: retry + the 2 queued calls");
  }
  {
    // 429 without the header → default pause.
    const m = mockFetch((_c, n) => (n === 1 ? { status: 429, body: { code: 429, error: "RATE_LIMIT_BANNED" } } : {}));
    const g = gw(m.fetch, { rps: 20, maxRps: 20, burst: 5, pauseDefaultMs: 300, maxConcurrent: 1 });
    const t0 = Date.now();
    await g.call("info", { query: { address: "y" } });
    ok(m.calls.length === 2 && m.calls[1].at - t0 >= 290, `no reset header → ${300} ms default pause (retry after ${m.calls[1].at - t0} ms)`);
  }
  {
    // AIMD recovery: +step after recoverAfterMs without a 429, capped at max.
    const m = mockFetch((_c, n) => (n === 1 ? { status: 429, body: { code: 429, error: "RATE_LIMIT_EXCEEDED" } } : {}));
    const g = gw(m.fetch, { rps: 20, maxRps: 21, burst: 5, weightRate: 1000, weightBurst: 1000, pauseDefaultMs: 50, recoverAfterMs: 400, recoverStep: 5, maxConcurrent: 1 });
    await g.call("info", { query: { address: "z" } });
    const halved = g.status().ratePerSec;
    await sleep(450);
    await g.call("info", { query: { address: "z2" } });
    const r1 = g.status().ratePerSec;
    await sleep(450);
    await g.call("info", { query: { address: "z3" } });
    await sleep(450);
    await g.call("info", { query: { address: "z4" } });
    const r3 = g.status().ratePerSec;
    ok(halved === 10, `20 → ${halved} after a 429 (multiplicative decrease)`);
    ok(r1 === 15, `+step after a quiet window (${r1})`);
    ok(r3 === 21, `capped at GMGN_MAX_RPS (${r3})`);
  }
  {
    // Lane priority: one slot; the first call holds it while others queue.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = mockFetch(async (_c, n) => {
      if (n === 1) await gate;
      return {};
    });
    const g = gw(m.fetch, { rps: 1000, maxRps: 1000, burst: 100, weightRate: 1e6, weightBurst: 1e6, maxConcurrent: 1 });
    const ps = [g.call("info", { query: { address: "hold" } }, { lane: "background" })];
    await sleep(10);
    ps.push(g.call("info", { query: { address: "bg1" } }, { lane: "background" }));
    ps.push(g.call("info", { query: { address: "bd1" } }, { lane: "board" }));
    ps.push(g.call("info", { query: { address: "ia1" } }, { lane: "interactive" }));
    ps.push(g.call("info", { query: { address: "bd2" } }, { lane: "board" }));
    ps.push(g.call("info", { query: { address: "ia2" } }, { lane: "interactive" }));
    release();
    await Promise.all(ps);
    const order = m.calls.map((c) => new URL(c.url).searchParams.get("address"));
    ok(order.join(",") === "hold,ia1,ia2,bd1,bd2,bg1", `interactive > board > background (${order.join(",")})`);
  }
  {
    // Queue bounds: background is shed for interactive; a full lane rejects; deadlines drop stale work.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = mockFetch(async (_c, n) => {
      if (n === 1) await gate;
      return {};
    });
    const g = gw(m.fetch, { rps: 1000, maxRps: 1000, burst: 100, maxConcurrent: 1, maxQueue: 3, laneMax: { background: 2 }, laneDeadlineMs: { board: 50 } });
    const hold = g.call("info", { query: { address: "hold" } });
    await sleep(5);
    const b1 = g.call("info", { query: { address: "b1" } }, { lane: "background" });
    const b2 = g.call("info", { query: { address: "b2" } }, { lane: "background" });
    const b3 = await g.call("info", { query: { address: "b3" } }, { lane: "background" });
    ok(!b3.ok && b3.reason === "dropped", "background lane full → new background call rejected");
    const d1 = g.call("info", { query: { address: "d1" } }, { lane: "board" });
    const i1 = g.call("info", { query: { address: "i1" } }, { lane: "interactive" });
    const rb1 = await b1;
    ok(!rb1.ok && rb1.reason === "dropped", "queue full → oldest background dropped for interactive work");
    await sleep(80);
    release();
    const [rd1, ri1, rb2] = await Promise.all([d1, i1, b2, hold]);
    ok(!rd1.ok && rd1.reason === "dropped", "board call past its lane deadline is dropped, never sent");
    ok(ri1.ok && rb2.ok, "interactive + remaining background still served");
    ok(!m.calls.some((c) => c.url.includes("address=d1")), "the expired call never reached GMGN");
    ok(g.status().dropped1m === 3, `drops are counted (${g.status().dropped1m})`);
  }
}

async function cacheChecks(): Promise<void> {
  console.log("\ncoalescing + cache");
  {
    const m = mockFetch(() => ({ delayMs: 30, body: { code: 0, data: { v: 1 } } }));
    const g = gw(m.fetch, { rps: 100, maxRps: 100, burst: 10 });
    const [a, b, c] = await Promise.all([
      g.call("info", { query: { chain: "sol", address: "same" } }, { lane: "background" }),
      g.call("info", { query: { address: "same", chain: "sol" } }, { lane: "interactive" }),
      g.call("info", { query: { chain: "sol", address: "same" } }),
    ]);
    ok(m.calls.length === 1, "3 identical in-flight requests (any param order) → 1 GMGN call");
    ok(a.ok && b.ok && c.ok && (a as { data: { v: number } }).data.v === 1, "all callers get the data");
  }
  {
    let v = 0;
    const m = mockFetch(() => ({ body: { code: 0, data: { v: ++v } } }));
    const g = gw(m.fetch, { rps: 100, maxRps: 100, burst: 10 });
    const spec = { query: { address: "ttl" } };
    const r1 = await g.call("info", spec, { ttlMs: 100 });
    const r2 = await g.call("info", spec, { ttlMs: 100 });
    ok(r1.ok && !r1.cached && r2.ok && r2.cached && !r2.stale && m.calls.length === 1, "within TTL → cache hit, no call");
    await sleep(130);
    const r3 = await g.call("info", spec, { ttlMs: 100 });
    ok(r3.ok && r3.stale && (r3 as { data: { v: number } }).data.v === 1, "past TTL → stale copy served immediately");
    await sleep(30);
    ok(m.calls.length === 2, "… while a background refresh runs");
    const r4 = await g.call("info", spec, { ttlMs: 100 });
    ok(r4.ok && !r4.stale && (r4 as { data: { v: number } }).data.v === 2, "refreshed copy served next");
    await sleep(520);
    const r5 = await g.call("info", spec, { ttlMs: 100 });
    ok(r5.ok && !r5.cached && m.calls.length === 3, "older than 5× TTL → treated as a miss (waits for fresh data)");
    const r6p = g.call("info", { query: { address: "fresh" } }, { ttlMs: 100 });
    await r6p;
    await sleep(130);
    const n = m.calls.length;
    const r6 = await g.call("info", { query: { address: "fresh" } }, { ttlMs: 100, fresh: true });
    ok(r6.ok && !r6.stale && m.calls.length === n + 1, "fresh:true skips stale-while-revalidate");
    ok(g.status().hitRate > 0 && g.status().cacheEntries >= 2, "status reports cache entries + hit rate");
  }
  {
    const m = mockFetch(() => ({ body: { code: 40001, error: "BAD_REQUEST", message: "token not found" } }));
    const g = gw(m.fetch);
    const a = await g.call("info", { query: { address: "nope" } });
    const b = await g.call("info", { query: { address: "nope" } });
    ok(!a.ok && a.reason === "api" && !b.ok && m.calls.length === 1, "API error → negative-cached (asked once)");
  }
  {
    const m = mockFetch(() => ({ throws: `connect ECONNREFUSED with key ${KEY}` }));
    const g = gw(m.fetch);
    const r = await g.call("info", { query: { address: "net" } });
    ok(!r.ok && r.reason === "network" && m.calls.length === 2, "network error → one retry, then fails");
    ok(!r.ok && !r.error.includes(KEY) && r.error.includes("***"), "the key is redacted from errors");
    ok(!JSON.stringify(g.status()).includes(KEY), "status never contains the key");
  }
  {
    const m = mockFetch(() => ({}));
    const g = new GmgnGateway({ apiKey: "", fetch: m.fetch, log: () => {} });
    const r = await g.call("info", { query: { address: "x" } });
    ok(!g.enabled && !r.ok && r.reason === "disabled" && m.calls.length === 0, "no GMGN_API_KEY → disabled, nothing sent");
    ok(g.status().enabled === false && !!g.status().reason, "status explains why");
  }
  {
    const m = mockFetch(() => ({ delayMs: 200 }));
    const g = gw(m.fetch);
    const t0 = Date.now();
    const r = await g.call("info", { query: { address: "slow" } }, { maxWaitMs: 50 });
    ok(!r.ok && r.reason === "timeout" && Date.now() - t0 < 150, "maxWaitMs → answers after the wait");
    await sleep(220);
    const r2 = await g.call("info", { query: { address: "slow" } });
    ok(r2.ok && r2.cached && m.calls.length === 1, "… and the slow answer still lands in the cache");
  }
}

function normalizerChecks(): void {
  console.log(`\nnormalizers (${FIX})`);
  const files = readdirSync(FIX).filter((f) => f.endsWith(".json"));
  ok(files.length >= 23, `${files.length} fixtures`);
  for (const f of files) ok(fx(f.replace(/\.json$/, "")).code === 0, `${f}: envelope code 0`);

  // Every tag value in every fixture is either mapped or deliberately ignored.
  const IGNORED_TAGS = new Set(["top_renamed", "bluechip_owner"]);
  const IGNORED_MAKER = new Set(["top_holder", "paper_hands", "diamond_hands", "transfer_in"]);
  const tags = new Set<string>();
  const maker = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === "tags" && Array.isArray(v)) v.forEach((t) => typeof t === "string" && tags.add(t));
        if (k === "maker_token_tags" && Array.isArray(v)) v.forEach((t) => typeof t === "string" && maker.add(t));
        walk(v);
      }
    }
  };
  for (const f of files) walk(fx(f.replace(/\.json$/, "")));
  const unknownTags = [...tags].filter((t) => !N.GMGN_TAG_MAP[t] && !N.GMGN_TOOL_MAP[t] && !IGNORED_TAGS.has(t));
  const unknownMaker = [...maker].filter((t) => !N.GMGN_MAKER_TAG_MAP[t] && !IGNORED_MAKER.has(t));
  ok(unknownTags.length === 0, `every wallet tag is mapped (${tags.size} values${unknownTags.length ? `; unknown: ${unknownTags}` : ""})`);
  ok(unknownMaker.length === 0, `every maker tag is mapped (${maker.size} values${unknownMaker.length ? `; unknown: ${unknownMaker}` : ""})`);
  const t1 = N.walletTagsOf({ tags: ["fresh_wallet", "kol", "smart_degen", "wash_trader", "arbitrager", "axiom", "gmgn_go", "fomo", "made_up_tag"], maker_token_tags: ["bundler", "sniper", "dev_team", "top_holder"] }, { rank: 3, pct: 0.02 });
  ok(["fresh", "kol", "smart", "wash", "bot", "bundler", "sniper", "dev", "top10", "whale"].every((t) => t1.tags.includes(t as never)), `tag mapping (${t1.tags.join(",")})`);
  ok(t1.tools.includes("axiom") && t1.tools.includes("gmgn") && t1.tools.includes("other") && t1.tools.length === 3, `tool mapping (${t1.tools.join(",")})`);
  ok(!N.walletTagsOf({ maker_token_tags: ["top_holder"] }, { rank: 11 }).tags.includes("top10"), "top_holder beyond rank 10 → no top10");
  ok(N.walletTagsOf({ exchange: "binance" }).tags.includes("exchange"), "exchange set → exchange");

  const ctx = { pools: new Set(["Fe7bpDYCs74GqiCUF14HwgUMToPKV1d9mDYVX5BTohFr"]), creator: null };
  const hc = N.holderRows(fx("holders_claudio_100").data, ctx);
  ok(hc.length > 10 && hc[0].rank === 1, `holders_claudio → ${hc.length} rows ranked`);
  ok(hc[0].tags.includes("pool") && !hc[0].tags.includes("whale") && !hc[0].tags.includes("top10"), "addr_type 2 (pump_amm) → pool, never whale/top10");
  ok(hc[1].tags.includes("whale") && hc[1].tags.includes("top10") && hc[1].pct > 0.02, "2.3% holder → whale + top10");
  ok(hc.some((h) => h.tags.includes("suspicious")), "is_suspicious → suspicious");
  ok(hc.some((h) => h.twitter === "btc_789" && !!h.name), "twitter_username / twitter_name → identity");
  ok(hc.some((h) => h.tags.includes("pool") && h.rank === 25), "meteora_dlmm pool (addr_type 2) → pool");
  ok(hc.every((h) => h.tools.every((t) => ["axiom", "gmgn", "photon", "bullx", "trojan", "padre", "maestro", "bonkbot", "other"].includes(t))), "tools are WalletTool values");
  ok(hc[1].fundedBy === "73yMQUEKjkvWZBcnd4CEqLBMHGPGchSwhCuLwBLXta29" && hc[1].firstSeenAt! > 1.7e12, "fundedBy + ms timestamps");
  const hn = N.holderRows(fx("holders_near_100").data);
  ok(hn[0].tags.includes("pool"), "'DBC Vault' (addr_type 0) → pool by name");
  ok(N.holderRows(fx("traders_claudio_100").data).length === hc.length, "traders use the same row shape");

  const st = N.tokenStatsFromInfo(fx("token_info_claudio").data, { nativeUsd: 200 });
  ok(["1m", "5m", "1h", "6h", "24h"].every((w) => st.windows[w as "1m"]), "token info → all windows 1m–24h");
  ok(st.windows["24h"]!.buys === 45275 && Math.round(st.windows["1h"]!.volumeUsd) === 101702, "window buys / volume");
  ok(Math.abs((st.mcapUsd ?? 0) - 0.00044231903 * 946240292.629972) < 1, `mcap = price × circulating supply (${Math.round(st.mcapUsd ?? 0)})`);
  ok(st.top10Pct === 0.1839 && st.freshPct === 0.1553 && st.counts?.smart === 142 && st.counts?.kol === 8, "wallet mix + counts");
  ok(st.migrated === true && st.migratedAt! > 1.7e12 && st.bondingPct === 100, "migrated + timestamps");
  ok(typeof st.windows["5m"]!.priceChangePct === "number", "price change per window");
  const stn = N.tokenStatsFromInfo(fx("token_info_near").data);
  ok(stn.migrated === false && stn.devHoldPct === 0.1046258725, "near: not migrated, dev team hold");

  const sec = N.securityFrom(fx("token_security_claudio").data);
  ok(sec.mintRenounced === true && sec.freezeRenounced === true && sec.honeypot === false && sec.buyTaxPct === 0 && sec.lpLocked === true, "security flags");
  ok(sec.warnings.length === 0, "clean token → no warnings");
  const bad = N.securityFrom({ renounced_mint: false, renounced_freeze_account: false, honeypot: 1, buy_tax: "0.05", sell_tax: "0.1", top_10_holder_rate: "0.45", lock_summary: { is_locked: false }, burn_ratio: "0" });
  ok(bad.warnings.length >= 6 && bad.warnings.some((w) => w.includes("Top 10 hold 45%")), `plain warnings (${bad.warnings.length})`);
  const pool = N.poolFrom(fx("token_pool_claudio").data);
  ok(pool?.address === "Fe7bpDYCs74GqiCUF14HwgUMToPKV1d9mDYVX5BTohFr" && pool.exchange === "pump_amm" && pool.quoteSymbol === "SOL", "pool info");

  const k = N.candlesFrom(fx("kline_claudio_5m_24h").data);
  ok(k.length > 5 && k.every((c, i) => i === 0 || c.t > k[i - 1].t) && k[0].t > 1.7e12, `kline → ${k.length} candles, ms, oldest first`);
  ok(N.storeCandles(k)[0].t === Math.floor(k[0].t / 1000), "store candles in seconds");
  ok(N.candlesFrom(fx("kline_near_1m").data).length === 3, "near 1m kline");

  const dev = N.devSummaryFrom(fx("token_info_near").data, undefined, fx("created_tokens_near_dev").data);
  ok(dev?.address === "3N4ewzLvH5Knce3KkxzWTSd5ERcYwTGCY3A3f4SVc7xW" && dev.launches === 1 && dev.migrated === 0 && dev.status === "closed", "dev summary (created_tokens)");
  const dev2 = N.devSummaryFrom({}, undefined, fx("created_tokens_completed_dev").data);
  ok(dev2?.launches === 78 + 129 && dev2.migrated === 129 && dev2.bestMcapUsd === 10648319, `dev with history: ${dev2?.launches} launches, ${dev2?.migrated} migrated`);
  ok(N.devCoinsFrom(fx("created_tokens_completed_dev").data).length > 5, "dev coins list");
  ok(N.devSummaryFrom(fx("token_info_claudio").data)?.bestMcapUsd == null, "absurd ATH (1e15) ignored");

  const sigs = N.signalsFrom(fx("signals_sol").data);
  ok(sigs.length > 5 && sigs.every((s) => s.tokenKey.startsWith("sol:") && s.at > 1.7e12), `signals → ${sigs.length} FeedSignals`);
  ok(Array.from({ length: 21 }, (_, i) => N.SIGNAL_TYPES[i + 1]).every(Boolean), "signal types 1–21 all mapped");
  const kinds = new Set(sigs.map((s) => s.kind));
  ok(kinds.has("ath") && kinds.has("price_spike") && !kinds.has("other" as never), `kinds seen: ${[...kinds].join(", ")}`);
  ok(N.tokenSignalsFor(sigs, sigs[0].tokenKey).length >= 1, "signals filtered to one token");

  const kol = N.feedTradesFrom(fx("kol_trades").data);
  ok(kol.length > 3 && kol[0].wallet.tags.includes("kol") && kol.every((t) => t.side === "buy" || t.side === "sell"), `KOL feed → ${kol.length} trades`);
  ok(kol.some((t) => t.wallet.twitter === "DamianProsa" && t.wallet.tools.includes("padre")), "KOL identity + tools");
  const sm = N.feedTradesFrom(fx("smartmoney_trades").data);
  ok(sm.length > 3 && sm[0].wallet.tags.includes("smart") && sm[0].amountUsd > 0, `smart-money feed → ${sm.length} trades`);

  const wp = N.walletProfileFrom(fx("wallet_stats_kol_7d").data, "sol", "AEeJUPCiGR3yCoukTh1G58o4LYsUEyzrXtfmfMc2kJMX");
  ok(wp.tags.includes("kol") && wp.tags.includes("wash") && wp.tools.includes("padre") && wp.winRate === 0.2875 && wp.buys7d === 810, "wallet profile");
  ok(wp.xFollowers === 39068, "wallet X followers");
  const recent = N.walletRecentFrom(fx("wallet_activity_kol").data, "sol", wp);
  ok(recent.length > 3 && recent.every((r, i) => (r.side === "buy" || r.side === "sell") && (i === 0 || r.at <= recent[i - 1].at)), `wallet recent activity → ${recent.length} trades, newest first`);

  const tr = fx("trenches_sol").data as Record<string, unknown[]>;
  const all = (["new_creation", "near_completion", "completed"] as const).flatMap((s) => (tr[s] ?? []).map((x) => N.mapItem(x, "sol", { section: s })));
  ok(all.length > 20 && all.every(Boolean), `trenches items → ${all.length} snapshots`);
  const pumpNew = all.find((m) => m!.snapshot.launchpad === "pump" && m!.snapshot.phase === "new")!;
  ok(pumpNew && pumpNew.known && pumpNew.snapshot.quoteSymbol === "SOL" && pumpNew.ext.holders?.top10Pct !== undefined, "pump new item → known pump token with wallet mix");
  const dbc = all.find((m) => m!.snapshot.launchpadLabel === "Meteora DBC");
  ok(!dbc || !dbc.known, "Meteora DBC items are fallbacks (not board-registered)");
  const done = all.filter((m) => m!.snapshot.phase === "migrated");
  ok(done.length >= 5 && done.every((m) => m!.snapshot.bondingPct === 100), "completed → migrated, bonding 100");
  const shark = all.find((m) => m!.snapshot.symbol === "SharkTank");
  ok(!shark || (shark.snapshot.socials.twitter === "https://x.com/sharktankonpump" && shark.snapshot.xFollowers === 21), "socials + X followers");

  const rank = fx("rank_sol_1h").data as { data: { rank: unknown[] } };
  const rk = rank.data.rank.map((x) => N.mapItem(x, "sol", { interval: "1h" }));
  ok(rk.length > 5 && rk[0]!.snapshot.volume1hUsd === 1474360 && rk[0]!.snapshot.phase === "migrated" && rk[0]!.snapshot.venue === "pumpswap", "rank item → board snapshot (1h volume, migrated, venue)");
  ok(rk[0]!.snapshot.snipersCount === 22 && rk[0]!.snapshot.smartBuys === 7 && Math.abs(rk[0]!.snapshot.bundlersPct - 72.88) < 0.01, "rank wallet mix");
  const r0 = rk[0]!.snapshot;
  ok(r0.smartCount === 7 && r0.kolCount === 0 && r0.rugRatio === 0.588 && typeof r0.dexBoost === "boolean" && typeof r0.cto === "boolean" && (r0.analyticsAt ?? 0) > 0 && Math.abs((r0.botPct ?? 0) - 19.15) < 0.01, "UI card fields: kolCount / smartCount / rugRatio / dexBoost / cto / botPct / analyticsAt");
  const hot = (fx("hot_searches_sol").data as { tokens: unknown[] }[])[0].tokens.map((x) => N.mapItem(x, "sol"));
  ok(hot.length > 5 && hot.every((m) => m && m.snapshot.name), `hot searches → ${hot.length} snapshots`);
  const search = (fx("search_claudio").data as { coins: unknown[] }).coins.map((x) => N.mapItem(x, "sol"));
  ok(search.length > 5 && search.every((m) => m && m.snapshot.mcapUsd >= 0), `search → ${search.length} snapshots`);
  const info = N.mapInfo(fx("token_info_claudio").data, "sol")!;
  ok(info.known && info.snapshot.launchpad === "pump" && info.snapshot.phase === "migrated" && info.snapshot.holders === 2932 && info.snapshot.socials.twitter === "https://x.com/ClaudioAgentAi", "token info → board snapshot");
  ok(info.ext.market?.buys5m === 23 && Math.abs(info.snapshot.top10Pct - 18.39) < 0.01, "info → 5m buys + top10 overlay");
}

async function storeChecks(): Promise<void> {
  console.log("\ntrenches merge / on-demand / Claudio launches (fresh store)");
  const { tokenStore, evictNowForTests } = await import("../store");
  const ix = await import("./indexing");
  const r1 = ix.mergeTrenches(fx("trenches_sol").data, "sol");
  ok(r1.registered > 10 && r1.skipped > 0, `merge 1: ${r1.registered} registered, ${r1.skipped} skipped (unmapped launchpads), ${r1.seen} seen`);
  const board = tokenStore.list("sol", undefined, 1000);
  ok(board.some((t) => t.phase === "almost") && board.some((t) => t.phase === "migrated") && board.some((t) => t.phase === "new"), "all three columns fill");
  const tr = fx("trenches_sol").data as Record<string, Record<string, unknown>[]>;
  // GMGN's near-completion column starts below our 70 % threshold: a 55 % coin there still lands in Almost bonded.
  const nearPump: Record<string, unknown> = { ...tr.near_completion.find((x) => x.launchpad === "Pump.fun")!, progress: 0.55 };
  ix.mergeTrenches({ near_completion: [nearPump] }, "sol");
  const nk = `sol:${nearPump.address}`;
  ok(tokenStore.get(nk)?.phase === "almost", `near-completion at ${Math.round(Number(nearPump.progress) * 100)}% → Almost bonded (GMGN's column)`);
  ok(Math.abs((tokenStore.get(nk)?.top10Pct ?? -1) - Number(nearPump.top_10_holder_rate) * 100) < 0.01, "wallet mix from GMGN on the card");
  ok((tokenStore.get(nk)?.analyticsAt ?? 0) > 0 && typeof tokenStore.get(nk)?.smartCount === "number", "merged cards carry analyticsAt + GMGN counts");

  const r2 = ix.mergeTrenches(fx("trenches_sol").data, "sol");
  ok(r2.registered === 0 && r2.enriched === r1.registered, `merge 2: ${r2.enriched} enriched, 0 new`);

  // Our own feed vs GMGN (USD-quoted test coin so prices don't depend on the SOL feed): GMGN's price shows while our
  // feed is quiet; our live trade wins after that; an older GMGN snapshot never overwrites it; wallet mix survives.
  const { blankToken: blank } = await import("../store");
  const ok1 = "sol:Own1111111111111111111111111111111111111111";
  tokenStore.register(blank({ chain: "sol", address: ok1.slice(4), launchpad: "pump", name: "Own", symbol: "OWN", creator: "", createdAt: Date.now() }), { quoteUsd: 1 });
  const at0 = Date.now();
  tokenStore.enrich(ok1, { at: at0, market: { priceUsd: 0.002, mcapUsd: 2_000_000, volume1hUsd: 5_000 }, holders: { top10Pct: 33, snipersPct: 7 } });
  ok(tokenStore.get(ok1)!.priceUsd === 0.002 && tokenStore.get(ok1)!.volume1hUsd === 5_000, "GMGN market numbers show while our feed is quiet");
  tokenStore.addTrade(
    { id: "own:1", key: ok1, chain: "sol", tx: "own1", block: 0, ts: at0 + 1000, side: "buy", trader: "Buyer1111111111111111111111111111111111111", amountToken: 1_000, amountNative: 3, amountUsd: 0, priceUsd: 0, mcapUsd: 0, tags: [] },
  );
  const own = tokenStore.get(ok1)!;
  ok(Math.abs(own.priceUsd - 0.003) < 1e-9, `our live trade sets the price (${own.priceUsd})`);
  ok(own.top10Pct === 33 && own.snipersPct === 7, "GMGN wallet mix survives our analytics after a trade");
  ok(own.volume1hUsd === 5_000, "volume = max(ours, GMGN's)");
  tokenStore.enrich(ok1, { at: at0 + 500, market: { priceUsd: 0.0021 } });
  ok(Math.abs(tokenStore.get(ok1)!.priceUsd - 0.003) < 1e-9, "an older GMGN snapshot doesn't overwrite our fresher live price");
  // GMGN says a known token completed → it migrates.
  const newPump = tr.new_creation.find((x) => x.launchpad === "Pump.fun")!;
  const npk = `sol:${newPump.address}`;
  ix.mergeTrenches({ completed: [{ ...newPump, progress: 1, complete_timestamp: Math.floor(Date.now() / 1000), exchange: "pump_amm", status: 1, launchpad_status: 1 }] }, "sol");
  ok(tokenStore.get(npk)?.phase === "migrated" && tokenStore.get(npk)?.venue === "pumpswap", "GMGN completed → token migrates (Migrated column)");

  // On-demand lookup with a mocked fetch.
  const near = fx("token_info_near");
  const nearAddr = (near.data as { address: string }).address;
  const nearKey = `sol:${nearAddr}`;
  tokenStore.purge((x) => x.key === nearKey);
  const m = mockFetch((c) => {
    const addr = new URL(c.url).searchParams.get("address");
    if (c.path === "/v1/token/info" && addr === nearAddr) return { body: near };
    if (c.path === "/v1/token/info" && addr?.startsWith("SLow")) return { delayMs: 300, body: { code: 0, data: { ...(near.data as object), address: addr, symbol: "SLOW", name: "Slow coin" } } };
    return { body: { code: 40400, error: "NOT_FOUND", message: "token not found" } };
  });
  setGatewayForTests(gw(m.fetch, { rps: 50, maxRps: 50, burst: 10 }));
  ok(await ix.lookupToken(nearKey), "unknown token → GMGN token/info → registered");
  const nt = tokenStore.detail(nearKey);
  ok(nt?.name === "bet on people" && nt.symbol === "people" && nt.launchpadLabel === "Meteora DBC", "detail served from the on-demand registration (fallback launchpad labelled)");
  const calls = m.calls.length;
  ok((await ix.lookupToken(nearKey)) && m.calls.length === calls, "second lookup is a store hit (no GMGN call)");
  const missing = "sol:Nope1111111111111111111111111111111111111";
  ok(!(await ix.lookupToken(missing)) && !tokenStore.has(missing), "GMGN can't answer → false (route keeps its 404)");
  ok(!(await ix.lookupToken("sol:not-an-address")), "garbage address → no GMGN call");
  const slowKey = "sol:SLow111111111111111111111111111111111111111";
  const t0 = Date.now();
  const fast = await ix.lookupToken(slowKey, 100);
  ok(!fast && Date.now() - t0 < 250, "slow GMGN → lookup gives up after its wait");
  await sleep(350);
  ok(tokenStore.get(slowKey)?.symbol === "SLOW", "… and registers the token when the answer lands (page retry finds it)");

  // Candle backfill into a thin series.
  const kl = fx("kline_claudio_5m_24h");
  const m2 = mockFetch((c) => (c.path === "/v1/market/token_kline" ? { body: kl } : { body: near }));
  setGatewayForTests(gw(m2.fetch, { rps: 50, maxRps: 50, burst: 10 }));
  const before = tokenStore.candles(nearKey, 300, 300).length;
  const n = await ix.backfillCandles(nearKey, 300, 300);
  const q = new URL(m2.calls[0].url).searchParams;
  ok(n > 5 && tokenStore.candles(nearKey, 300, 300).length >= before + n - 1, `thin series → ${n} GMGN 5m candles seeded`);
  ok(q.get("resolution") === "5m" && Number(q.get("from")) > 1e12 && Number(q.get("to")) > Number(q.get("from")), "kline asked at the matching resolution, from/to in ms");
  ok((await ix.backfillCandles(nearKey, 300, 300)) === 0 && m2.calls.length === 1, "no re-backfill within a minute");

  // Claudio launch: on the board at once, launchedHere, never evicted; boot reload restores it.
  const launch = {
    id: "lch_test",
    chain: "sol" as const,
    launchpad: "pump" as const,
    creator: "Crea111111111111111111111111111111111111111",
    name: "Claudio Test",
    symbol: "CTEST",
    imageUri: "ipfs://bafkreitest",
    token: "CTest11111111111111111111111111111111111pump",
    curve: "Curv111111111111111111111111111111111111111",
    splitter: "Spl1111111111111111111111111111111111111111",
    splitKind: "native-locked",
    request: { chain: "sol" as const, launchpad: "pump" as const, name: "Claudio Test", symbol: "CTEST", imageUri: "ipfs://bafkreitest", socials: { twitter: "https://x.com/ctest" }, creator: "Crea111111111111111111111111111111111111111", devBuyNative: 0, slippageBps: 500, description: "a test coin" },
    meta: {},
    txHashes: ["h1"],
    status: "confirmed" as const,
    createdAt: Date.now() - 2 * 86_400_000,
    updatedAt: Date.now(),
  };
  const ck = ix.indexClaudioLaunch(launch, { feeSplit: { kind: "native-locked", splitter: launch.splitter }, enrich: false })!;
  const ct = tokenStore.get(ck);
  ok(ct?.launchedHere && ct.feeSplit?.splitter === launch.splitter && ct.symbol === "CTEST" && ct.image?.startsWith("https://"), "confirm → registered from the launch record (launchedHere, fee split, gateway image)");
  ok(ct?.socials.twitter === "https://x.com/ctest" && ct.pool === launch.curve && ct.creator === launch.creator, "socials, curve and creator from the record");
  // Flood the "new" column past its cap with stale tokens and evict: the Claudio coin stays.
  const { blankToken } = await import("../store");
  for (let i = 0; i < 450; i++) {
    tokenStore.register(blankToken({ chain: "sol", address: `Fill${String(i).padStart(4, "0")}11111111111111111111111111111111`, launchpad: "pump", name: `F${i}`, symbol: `F${i}`, creator: "", createdAt: Date.now() - i }));
  }
  evictNowForTests();
  ok(tokenStore.has(ck), "Claudio launch survives column-cap eviction");
  ok(tokenStore.has(slowKey) && tokenStore.has(nearKey), "on-demand tokens are evicted by their TTL, not by column caps");
  // Boot reload: drop it from memory, reload from the launches table (in-memory copy here, DB off).
  const { launchStore } = await import("../launch/store");
  await launchStore.save(launch as never);
  tokenStore.purge((x) => x.key === ck);
  ok(!tokenStore.has(ck), "(token dropped, as after a restart)");
  const reloaded = await ix.reloadClaudioLaunches();
  ok(reloaded >= 1 && tokenStore.get(ck)?.launchedHere === true && tokenStore.get(ck)?.feeSplit?.kind === "native-locked", `boot reload re-registers confirmed launches (${reloaded})`);
  setGatewayForTests(null);
}

async function main(): Promise<void> {
  setInterval(() => {}, 1_000); // the gateway's timers are unref'd (they never hold a server open); keep the check alive
  await limiterChecks();
  await cacheChecks();
  normalizerChecks();
  await storeChecks();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
