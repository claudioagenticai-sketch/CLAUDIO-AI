// gmgn-dev-score port (skills/gmgn-dev-score: dev_score.py + references/scoring.md / fields.md / glossary.md).
// Two axes kept apart on purpose: CONDUCT = only what the dev did with his own hands in his own coins (will he dump on
// you); POWER = what the market did with his coins (has he ever built anything). TOTAL = CONDUCT + a capped POWER bonus,
// with the dump-rate gate applied before the bonus can help. Constants, gates and edge rules are the script's.
//
// Inputs are raw GMGN `data` objects: created_tokens, wallet_stats (only used to corroborate an empty record), the dev's
// per-coin wallet_activity keyed by token address (unfiltered feed: buy/sell/remove/transfer_out/burn/launch …), and
// optionally token_info of his flagship (creator_token_status / open_timestamp for the exit audit).
//
// Not ported (needs calls this pure function cannot make): the cross-wallet "sibling sold" verification (recipient's own
// trades + funder lookup) — supply moves are DISCLOSED from his transfer_out rows but, exactly like the script's
// `pending` case, never scored; the N==0 re-fetch is the caller's job (call again once, then pass walletStats).
import type { Score } from "@shared/insights";
import { arr, bool, clamp, dur, medUpper, nowSeconds, num, obj, pct, plural, r1, safeText, str, Tally, unwrap, usd, type Dict } from "./util";

// ── constants (dev_score.py) ──
const ATH_MIN_HOLDERS = 500; // a real crowd was there -> the peak is credible on its own
const ATH_MAX_RATIO = 1e4; // a peak may exceed today's footprint 10,000x before we disbelieve it
const FACTORY_N = 20000;
const FACTORY_ATH = 1e6;
const PEAK_MAX = 5e10; // > $50B peak = the data source is wrong
const SIB_MIN_SHARE = 0.01;
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "11111111111111111111111111111111"]);
const LP_MIN_SHARE = 0.005; // 0.5% of supply pulled back out of the pool
const LP_MIN_USD = 500;
const CUT_MULT = 1.5; // dump = pulled out >= 1.5x AND first sell within 30 s
const CUT_SEC = 30;
const SEV_MULT_FULL = 4.0;
const SEV_SEC_ZERO = 120.0;
const BUND_HOT = 0.2;
const ACCOUNTED = new Set(["sell", "transfer_out", "burn", "add", "remove"]);
const FAC_LO = 20;
const FAC_HI = 500;
const OPAQUE_PEN = 15;
const PEN_OFTEN = 20;
const CAP_UNPROVEN = 65;
const CAP_OFTEN_TOT = 74;
const CAP_SYS = 45;
const CAP_SYS_TOT = 49;

export type DumpTier = "none" | "rare" | "often" | "often_unproven" | "sys";
export type DevBand = "buyable" | "mixed" | "avoid" | "stay_away";
export type DevNoScoreReason = "index_empty" | "not_a_person" | "peak_implausible" | "never_launched";
export type FlagshipStatus =
  | "unreadable" | "holding" | "sold_own_bag" | "closed_no_sell_row" | "untraded" | "closed_exit_unrecorded" | "closed_exit_documented";

export interface DevFacts {
  scored: boolean;
  reason?: DevNoScoreReason;
  band?: DevBand;
  tier?: DumpTier;
  forcedBy?: "lp" | null;
  launches: number;
  onCurve: number;
  graduated: number;
  sampled: number;
  tradeable: number;
  coinsWithTrades: number;
  dumps: number;
  dumpRate: number | null;
  medianPullMultiple: number | null;
  fastestFirstSellS: number | null;
  medianFirstSellS: number | null;
  selfSnipeRate: number | null;
  sellWithoutBuyCoins: number;
  meanSeverity: number | null;
  careerDays: number;
  careerDaysIsFloor: boolean;
  bookTruncated: boolean;
  peakMcUsd: number;
  over1m: number;
  flagship: { address: string; symbol: string; peakMcUsd: number; mcUsd: number; tradeable: boolean; status: FlagshipStatus; holds: boolean | null; dumped: boolean; exitUnrecorded: boolean } | null;
  liquidity: { drained: string[]; partial: string[]; ignoredRows: number };
  supplyMoves: { token: string; symbol: string; to: string; shareOfSupply: number; secondsAfterOpen: number }[];
  bundlerMedian: number | null;
  implausiblePeaks: string[];
  unresolvedCoins: number;
  tradesChecked: boolean;
  terms: { raw: number; dumpPen: number; abandonPen: number; shrinkTo: number; shrinkWeight: number; factoryPen: number; opaquePen: number; peak: number; repeatable: number; flagshipAlive: number; bookQuality: number; bonus: number } | null;
}

export interface DevScoreInput {
  createdTokens: unknown; // GET /v1/user/created_tokens data
  walletStats?: unknown; // GET /v1/user/wallet_stats data (corroborates an empty record)
  devActivity?: Record<string, unknown>; // per-coin GET /v1/user/wallet_activity data for the dev, keyed by token address
  flagshipInfo?: unknown; // GET /v1/token/info data for his highest-peaking coin (exit audit, real age)
  now?: number; // unix ms (seconds also accepted)
}

export interface DevScoreResult {
  conduct: Score;
  power: Score;
  total: Score;
  facts: DevFacts;
}

// A peak has to be believable against the coin's own footprint (dev_score.py ath_ok): a $21B "peak" on a coin with 28
// holders and a $9.5K pool is a data artifact. With no footprint at all, nothing contradicts it, so it is trusted.
function athOk(t: Dict): boolean {
  const a = num(t.token_ath_mc);
  if (a < 1e6) return true;
  if (num(t.holders) >= ATH_MIN_HOLDERS) return true;
  const foot = Math.max(num(t.pool_liquidity), num(t.market_cap));
  if (foot <= 0 && (t.holders === null || t.holders === undefined)) return true;
  return a <= ATH_MAX_RATIO * Math.max(foot, 1.0);
}
const tAth = (t: Dict) => (athOk(t) ? num(t.token_ath_mc) : 0);
const isAlive = (t: Dict | undefined) => !!t && bool(t.is_open) && num(t.pool_liquidity) >= 4000;
const sym = (t: Dict | undefined, addr = "") => safeText(t?.symbol, 16) || addr.slice(0, 6) || "?";

function activityRows(v: unknown): Dict[] {
  const d = unwrap(v);
  if (Array.isArray(d)) return d.map(obj);
  return arr(obj(d).activities).map(obj);
}

function noScore(reason: DevNoScoreReason, f: Partial<DevFacts>): DevScoreResult {
  const copy: Record<DevNoScoreReason, { title: string; summary: string }> = {
    index_empty: {
      title: "No launch data yet",
      summary: "GMGN returned an empty record and nothing else confirms this wallet, so it could be a fresh wallet or a temporary data gap. Check again in a few minutes.",
    },
    not_a_person: {
      title: "Launch factory",
      summary: "Over 20,000 launches with nothing graduating or reaching $1M — this looks like a launchpad or factory contract, not a person.",
    },
    peak_implausible: { title: "Bad peak data", summary: "GMGN reports a peak market cap above $50B for this dev, which is a data error, so no score is given." },
    never_launched: { title: "Not a dev", summary: "This wallet trades but has never launched a coin." },
  };
  const s: Score = { value: 0, grade: "unknown", title: copy[reason].title, reasons: [], summary: copy[reason].summary };
  const facts: DevFacts = {
    scored: false, reason, launches: 0, onCurve: 0, graduated: 0, sampled: 0, tradeable: 0, coinsWithTrades: 0, dumps: 0, dumpRate: null,
    medianPullMultiple: null, fastestFirstSellS: null, medianFirstSellS: null, selfSnipeRate: null, sellWithoutBuyCoins: 0, meanSeverity: null,
    careerDays: 0, careerDaysIsFloor: false, bookTruncated: false, peakMcUsd: 0, over1m: 0, flagship: null,
    liquidity: { drained: [], partial: [], ignoredRows: 0 }, supplyMoves: [], bundlerMedian: null, implausiblePeaks: [], unresolvedCoins: 0,
    tradesChecked: false, terms: null, ...f,
  };
  return { conduct: { ...s }, power: { ...s }, total: { ...s }, facts };
}

export function devScore(input: DevScoreInput): DevScoreResult {
  try {
    return devScoreUnsafe(input);
  } catch {
    // Defensive parsing should make this unreachable; a scorer must never take a page down.
    return noScore("index_empty", {});
  }
}

function devScoreUnsafe(input: DevScoreInput): DevScoreResult {
  const NOW = nowSeconds(input.now);
  const ct = obj(unwrap(input.createdTokens));
  const toks = arr(ct.tokens).map(obj).filter((t) => !!str(t.token_address)); // a row with no address is not a launch
  const inner = Math.trunc(num(ct.inner_count));
  const opened = Math.trunc(num(ct.open_count));
  const N_ctr = inner + opened;
  // Each source is only a floor on the truth (counters can come back smaller than tokens[]), so take the max.
  const N = Math.max(N_ctr, toks.length);
  let athMc = num(obj(ct.creator_ath_info).ath_mc);
  const junk = toks.filter((t) => !athOk(t));
  const best = toks.reduce((m, t) => Math.max(m, tAth(t)), 0);
  if (junk.length && athMc > best) athMc = best; // the headline peak IS the unbelievable row

  // ── N == 0 is two different facts: a genuinely empty wallet, or a degraded index answering 200 OK with zeros.
  // Corroborate with wallet_stats: any trace => indexed and genuinely not a dev; all zero / not supplied => no verdict.
  let aliveHint: boolean | null = null;
  if (N < 1 && input.walletStats !== undefined && input.walletStats !== null) {
    const st = obj(unwrap(input.walletStats));
    const ps = obj(st.pnl_stat);
    aliveHint = ["buy", "sell", "last_timestamp", "realized_profit", "total_cost"].some((k) => num(st[k]) !== 0) || num(ps.token_num) !== 0;
  }
  // Hard non-person gates, in the script's order. The factory gate is behaviour, not a bare count: volume with nothing
  // ever graduating or pricing (> 20,000 launches AND (no graduation OR peak < $1M)).
  if (N > FACTORY_N && (opened < 1 || athMc < FACTORY_ATH)) return noScore("not_a_person", { launches: N, graduated: opened, onCurve: inner, peakMcUsd: athMc });
  if (athMc > PEAK_MAX) return noScore("peak_implausible", { launches: N, graduated: opened, onCurve: inner, peakMcUsd: athMc });
  if (N < 1 && aliveHint) return noScore("never_launched", { launches: 0 });
  if (N < 1) return noScore("index_empty", { launches: 0 });

  // ── his own rows, in his own coins ──
  const launchTs = new Map<string, number>();
  for (const t of toks) {
    const a = str(t.token_address);
    if (a) launchTs.set(a, num(t.create_timestamp));
  }
  const byAddr = new Map<string, Dict>(toks.map((t) => [str(t.token_address), t]));
  const positives = [...launchTs.values()].filter((v) => v > 0);
  const earliestLaunch = positives.length ? positives.reduce((a, b) => Math.min(a, b)) : 0;

  const tradesChecked = !!input.devActivity && typeof input.devActivity === "object";
  const feeds = new Map<string, Dict[]>(); // token -> its unfiltered feed (flagship exit audit)
  const seen = new Set<string>();
  const rows: Dict[] = [];
  let feedTruncated = false;
  if (tradesChecked) {
    for (const [key, v] of Object.entries(input.devActivity ?? {})) {
      if (str(obj(unwrap(v)).next)) feedTruncated = true;
      for (const a of activityRows(v)) {
        const ad = str(obj(a.token).address) || key;
        const k = [ad, str(a.event_type), str(a.timestamp), str(a.cost_usd) || str(a.quote_amount), str(a.tx_hash)].join("|");
        if (!feeds.has(ad)) feeds.set(ad, []);
        feeds.get(ad)!.push(a);
        if (seen.has(k)) continue; // de-dup on (token, event_type, timestamp, amount, tx_hash)
        seen.add(k);
        rows.push({ ...a, __token: ad });
      }
    }
  }
  const unresolvedCoins = tradesChecked ? toks.filter((t) => !feeds.has(str(t.token_address))).length : toks.length;

  // Supply moved to another wallet (disclosed; a move is not a dump, and an unverified recipient may be a lock or CEX).
  const devAddr = str(obj(input.walletStats ? unwrap(input.walletStats) : {}).wallet_address).toLowerCase();
  const moves: DevFacts["supplyMoves"] = [];
  for (const a of rows) {
    if (str(a.event_type) !== "transfer_out") continue;
    const ad = str(a.__token);
    if (!launchTs.has(ad)) continue;
    const to = str(a.to_address).toLowerCase();
    if (!to || BURN.has(to) || (devAddr && to === devAddr)) continue;
    const sup = num(obj(a.token).total_supply);
    const share = sup > 0 ? num(a.token_amount) / sup : 0;
    if (share < SIB_MIN_SHARE) continue;
    moves.push({ token: ad, symbol: sym(byAddr.get(ad), ad), to: safeText(to, 8), shareOfSupply: share, secondsAfterOpen: num(a.timestamp) - (launchTs.get(ad) ?? 0) });
  }

  // A `remove` row only counts as a drain when it moves the TOKEN, a meaningful amount of it (>= 0.5% of supply or a
  // confirmed >= $500), on a pool that is now dead. quote_amount is in the PAIRED token and is never a size.
  interface Per { buy: number; sell: number; fs: number | null; fb: number | null }
  const per = new Map<string, Per>();
  const lpHits: string[] = [];
  let lpZero = 0;
  for (const a of rows) {
    const ad = str(a.__token);
    const et = str(a.event_type);
    if (!launchTs.has(ad) || !["buy", "sell", "remove"].includes(et)) continue;
    if (et === "remove") {
      const supR = num(obj(a.token).total_supply);
      const amtR = num(a.token_amount);
      const shrR = supR > 0 ? amtR / supR : 0;
      if (amtR > 0 && (shrR >= LP_MIN_SHARE || num(a.cost_usd) >= LP_MIN_USD)) lpHits.push(ad);
      else lpZero += 1;
    }
    if (!per.has(ad)) per.set(ad, { buy: 0, sell: 0, fs: null, fb: null });
    const p = per.get(ad)!;
    const amt = num(a.cost_usd || a.quote_amount);
    const d = num(a.timestamp) - (launchTs.get(ad) ?? 0);
    if (et === "buy") {
      p.buy += amt;
      if (p.fb === null || d < p.fb) p.fb = d;
    } else if (et === "sell") {
      p.sell += amt;
      if (p.fs === null || d < p.fs) p.fs = d;
    }
  }

  // Severity is continuous on both axes (how many times over x how early); the boolean only names the behaviour and
  // feeds the gate. `2.70x @40s` read clean and `1.73x @28s` read dump under the boolean alone.
  const fMult = (m: number) => clamp((m - 1.0) / (SEV_MULT_FULL - 1.0));
  const fDelay = (x: number | null) => (x !== null ? clamp((SEV_SEC_ZERO - x) / SEV_SEC_ZERO) : 0);
  const traded: string[] = [];
  const cut: string[] = [];
  const mults: number[] = [];
  const delays: number[] = [];
  const noBuy: string[] = [];
  const sevBy = new Map<string, number>();
  let snipes = 0;
  for (const [ad, p] of per) {
    if (p.buy <= 0 && p.sell <= 0) continue;
    traded.push(ad);
    // pull multiple is undefined without a buy; the 99 sentinel feeds severity/dump only and is never reported.
    const mult = p.buy > 0 ? p.sell / p.buy : null;
    const multSev = mult !== null ? mult : p.sell > 0 ? 99.0 : 0.0;
    if (mult !== null) mults.push(mult);
    else if (p.sell > 0) noBuy.push(ad);
    if (p.fb !== null && p.fb <= 60) snipes += 1;
    if (p.fs !== null) delays.push(p.fs);
    sevBy.set(ad, fMult(multSev) * fDelay(p.fs));
    if (multSev >= CUT_MULT && p.fs !== null && p.fs <= CUT_SEC) cut.push(ad);
  }
  const nTr = traded.length;
  const cutRate = nTr ? cut.length / nTr : null;
  const medMult = medUpper(mults);
  const medDelay = medUpper(delays);
  // Timing must quote the FASTEST first sell, never the median (the median once said 2.7 days on a dev whose flagship
  // started selling at 4.6 minutes).
  const minDelay = delays.length ? delays.reduce((a, b) => Math.min(a, b)) : null;
  const snipeRate = nTr ? snipes / nTr : null;
  const meanSev = nTr ? [...sevBy.values()].reduce((a, b) => a + b, 0) / nTr : null;

  // ── structure of his book (outcomes: POWER only) ──
  const alive = toks.filter((t) => isAlive(t)).length;
  const survDen = Math.min(toks.length, N); // sampled population, not the true total
  const surv = survDen ? alive / survDen : 0;
  const bookTrunc = survDen < N;
  const grad = N_ctr ? opened / N_ctr : 0; // server counters: numerator and denominator from one source
  const cto = toks.length ? toks.filter((t) => bool(t.cto_flag)).length / toks.length : 0;
  const big = toks.filter((t) => tAth(t) >= 1e6);
  const k1m = big.length;
  const ddBig = big.length ? medUpper(big.filter((t) => tAth(t) > 0).map((t) => 1.0 - num(t.market_cap) / tAth(t))) : null;
  const lpSet = [...new Set(lpHits)];
  const lpDrained = lpSet.filter((ad) => !isAlive(byAddr.get(ad)));
  const lpPartial = lpSet.filter((ad) => isAlive(byAddr.get(ad)));
  const lpRemoved = lpDrained.length > 0;

  const top = [...toks].sort((a, b) => tAth(b) - tAth(a)).slice(0, 3);
  const top1 = top[0];
  const top1Addr = top1 ? str(top1.token_address) : "";
  const top1Cut = !!top1 && cut.includes(top1Addr);

  // Bundled buying at open — disclosed, never scored: the number cannot tell his alts from a paid bundler or a bot.
  const brs = toks.filter((t) => t.bundler_rate !== null && t.bundler_rate !== undefined && t.bundler_rate !== "").map((t) => num(t.bundler_rate));
  const brMed = brs.length ? medUpper(brs) : null;
  const brHot = toks.filter((t) => num(t.bundler_rate) >= BUND_HOT).length;

  // ── flagship position (token info) ──
  let top1Status: FlagshipStatus = "unreadable";
  let top1Hold: boolean | null = null; // tri-state: null = the API said nothing, say nothing about his bag
  let top1Closed = false;
  if (top1 && input.flagshipInfo) {
    const ti = obj(unwrap(input.flagshipInfo));
    const infoAddr = str(ti.address);
    if (!infoAddr || infoAddr.toLowerCase() === top1Addr.toLowerCase()) {
      const d = obj(ti.dev);
      const st = str(d.creator_token_status);
      const bal = num(d.creator_token_balance);
      if (st || bal) top1Hold = st === "creator_hold" || bal > 0;
      if (st === "creator_hold") top1Status = "holding";
      else if (st.includes("sell")) top1Status = "sold_own_bag";
      else if (st === "creator_close") {
        top1Closed = true;
        top1Status = "closed_no_sell_row";
      } else if (!per.has(top1Addr)) top1Status = "untraded";
    }
  }
  // Career length (NOT flagship age) drives the shrink; on a truncated book it is a floor and the time half is skipped.
  const careerDays = earliestLaunch > 0 ? Math.max(0, (NOW - earliestLaunch) / 86400) : 0;
  const careerFloor = bookTrunc;

  // ── flagship exit audit: closed position + non-empty feed + not one row that accounts for the exit ──
  // (scoring.md: the feed must be non-empty; a lookup we do not have never accuses.)
  let opaqueExit = false;
  let exitKinds: string[] = [];
  if (top1 && top1Closed && feeds.has(top1Addr)) {
    const feed = feeds.get(top1Addr)!;
    exitKinds = [...new Set(feed.map((r) => str(r.event_type) || "?"))].sort();
    opaqueExit = feed.length > 0 && !feed.some((r) => ACCOUNTED.has(str(r.event_type)));
  }
  if (opaqueExit) top1Status = "closed_exit_unrecorded";
  else if (top1Closed && exitKinds.length) top1Status = "closed_exit_documented";

  // ── CONDUCT — only what he did himself ──
  const abandonPen = r1(clamp((cto - 0.3) / 0.7) * 10.0);
  const dumpPen = r1(meanSev !== null ? 55.0 * meanSev : 0.0);
  const raw = r1(Math.max(0, 100 - dumpPen - abandonPen));
  // Thin-record shrink toward 60 ("we cannot tell yet"), downward only: breadth = traded coins (not launches), time =
  // career length; time half skipped on a truncated book because it would be a window, not a career.
  const w = Math.min(1, nTr / 5) * (careerFloor ? 1 : Math.min(1, careerDays / 30));
  const credShrunk = raw > 60 ? r1(60 + (raw - 60) * w) : raw;
  const factoryPen = r1(45 * clamp((Math.log10(Math.max(FAC_LO, inner)) - Math.log10(FAC_LO)) / (Math.log10(FAC_HI) - Math.log10(FAC_LO))));
  const opaquePen = opaqueExit ? OPAQUE_PEN : 0;

  const C = new Tally().start("Starts at 100", 100);
  if (nTr) {
    C.add(
      `Sold into buyers early (average severity ${meanSev!.toFixed(2)} across ${plural(nTr, "coin")} they traded)`,
      -dumpPen,
      "wallet_activity.buy/sell",
    );
  }
  C.add(`Walked away from ${pct(cto, 0)} of their coins (community took over)`, -abandonPen, "created_tokens.tokens[].cto_flag");
  C.floor(0, "Kept at 0");
  if (credShrunk < raw) {
    const thin: string[] = [];
    if (nTr < 5) thin.push(nTr === 0 ? "no coins with their own trades" : `only ${plural(nTr, "coin")} with their own trades`);
    if (!careerFloor && careerDays < 30) thin.push(`${careerDays < 1 ? `${Math.max(1, Math.round(careerDays * 24))}h` : `${Math.round(careerDays)} days`} of launching`);
    C.add(`Short record (${thin.join(", ") || "thin sample"}), so pulled toward 60`, credShrunk - raw, "created_tokens.tokens[].create_timestamp");
  }
  C.add(`${plural(inner, "coin")} never left the bonding curve`, -factoryPen, "created_tokens.inner_count");
  C.add("The dev's biggest coin position is closed and nothing in their history shows where it went", -opaquePen, "token_info.dev.creator_token_status");
  C.floor(0, "Kept at 0");

  // ── POWER — what the market did with his coins ──
  const B1 = r1(clamp((Math.log10(Math.max(1, Math.min(athMc, PEAK_MAX))) - 5.0) / 4.0) * 60.0);
  const B2 = r1(k1m < 1 ? 0 : Math.min(25, 11 + 5 * Math.log2(k1m)));
  const B3 = top1 && isAlive(top1) ? 10 : 0;
  // drawdown of his $1M+ coins counts 0.5 when he has none (no big coin is not a clean drawdown record); B4 is the one
  // term scaled by sample size (a book of one is not a track record).
  const ddTerm = ddBig !== null ? 1 - clamp(ddBig) : 0.5;
  const wBook = Math.min(1, survDen / 5);
  const B4 = r1(10 * (0.5 * clamp(surv) + 0.3 * clamp(grad) + 0.2 * ddTerm) * wBook);
  const P = new Tally().start(`Best coin peaked at ${usd(athMc)}`, B1, "created_tokens.creator_ath_info.ath_mc");
  if (B2 > 0) P.add(`${plural(k1m, "coin")} passed $1M${bookTrunc ? " (of the launches we can see)" : ""}`, B2, "created_tokens.tokens[].token_ath_mc");
  else P.note(`No coin passed $1M${bookTrunc ? " among the launches we can see" : ""}`, "created_tokens.tokens[].token_ath_mc");
  if (B3 > 0) P.add("The dev's best coin still trades with a real pool", B3, "created_tokens.tokens[].pool_liquidity");
  else if (top1) P.note("The dev's best coin no longer has a tradeable pool", "created_tokens.tokens[].pool_liquidity");
  P.add(`Book quality: ${alive} of ${survDen} sampled coins still trade, ${pct(grad, 0)} graduated`, B4, "created_tokens.tokens[].is_open");
  P.cap(100, "Capped at 100");
  const power = P.value;
  const bonus = r1(Math.max(0, (Math.min(1, k1m / 3) * (power - 50)) / 50 * 15));

  // ── dump-rate gate: three tiers, asymmetric at low sample ──
  let tier: DumpTier = "none";
  let tierWhy: "lp" | null = null;
  if (lpRemoved) {
    tier = "sys";
    tierWhy = "lp";
  } else if (nTr < 5) {
    tier = cut.length >= 2 || top1Cut ? "sys" : "often_unproven";
  } else if ((cutRate ?? 0) > 0.75 || top1Cut) tier = "sys";
  else if (cut.length === 0) tier = "none"; // measured clean over >= 5 traded coins — NOT "no data"
  else if ((cutRate ?? 0) <= 0.3) tier = "rare";
  else tier = "often";

  const dumpLine = `Cashed out 1.5× or more within 30s of launch in ${cut.length} of ${plural(nTr, "coin")} they traded`;
  if (tier === "often") C.add(dumpLine, -PEN_OFTEN, "wallet_activity.sell");
  else if (tier === "often_unproven") C.cap(CAP_UNPROVEN, `Fewer than 5 coins with their own trades, so capped at ${CAP_UNPROVEN}`, "wallet_activity.buy/sell");
  else if (tier === "sys") {
    const why = tierWhy === "lp"
      ? `Pulled liquidity out of ${plural(lpDrained.length, "pool")} that later died`
      : top1Cut && cut.length < 2 && nTr < 5
        ? "Cashed out early on their biggest coin"
        : dumpLine;
    C.cap(CAP_SYS, `${why}, so capped at ${CAP_SYS}`, tierWhy === "lp" ? "wallet_activity.remove" : "wallet_activity.sell");
  }
  // Disclosures — measured, not scored.
  if (minDelay !== null) C.note(`Fastest first sell: ${dur(Math.max(0, minDelay))} after launch`, "wallet_activity.timestamp");
  if (medMult !== null) C.note(`Median cash-out vs put-in: ${medMult.toFixed(2)}×`, "wallet_activity.cost_usd");
  if (noBuy.length) C.note(`Sold without buying in ${plural(noBuy.length, "coin")} (could be creator fees or their launch allocation)`, "wallet_activity.sell");
  if (brMed !== null && brMed > 0) C.note(`Bundled buying at launch: median ${pct(brMed)} of supply${brHot ? `, ${brHot} coins above 20%` : ""} (not scored)`, "created_tokens.tokens[].bundler_rate");
  if (moves.length) C.note(`Moved 1%+ of supply to another wallet in ${plural(new Set(moves.map((m) => m.token)).size, "coin")} (not counted as selling)`, "wallet_activity.transfer_out");
  if (lpZero) C.note(`${plural(lpZero, "tiny liquidity removal")} ignored`, "wallet_activity.remove");
  if (!tradesChecked) C.note("The dev's own trades were not checked", "wallet_activity");
  else if (unresolvedCoins > 0 || feedTruncated) C.note(`Trades not fully checked on ${unresolvedCoins || "some"} coins, so the dump count is a minimum`, "wallet_activity");
  const cred = C.value;

  // TOTAL from the POST-gate conduct, then capped (cap the input, not just the answer).
  const T = new Tally().start("Conduct score", cred);
  T.add(`Track-record bonus (${plural(k1m, "coin")} over $1M)`, bonus, "created_tokens.tokens[].token_ath_mc");
  T.clamp();
  if (tier === "often" || tier === "often_unproven") {
    T.cap(CAP_OFTEN_TOT, tier === "often" ? `Dumps at launch often, so capped at ${CAP_OFTEN_TOT}` : `Too few traded coins to rule out dumping, so capped at ${CAP_OFTEN_TOT}`);
  } else if (tier === "sys") T.cap(CAP_SYS_TOT, `Dumping pattern, so capped at ${CAP_SYS_TOT}`);
  // A flagship dump needs a sell row to exist, so an invisible exit gets the unproven ceiling too.
  if (opaqueExit) T.cap(CAP_OFTEN_TOT, `Biggest coin's exit can't be traced, so capped at ${CAP_OFTEN_TOT}`);
  const total = T.value;
  const band: DevBand = total >= 75 ? "buyable" : total >= 50 ? "mixed" : total >= 30 ? "avoid" : "stay_away";

  // ── copy ──
  const fastest = minDelay !== null ? `; fastest first sell ${dur(Math.max(0, minDelay))} after launch` : nTr ? "; they never sold" : "";
  const conductTitle =
    tier === "sys" ? (tierWhy === "lp" ? "Pulled liquidity" : "Dumps at launch")
      : tier === "often" ? "Often dumps early"
        : tier === "rare" ? "Sometimes cashes out early"
          : tier === "none" ? (opaqueExit ? "Exit can't be traced" : "No launch dumps")
            : "Not enough history";
  const conductSummary = nTr
    ? `Cashed out early (1.5×+ within 30s) in ${cut.length} of ${plural(nTr, "coin")} they traded${fastest}.`
    : tradesChecked
      ? "None of the dev's coins show their own trades yet, so there is no dump record either way."
      : "The dev's own trades in their coins have not been checked yet.";
  const conductGrade: Score["grade"] = tier === "sys" ? "risky" : cred >= 75 ? "good" : cred >= 50 ? "mixed" : "risky";

  const powerTitle = power >= 60 ? "Has built big coins" : power >= 30 ? "Some traction" : "No big coins yet";
  const powerSummary = `Best coin peaked at ${usd(athMc)}; ${plural(k1m, "coin")} passed $1M; ${alive} of ${survDen} sampled coins still trade${bookTrunc ? ` (latest ${survDen} of ${N} launches)` : ""}.`;
  const powerGrade: Score["grade"] = power >= 60 ? "good" : power >= 30 ? "mixed" : "risky";

  let totalTitle: string;
  let totalSummary: string;
  if (tier === "sys" && tierWhy === "lp") {
    totalTitle = "Pulled liquidity";
    totalSummary = "This dev pulled liquidity from a pool that later died, which left holders unable to sell.";
  } else if (tier === "sys") {
    totalTitle = "Dumps at launch";
    totalSummary = `This dev's pattern is selling into buyers right at launch (${cut.length} of ${plural(nTr, "coin")} they traded).${power >= 60 ? " They have built big coins before, but that does not offset the dumping." : ""}`;
  } else if (opaqueExit) {
    totalTitle = "Exit can't be traced";
    totalSummary = "The dev's biggest coin position is closed and their history doesn't show how it left, so the clean-looking numbers can't be confirmed.";
  } else if (total < 30) {
    totalTitle = "Poor record";
    totalSummary = `Weak on every side: ${conductSummary.charAt(0).toLowerCase()}${conductSummary.slice(1)}`;
  } else if (tier === "often_unproven") {
    totalTitle = total >= 50 ? "Unproven dev" : "Risky record";
    const young = careerDays < 30 && !careerFloor ? ` and ${careerDays < 1 ? "under a day" : `${Math.round(careerDays)} days`} of launching` : "";
    totalSummary = !tradesChecked
      ? "The dev's own trades in their coins haven't been checked yet, so there isn't enough history to rule out dumping."
      : nTr === 0
        ? `None of the dev's coins show their own trades${young}, so there isn't enough history to rule out dumping.`
        : `Only ${plural(nTr, "coin")} with their own trades${young}, so there isn't enough history to rule out dumping.`;
  } else if (tier === "often") {
    totalTitle = total >= 50 ? "Takes early profits" : "Risky record";
    totalSummary = conductSummary;
  } else if (total >= 75) {
    totalTitle = "Clean record";
    totalSummary = `${tier === "none" ? `No launch dumps across ${plural(nTr, "coin")} they traded` : conductSummary.replace(/\.$/, "")}; best coin peaked at ${usd(athMc)}.`;
  } else {
    totalTitle = total >= 50 ? "Mixed record" : "Risky record";
    totalSummary = `${conductSummary.replace(/\.$/, "")}; best coin peaked at ${usd(athMc)}.`;
  }
  const totalGrade: Score["grade"] = tier === "sys" ? "risky" : band === "buyable" ? "good" : band === "mixed" ? "mixed" : "risky";

  const facts: DevFacts = {
    scored: true, band, tier, forcedBy: tierWhy, launches: N, onCurve: inner, graduated: opened, sampled: toks.length, tradeable: alive,
    coinsWithTrades: nTr, dumps: cut.length, dumpRate: cutRate, medianPullMultiple: medMult, fastestFirstSellS: minDelay, medianFirstSellS: medDelay,
    selfSnipeRate: snipeRate, sellWithoutBuyCoins: noBuy.length, meanSeverity: meanSev, careerDays, careerDaysIsFloor: careerFloor, bookTruncated: bookTrunc,
    peakMcUsd: athMc, over1m: k1m,
    flagship: top1
      ? { address: top1Addr, symbol: sym(top1, top1Addr), peakMcUsd: tAth(top1), mcUsd: num(top1.market_cap), tradeable: isAlive(top1), status: top1Status, holds: top1Hold, dumped: top1Cut, exitUnrecorded: opaqueExit }
      : null,
    liquidity: { drained: lpDrained.map((a) => sym(byAddr.get(a), a)), partial: lpPartial.map((a) => sym(byAddr.get(a), a)), ignoredRows: lpZero },
    supplyMoves: moves.slice(0, 3), bundlerMedian: brMed, implausiblePeaks: junk.map((t) => sym(t, str(t.token_address))), unresolvedCoins, tradesChecked,
    terms: { raw, dumpPen, abandonPen, shrinkTo: credShrunk, shrinkWeight: w, factoryPen, opaquePen, peak: B1, repeatable: B2, flagshipAlive: B3, bookQuality: B4, bonus },
  };
  return {
    conduct: { value: cred, grade: conductGrade, title: conductTitle, reasons: C.reasons, summary: conductSummary },
    power: { value: power, grade: powerGrade, title: powerTitle, reasons: P.reasons, summary: powerSummary },
    total: { value: total, grade: totalGrade, title: totalTitle, reasons: T.reasons, summary: totalSummary },
    facts,
  };
}
