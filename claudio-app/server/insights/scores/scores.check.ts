// Manual check for the GMGN-skill score ports (not part of the app). Runs every scorer on the recorded GMGN responses
// and on crafted inputs, prints the results, and asserts the properties the ports promise:
//   npx tsx server/insights/scores/scores.check.ts [fixtures-dir]      (or GMGN_FIXTURES=<dir>)
// The fixtures are GMGN {code,message,data} envelopes; scorers receive the `data` field. No network calls are made.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Score } from "@shared/insights";
import { candlesFromGmgn, contractDD, devScore, holderAnalysis, klinePattern, walletProfileScores, KLINE_PATTERNS, type Candle } from "./index";

const DIR = process.argv[2] || process.env.GMGN_FIXTURES || "";
const NOW = 1_791_420_000_000; // just after the fixtures were recorded (unix ms)
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function props(name: string, s: Score) {
  const sum = s.reasons.reduce((a, r) => a + r.points, 0);
  check(`${name}: 0 ≤ value ≤ 100`, s.value >= 0 && s.value <= 100, String(s.value));
  check(`${name}: Σ reasons = value`, s.reasons.length === 0 ? s.value === 0 : Math.abs(sum - s.value) < 0.15, `Σ=${sum.toFixed(2)} value=${s.value}`);
  check(`${name}: has title + summary`, !!s.title && !!s.summary);
  check(`${name}: no buy/sell advice`, !/\b(buy|sell) (this|it|now)\b|\bdon'?t buy\b|\bsafe to buy\b/i.test(`${s.title} ${s.summary} ${s.reasons.map((r) => r.label).join(" ")}`));
}
function show(name: string, s: Score & Record<string, unknown>, extra = "") {
  console.log(`\n■ ${name}: ${s.value} · ${s.grade} · "${s.title}"${extra}`);
  console.log(`  ${s.summary}`);
  for (const r of s.reasons) console.log(`    ${r.points >= 0 ? "+" : ""}${r.points.toFixed(1).padStart(6)}  ${r.label}${r.field ? `  [${r.field}]` : ""}`);
}
function fx(name: string): unknown {
  const p = join(DIR, name);
  if (!DIR || !existsSync(p)) return undefined;
  return (JSON.parse(readFileSync(p, "utf8")) as { data?: unknown }).data;
}

// ─── 1. every scorer on every relevant fixture ──────────────────────────
if (DIR && existsSync(DIR)) {
  console.log(`Fixtures: ${DIR}`);
  // dev score
  const nearDev = devScore({
    createdTokens: fx("created_tokens_near_dev.json"),
    walletStats: fx("wallet_stats_near_dev.json"),
    devActivity: { "3Y3CvPwjzqLxJFRKuQr4Fz6d7duS9Zu8xwhAuapnfUSA": fx("wallet_activity_near_dev_on_coin.json") },
    flagshipInfo: fx("token_info_near.json"),
    now: NOW,
  });
  for (const k of ["conduct", "power", "total"] as const) { show(`devScore(near dev).${k}`, nearDev[k] as never); props(`devScore(near dev).${k}`, nearDev[k]); }
  console.log(`  facts: tier=${nearDev.facts.tier} dumps=${nearDev.facts.dumps}/${nearDev.facts.coinsWithTrades} fastest=${nearDev.facts.fastestFirstSellS}s pull=${nearDev.facts.medianPullMultiple?.toFixed(2)}× flagship=${nearDev.facts.flagship?.status}`);
  const doneDev = devScore({ createdTokens: fx("created_tokens_completed_dev.json"), now: NOW });
  for (const k of ["conduct", "power", "total"] as const) { show(`devScore(completed dev, no trades supplied).${k}`, doneDev[k] as never); props(`devScore(completed dev).${k}`, doneDev[k]); }
  console.log(`  facts: launches=${doneDev.facts.launches} sampled=${doneDev.facts.sampled} truncated=${doneDev.facts.bookTruncated} over1m=${doneDev.facts.over1m} career=${doneDev.facts.careerDays.toFixed(0)}d (floor=${doneDev.facts.careerDaysIsFloor})`);

  // candles
  const cClaudio = candlesFromGmgn(fx("kline_claudio_5m_24h.json"));
  const cNear = candlesFromGmgn(fx("kline_near_1m.json"));
  check("candlesFromGmgn: 100 CLAUDIO candles", cClaudio.length === 100, String(cClaudio.length));
  check("candlesFromGmgn: sorted ascending, ms timestamps", cClaudio.every((c, i) => i === 0 || c.t >= cClaudio[i - 1].t) && cClaudio[0].t > 1e12);
  const infoC = fx("token_info_claudio.json") as { price?: { volume_6h?: string } } | undefined;
  const v6 = cClaudio.slice(-72).reduce((a, c) => a + c.v, 0);
  console.log(`\n  units: Σ volume of last 72×5m candles = ${v6.toFixed(0)} vs info.price.volume_6h = ${Number(infoC?.price?.volume_6h ?? 0).toFixed(0)} (USD)`);

  // contract DD
  const ddC = contractDD({ info: fx("token_info_claudio.json"), security: fx("token_security_claudio.json"), pool: fx("token_pool_claudio.json"), holders: fx("holders_claudio_100.json"), candles: cClaudio, now: NOW });
  show("contractDD(CLAUDIO)", ddC as never, ` · sections ${JSON.stringify(ddC.sections)} · confidence ${ddC.confidence}`);
  props("contractDD(CLAUDIO)", ddC);
  const ddN = contractDD({ info: fx("token_info_near.json"), security: fx("token_security_near.json"), candles: cNear, now: NOW });
  show("contractDD(near-completion coin)", ddN as never, ` · sections ${JSON.stringify(ddN.sections)} · confidence ${ddN.confidence}`);
  props("contractDD(near)", ddN);

  // holders
  for (const [n, info, h] of [["CLAUDIO", "token_info_claudio.json", "holders_claudio_100.json"], ["near-completion coin", "token_info_near.json", "holders_near_100.json"]] as const) {
    const r = holderAnalysis({ info: fx(info), holders: fx(h) });
    show(`holderAnalysis(${n})`, r as never);
    for (const b of r.breakdown) console.log(`      · ${b.label}: ${(b.pct * 100).toFixed(2)}%${b.tag ? ` [${b.tag}]` : ""}`);
    props(`holderAnalysis(${n})`, r);
  }

  // kline
  for (const [n, cs] of [["CLAUDIO 5m", cClaudio], ["near 1m (3 candles)", cNear]] as const) {
    const r = klinePattern({ candles: cs });
    show(`klinePattern(${n})`, r as never, ` · pattern "${r.pattern}"`);
    props(`klinePattern(${n})`, r);
  }
  check("klinePattern: 3 candles → unknown", klinePattern({ candles: cNear }).grade === "unknown");

  // wallet
  for (const [n, stats, act] of [["KOL 7d", "wallet_stats_kol_7d.json", "wallet_activity_kol.json"], ["near dev", "wallet_stats_near_dev.json", "wallet_activity_near_dev_on_coin.json"]] as const) {
    const r = walletProfileScores({ stats: fx(stats), activity: fx(act), now: NOW });
    console.log(`\n■ walletProfileScores(${n}): style ${JSON.stringify(r.style)}`);
    console.log(`  review: ${r.review}`);
    show(`  score`, r.score as never);
    show(`  copy`, r.copy as never);
    props(`wallet(${n}).score`, r.score);
    if (r.copy.grade !== "unknown") props(`wallet(${n}).copy`, r.copy);
  }
} else {
  console.log("No fixtures dir given (arg or GMGN_FIXTURES) — running crafted checks only.");
}

// ─── 2. never throw, unknown on empty / blank ───────────────────────────
const garbage: unknown[] = [undefined, null, "", "x", 42, [], {}, { data: null }, { code: 0, data: {} }, { list: "nope" }, { tokens: [null, 1, "a"] }];
let threw = false;
for (const g of garbage) {
  try {
    const d = devScore({ createdTokens: g, walletStats: g, devActivity: g as never, flagshipInfo: g });
    const c = contractDD({ info: g, security: g, candles: g as never, pool: g });
    const h = holderAnalysis({ info: g, holders: g });
    const k = klinePattern({ candles: g as never });
    const w = walletProfileScores({ stats: g, activity: g, holdings: g });
    candlesFromGmgn(g);
    for (const s of [d.conduct, d.power, d.total, c, h, k, w.score]) check(`blank input ${JSON.stringify(g) ?? "undefined"} → unknown`, s.grade === "unknown", `${s.grade} ${s.title}`);
    check(`blank wallet → no style`, w.style === null);
  } catch (e) {
    threw = true;
    console.log("THREW", g, e);
  }
}
check("no scorer throws on garbage", !threw);

// ─── 3. dev-score gates on crafted inputs ───────────────────────────────
const T0 = 1_791_000_000; // a launch time (unix s)
const day = 86400;
type Tok = { addr: string; ts: number; ath?: number; mc?: number; pool?: number; open?: boolean; holders?: number; cto?: boolean };
function book(tokens: Tok[], extra: Record<string, unknown> = {}) {
  return {
    inner_count: tokens.filter((t) => !t.open).length, open_count: tokens.filter((t) => t.open).length,
    creator_ath_info: { ath_mc: String(Math.max(0, ...tokens.map((t) => t.ath ?? 0))) },
    tokens: tokens.map((t) => ({
      token_address: t.addr, symbol: t.addr.toUpperCase(), create_timestamp: t.ts, token_ath_mc: String(t.ath ?? 20000), market_cap: String(t.mc ?? 5000),
      pool_liquidity: String(t.pool ?? 500), is_open: !!t.open, holders: t.holders ?? 50, cto_flag: !!t.cto, bundler_rate: 0,
    })),
    ...extra,
  };
}
const row = (token: string, type: string, ts: number, usd: number, extra: Record<string, unknown> = {}) => ({ token: { address: token, total_supply: "1000000000" }, event_type: type, timestamp: ts, cost_usd: String(usd), tx_hash: `${token}-${type}-${ts}`, ...extra });
const feed = (...rows: unknown[]) => ({ activities: rows, next: "" });

// factory gate
const fac = devScore({ createdTokens: { inner_count: 25000, open_count: 0, creator_ath_info: { ath_mc: "90000" }, tokens: [] }, now: NOW });
check("factory dev (25k launches, nothing graduated) → not scored", fac.facts.reason === "not_a_person" && fac.total.grade === "unknown", fac.facts.reason);
const facPerson = devScore({ createdTokens: { inner_count: 20000, open_count: 369, creator_ath_info: { ath_mc: "91860000" }, tokens: [] }, now: NOW });
check("bot-scale dev with graduations + $91.9M peak → scored", facPerson.facts.scored && facPerson.facts.terms!.factoryPen === 45, `${facPerson.facts.reason} pen=${facPerson.facts.terms?.factoryPen}`);
// ath > $50B
const peak = devScore({ createdTokens: book([{ addr: "a", ts: T0, ath: 6e10, holders: 5000, open: true, pool: 1e6, mc: 1e9 }]), now: NOW });
check("ath > $50B → not scored (bad data)", peak.facts.reason === "peak_implausible" && peak.total.grade === "unknown", peak.facts.reason);
// a $21B junk peak on a 28-holder coin is zeroed per coin, not a reject
const junk = devScore({ createdTokens: book([{ addr: "a", ts: T0, ath: 2.1e10, holders: 28, pool: 9500, mc: 38000 }, { addr: "b", ts: T0 + 10, ath: 3.26e8, holders: 34000, pool: 4.5e6, mc: 5e7, open: true }]), now: NOW });
check("implausible per-coin peak zeroed, real flagship kept", junk.facts.scored && junk.facts.flagship?.address === "b" && junk.facts.implausiblePeaks.length === 1);
// dump dev 2.7× @ 10 s
const dumpOne = devScore({
  createdTokens: book([{ addr: "d1", ts: T0 }]),
  devActivity: { d1: feed(row("d1", "buy", T0 + 1, 100), row("d1", "sell", T0 + 10, 270)) }, now: NOW,
});
show("crafted: dump dev 2.7× @ 10s (1 coin)", dumpOne.total as never);
check("dump dev 2.7× @10s → dump counted, systematic tier", dumpOne.facts.dumps === 1 && dumpOne.facts.tier === "sys", `tier=${dumpOne.facts.tier}`);
check("dump dev → conduct ≤ 45, total ≤ 49, risky", dumpOne.conduct.value <= 45 && dumpOne.total.value <= 49 && dumpOne.total.grade === "risky", `${dumpOne.conduct.value}/${dumpOne.total.value}`);
props("crafted dump dev.conduct", dumpOne.conduct);
props("crafted dump dev.total", dumpOne.total);
const dump6 = devScore({
  createdTokens: book(Array.from({ length: 6 }, (_, i) => ({ addr: `x${i}`, ts: T0 - i * 10 * day }))),
  devActivity: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`x${i}`, feed(row(`x${i}`, "buy", T0 - i * 10 * day + 1, 100), row(`x${i}`, "sell", T0 - i * 10 * day + 10, 270))])), now: NOW,
});
check("dumps on 6/6 coins → systematic, total ≤ 49", dump6.facts.tier === "sys" && dump6.total.value <= 49, `${dump6.facts.tier} ${dump6.total.value}`);
// severity orders 2.70× @40s above 1.73× @28s even though only the second is a "dump"
const sevA = devScore({ createdTokens: book([{ addr: "s", ts: T0 }]), devActivity: { s: feed(row("s", "buy", T0, 100), row("s", "sell", T0 + 40, 270)) }, now: NOW });
const sevB = devScore({ createdTokens: book([{ addr: "s", ts: T0 }]), devActivity: { s: feed(row("s", "buy", T0, 100), row("s", "sell", T0 + 28, 173)) }, now: NOW });
check("severity: 2.70×@40s deducts more than 1.73×@28s", sevA.facts.terms!.dumpPen > sevB.facts.terms!.dumpPen && sevA.facts.dumps === 0 && sevB.facts.dumps === 1, `${sevA.facts.terms!.dumpPen} vs ${sevB.facts.terms!.dumpPen}`);
// thin-record shrink
const thin = devScore({ createdTokens: book([{ addr: "t", ts: NOW / 1000 - 2 * day }]), devActivity: { t: feed(row("t", "buy", NOW / 1000 - 2 * day + 5, 100), row("t", "sell", NOW / 1000 - day, 120)) }, now: NOW });
show("crafted: thin record (1 clean coin, 2 days)", thin.conduct as never);
check("thin record shrinks toward 60", thin.facts.terms!.raw > 90 && thin.facts.terms!.shrinkTo < 65 && thin.conduct.reasons.some((r) => /pulled toward 60/.test(r.label)), `${thin.facts.terms!.raw} → ${thin.facts.terms!.shrinkTo}`);
check("thin record → unproven tier, total ≤ 74", thin.facts.tier === "often_unproven" && thin.total.value <= 74);
const veteran = devScore({
  createdTokens: book(Array.from({ length: 6 }, (_, i) => ({ addr: `v${i}`, ts: NOW / 1000 - (10 + i * 15) * day, open: true, pool: 20000 }))),
  devActivity: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`v${i}`, feed(row(`v${i}`, "buy", NOW / 1000 - (10 + i * 15) * day + 5, 100), row(`v${i}`, "sell", NOW / 1000 - (9 + i * 15) * day, 130))])), now: NOW,
});
check("6 clean coins over 85 days → no shrink, measured-clean tier", veteran.facts.terms!.shrinkTo === veteran.facts.terms!.raw && veteran.facts.tier === "none" && veteran.conduct.value >= 90, `${veteran.facts.tier} ${veteran.conduct.value}`);
props("crafted veteran.total", veteran.total);
// unaccounted exit
const exitBase = { createdTokens: book([{ addr: "f", ts: T0, ath: 2e6, holders: 900, open: true, pool: 50000, mc: 4e5 }]), now: NOW };
const fInfo = { address: "f", dev: { creator_token_status: "creator_close", creator_token_balance: "0" }, open_timestamp: T0 + 60 };
const opaque = devScore({ ...exitBase, flagshipInfo: fInfo, devActivity: { f: feed(row("f", "launch", T0, 0), row("f", "buy", T0 + 2, 300)) } });
show("crafted: unaccounted flagship exit", opaque.conduct as never);
check("unaccounted exit → −15 conduct + total ≤ 74", opaque.facts.flagship?.status === "closed_exit_unrecorded" && opaque.facts.terms!.opaquePen === 15 && opaque.total.value <= 74, `${opaque.facts.flagship?.status} ${opaque.total.value}`);
const documented = devScore({ ...exitBase, flagshipInfo: fInfo, devActivity: { f: feed(row("f", "buy", T0 + 2, 300), row("f", "sell", T0 + 5 * day, 600)) } });
check("documented exit (sell row) → no penalty", documented.facts.flagship?.status === "closed_exit_documented" && documented.facts.terms!.opaquePen === 0);
const noFeed = devScore({ ...exitBase, flagshipInfo: fInfo });
check("exit audit without the coin's feed never accuses", noFeed.facts.terms!.opaquePen === 0 && noFeed.facts.flagship?.status === "closed_no_sell_row");
// liquidity drain guard
const lpDust = devScore({ createdTokens: book([{ addr: "l", ts: T0 }]), devActivity: { l: feed(row("l", "remove", T0 + 100, 0, { token_amount: "0", quote_amount: "0.0259", cost_usd: "" })) }, now: NOW });
check("dust `remove` row (0 tokens) is ignored, not a drain", lpDust.facts.tier !== "sys" && lpDust.facts.liquidity.ignoredRows === 1);
const lpDrain = devScore({ createdTokens: book([{ addr: "l", ts: T0 }]), devActivity: { l: feed(row("l", "remove", T0 + 100, 0, { token_amount: "200000000", cost_usd: "" })) }, now: NOW });
check("20%-of-supply `remove` on a dead pool → systematic (lp)", lpDrain.facts.tier === "sys" && lpDrain.facts.forcedBy === "lp" && lpDrain.total.value <= 49);
// empty-index no-verdict
const emptyBook = { inner_count: 0, open_count: 0, tokens: [] };
const e1 = devScore({ createdTokens: emptyBook, walletStats: { buy: 0, sell: 0, last_timestamp: 0, realized_profit: "0", total_cost: "0", pnl_stat: { token_num: 0 } }, now: NOW });
const e2 = devScore({ createdTokens: emptyBook, now: NOW });
const e3 = devScore({ createdTokens: emptyBook, walletStats: { buy: 12, sell: 3, pnl_stat: { token_num: 4 } }, now: NOW });
check("empty index + empty wallet_stats → no verdict", e1.facts.reason === "index_empty" && e1.total.grade === "unknown");
check("empty index + no wallet_stats → no verdict", e2.facts.reason === "index_empty");
check("empty index + trading wallet_stats → 'not a dev'", e3.facts.reason === "never_launched" && e3.total.grade === "unknown");
console.log(`\n  no-verdict copy: "${e1.total.title}" — ${e1.total.summary}`);

// ─── 4. contract DD crafted ─────────────────────────────────────────────
const honeyInfo = { symbol: "HP", holder_count: 900, liquidity: "80000", image_dup_count: 0, price: { price: "1", price_24h: "1", volume_24h: "1000" }, stat: {} };
const honey = contractDD({ info: honeyInfo, security: { is_honeypot: true, is_open_source: true, is_renounced: true, is_blacklist: false, buy_tax: "0", sell_tax: "0", top_10_holder_rate: "0.2", lock_summary: { is_locked: true } }, chain: "bsc" });
check("EVM honeypot → composite 0", honey.value === 0 && honey.grade === "risky", `${honey.value} ${honey.grade}`);
props("crafted honeypot", honey);
const solClean = { symbol: "OK", holder_count: 5000, liquidity: "500000", image_dup_count: 0, price: { price: "1", price_24h: "1", volume_24h: "100000" }, stat: { holder_count: 5000, top_10_holder_rate: "0.12", top70_sniper_hold_rate: "0.0001" } };
const okSec = { renounced_mint: true, renounced_freeze_account: true, buy_tax: "0", sell_tax: "0", top_10_holder_rate: "0.12", burn_status: "burn", lock_summary: { is_locked: true } };
const rugged = contractDD({ info: solClean, security: okSec, rugRatio: 0.8, candles: [] });
check("rug_ratio 0.8 caps a clean token at 59", rugged.value <= 59, String(rugged.value));
const noMint = contractDD({ info: solClean, security: { ...okSec, renounced_mint: false } });
check("sol mint not renounced → −25 contract", noMint.sections.contract === 75);
const noRecord = contractDD({ info: { symbol: "", holder_count: 0 }, security: okSec, candles: [] });
check("info.symbol empty → no record (unknown)", noRecord.grade === "unknown" && noRecord.title === "No record");

// ─── 5. holder analysis crafted ─────────────────────────────────────────
const H = (addr: string, p: number, extra: Record<string, unknown> = {}) => ({ address: addr, addr_type: 0, amount_percentage: p, balance: p * 1e9, buy_tx_count_cur: 2, sell_tx_count_cur: 0, avg_cost: 0.001, unrealized_pnl: 0.1, tags: [], maker_token_tags: [], native_balance: "1000000000", ...extra });
const ratList = { list: [{ address: "pool", addr_type: 2, amount_percentage: 0.3, balance: 3e8 }, ...Array.from({ length: 40 }, (_, i) => H(`w${i}`, 0.01)), H("rat1", 0.04, { maker_token_tags: ["rat_trader"] }), H("rat2", 0.03, { maker_token_tags: ["rat_trader"] })] };
const rat = holderAnalysis({ info: { address: "TOKEN", total_supply: "1000000000" }, holders: ratList });
check("rat traders > 5% of float → Holder red flags (risky, ≤ 39)", rat.grade === "risky" && rat.value <= 39, `${rat.grade} ${rat.value} ${rat.title}`);
props("crafted rat holders", rat);
const degen = holderAnalysis({ info: { address: "TOKEN" }, holders: { list: [{ address: "curve", addr_type: 2, amount_percentage: 0.995 }, H("a", 0.005)] } });
check("float < 2% → Can't assess (unknown)", degen.grade === "unknown", degen.title);
const healthy = holderAnalysis({ info: { address: "TOKEN" }, holders: { list: [{ address: "pool", addr_type: 2, amount_percentage: 0.2 }, ...Array.from({ length: 80 }, (_, i) => H(`h${i}`, 0.005))] } });
check("dispersed holders → Healthy (good, ≥ 80)", healthy.grade === "good" && healthy.value >= 80, `${healthy.grade} ${healthy.value}`);

// ─── 6. kline patterns on synthetic series ──────────────────────────────
function series(closes: number[], hv = 0.005, vol = () => 1000): Candle[] {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { t: 1_791_000_000_000 + i * 60_000, o, c, h: Math.max(o, c) * (1 + hv), l: Math.min(o, c) * (1 - hv), v: vol() };
  });
}
const lin = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
const synthetic: Record<string, Candle[]> = {
  "Vertical run-up": series(lin(60, (i) => 1.03 ** i)),
  "Uptrend channel": series(lin(60, (i) => 1.006 ** i)),
  Breakdown: series(lin(60, (i) => (i < 30 ? 1 : 0.96 ** (i - 29)))),
  "Bounce off the lows": series(lin(60, (i) => (i <= 35 ? 1 - 0.8 * (i / 35) : 0.2 * 1.017 ** (i - 35)))),
  "Distribution at highs": series(lin(60, (i) => (i <= 20 ? 1 + i / 20 : i <= 30 ? 2 - 0.08 * (i - 20) : 1.2))),
  "Slow bleed": series(lin(60, (i) => (i < 30 ? 1 : 0.987 ** (i - 29)))),
  "Basing at lows": series(lin(60, (i) => 1 + 0.002 * Math.sin(i))),
  "Wide chop": series(lin(60, (i) => (i % 2 ? 1.1 : 1.0)), 0.06),
  "Bullish consolidation": series(lin(60, (i) => (i < 10 ? 0.8 + 0.02 * i : 1.0 * 1.002 ** (i - 10)))),
  "Bearish consolidation": series(lin(60, (i) => 0.998 ** i), 0.03),
  "Sideways consolidation": series(lin(60, () => 1), 0.035),
};
console.log("\n■ klinePattern on synthetic series");
for (const name of KLINE_PATTERNS) {
  const r = klinePattern({ candles: synthetic[name] });
  console.log(`    ${name.padEnd(24)} → ${r.pattern.padEnd(24)} ${String(r.value).padStart(5)} ${r.grade}`);
  check(`kline synthetic "${name}"`, r.pattern === name, r.pattern);
  props(`kline ${name}`, r);
}
check("kline: < 8 candles → unknown", klinePattern({ candles: synthetic["Uptrend channel"].slice(0, 7) }).pattern === "unknown");

// ─── 7. wallet crafted ──────────────────────────────────────────────────
const wstats = (o: Record<string, unknown>) => ({ buy: 0, sell: 0, realized_profit: "0", realized_profit_pnl: "0", bought_cost: "0", pnl_stat: { token_num: 0, winrate: 0 }, common: { tags: [], created_token_count: 0, created_at: 1_700_000_000 }, ...o });
const bot = walletProfileScores({ stats: wstats({ buy: 3000, sell: 2900, realized_profit: "500", realized_profit_pnl: "0.01", bought_cost: "50000", pnl_stat: { token_num: 400, winrate: 0.3, pnl_lt_nd5_num: 20 } }), now: NOW });
check("L4 × ~1% ROI → 'Worn Down by Fees'", bot.style?.title === "Worn Down by Fees", bot.style?.title);
const lucky = walletProfileScores({ stats: wstats({ buy: 2, sell: 1, realized_profit: "900", realized_profit_pnl: "3", bought_cost: "300", pnl_stat: { token_num: 1, winrate: 1 } }), now: NOW });
check("one lucky coin → no title ('Too early to tell') + small-sample badge", lucky.style?.title === "Too early to tell" && lucky.style.badges.some((b) => b.startsWith("Small sample")));
check("one lucky coin → score not confident", lucky.score.grade === "unknown", lucky.score.grade);

console.log(`\n${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(fail ? 1 : 0);
