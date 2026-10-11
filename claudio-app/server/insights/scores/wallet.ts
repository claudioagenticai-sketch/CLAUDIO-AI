// gmgn-wallet-style / gmgn-wallet-score / gmgn-wallet-review port (and the shared style layer of gmgn-wallet-analysis
// analyze.py: freq_level / pnl_level / style_title / style_speed — same thresholds in all four skills).
//   style  — one title from the frequency × P&L grid, a speed subtitle from the MEDIAN first-buy→first-sell window
//            (never avg_holding_period, which counts bags never sold), orthogonal badges, and the wash-trader flag.
//   score  — gmgn-wallet-score's track-record score (outcome distribution, not just win rate), with the ×0.45
//            self-dealing discount for launcher wallets. Its copy-tradeability score is returned too, as `copy`.
//   review — gmgn-wallet-review's two sentences (recap + one observation), in plain English; the visitor voice is
//            rewritten as descriptions, never as instructions to follow or copy anyone.
// Not ported: 🚀 "front-runner" badge (needs a per-chain ordinary-gas baseline the skill never states), the copy-trade
// backtest (needs the user's latency / slippage / gas), Dev-reputation (needs security scans of recent launches — use
// devScore), and the review's 1D / all-time windows (portfolio profits is not an input here).
import type { Score } from "@shared/insights";
import { arr, clamp, median, nowSeconds, num, obj, pct, plural, safeText, str, Tally, unwrap, UNKNOWN_SCORE, type Dict } from "./util";

type L = "L1" | "L2" | "L3" | "L4";
type P = "P1" | "P2" | "P3" | "P4" | "P5";

/** Style titles: GMGN's 20-cell grid, translated into short natural English titles for the UI. */
export const STYLE_TITLES: Record<`${L}×${P}`, { title: string; gloss: string }> = {
  "L4×P5": { title: "Money Printer", gloss: "Trades at machine speed and still makes strong profits" }, // 🖨️ 印钞机 (money printer)
  "L4×P4": { title: "Volume Grinder", gloss: "Thin margins on huge volume" }, // ⚙️ 全自动P机 (full-auto grinder)
  "L4×P3": { title: "Worn Down by Fees", gloss: "Whatever it earns, fees and slippage take back" }, // 🪫 磨损户 (worn down)
  "L4×P2": { title: "Gas Burner", gloss: "High frequency, high friction; the loss is mostly cost" }, // 🔥 烧Gas机 (gas burner)
  "L4×P1": { title: "Self-Destructing Bot", gloss: "Machine speed plus broad heavy losses" }, // 💥 自毁装置 (self-destruct)
  "L3×P5": { title: "Harvester", gloss: "High frequency and strongly profitable" }, // 🌾 收割机 (harvester)
  "L3×P4": { title: "Active Winner", gloss: "Busy hands that keep the money" }, // ⚔️ P小将 (active winner)
  "L3×P3": { title: "Spinning in Place", gloss: "Trading fast, going nowhere" }, // 🌀 陀螺 (spinning top)
  "L3×P2": { title: "Fee Donor", gloss: "Real volume, and the money went on fees" }, // 💸 手续费贡献者 (fee donor)
  "L3×P1": { title: "Losing Streak", gloss: "Trades fast with a heavy tail of big losses" }, // 🩸 连败突击兵 (bleeding out)
  "L2×P5": { title: "Seasoned Hunter", gloss: "Trades rarely and earns well" }, // 🦅 老猎手 (old hunter)
  "L2×P4": { title: "Steady Hand", gloss: "Normal pace, positive return, no glaring weakness" }, // 📈 稳步选手 (steady hand)
  "L2×P3": { title: "Treading Water", gloss: "Active, but it has not turned into anything" }, // ☕ 空转户 (lukewarm)
  "L2×P2": { title: "Losing Trader", gloss: "The most common profile: steady small losses" }, // 🐑 亏损散户 (retail loser)
  "L2×P1": { title: "Deep Underwater", gloss: "Most of its coins are down more than 50%" }, // 🕳️ 深套户 (deep underwater)
  "L1×P5": { title: "One-Shot Winner", gloss: "Almost never trades, and lands it when it does" }, // 🗡️ 一击必杀 (one-shot)
  "L1×P4": { title: "Zen Winner", gloss: "The gain came from picks, not from working the trades" }, // 🧘 佛系赢家 (zen winner)
  "L1×P3": { title: "Bystander", gloss: "Too small a sample to mean much" }, // 👀 观望者 (bystander)
  "L1×P2": { title: "Toe in the Water", gloss: "Tried a few times, none worked" }, // 💧 试水亏损 (toe in the water)
  "L1×P1": { title: "Wiped Out", gloss: "One or two swings, wiped out" }, // ⚰️ 一把归零 (wiped out)
};

/** Speed subtitles (median round trip). */
export const STYLE_SPEEDS = [
  { under: 60, title: "Flash flipper" }, // ⚡ 秒杀流
  { under: 86_400, title: "Intraday" }, // 🐇 日内流
  { under: 604_800, title: "Swing trader" }, // 🧭 波段流
  { under: Infinity, title: "Long holder" }, // 💎 长持流
] as const;

/** Badges (wallet-style Step 7) and the wash-trader flag. */
export const STYLE_BADGES = {
  smallSample: "Small sample", // ⚠️ 样本不足
  wash: "Possible wash trading", // 🚩 刷量嫌疑
  lottery: "Lottery-style wins", // 🎰 彩票型
  sniper: "Early entries", // 🎯 狙击手
  scalesIn: "Scales in", // 🧱 分批建仓
  scalesOut: "Scales out", // ✂️ 分批止盈
  concentrated: "Concentrated bets", // 📦 集中押注
  accumulating: "Accumulating", // 🧊 囤积中
  distributing: "Distributing", // 📤 派发中
  fixedHours: "Trades at fixed hours", // 🌙 固定时段
  whale: "Whale", // 🐋 巨鲸
  launcher: "Token launcher", // 🏭 发币方
  newWallet: "New wallet", // 🆕 新钱包
  // ⭐ 官方认证 → "GMGN: <label>" (GMGN's own labels, quoted); 🚀 抢跑党 not ported (no gas baseline).
} as const;

// GMGN wallet labels (wallet-analysis TAGS). Order-channel tags (gmgn, photon, axiom …) are tools, not style.
const GMGN_LABELS: Record<string, string> = {
  kol: "KOL", smart_money: "smart money", bluechip_owner: "bluechip holder", top_followed: "heavily followed", top_renamed: "renamed often",
  sniper: "sniper", bundler: "bundler", rat_trader: "insider trader", insider: "insider", dev: "token creator", sandwich_bot: "sandwich bot",
  mev_bot: "MEV bot", whale: "whale",
};
const TOOL_TAGS = new Set(["gmgn", "photon", "bullx", "maestro", "pepeboost", "axiom", "padre", "trojan", "bonkbot", "fresh_wallet", "wash_trader"]);

export interface WalletProfileInput {
  stats: unknown; // GET /v1/user/wallet_stats data (period 7d by default)
  activity?: unknown; // GET /v1/user/wallet_activity data (or an array of rows; ~200 rows is what the skills sample)
  holdings?: unknown; // GET /v1/user/wallet_holdings data (closed positions → hold split + discipline rules)
  period?: "7d" | "30d";
  stats30d?: unknown; // optional 30D stats for the review's "returns weakening" check on a 7D read
  createdTokens?: unknown; // optional created_tokens data (graduations, for the launcher rule)
  voice?: "self" | "other";
  now?: number;
}

export interface WalletProfileResult {
  style: { title: string; subtitle?: string | null; badges: string[] } | null;
  score: Score;
  review: string | null;
  copy: Score;
}

function freqLevel(perDay: number): L {
  if (perDay < 1) return "L1";
  if (perDay < 10) return "L2";
  if (perDay <= 50) return "L3";
  return "L4";
}

// P5 needs ROI > 50% AND ONE corroborating shape (win rate ≥ 50% or heavy-loss share < 15%) AND ≥ 5 tokens.
function pnlLevel(m: M, review = false): P {
  const roi = m.roi;
  if (roi > 0.5 && m.tn >= 5 && (m.winrate >= 0.5 || m.lt50 < 0.15)) return "P5";
  // wallet-review's one deliberate difference: machine-speed wallets clear "net profit" at 3% (re-buying inflates cost).
  if (roi > 0.1 || (review && freqLevel(m.perDay) === "L4" && roi > 0.03 && m.realized > 0)) return "P4";
  if (m.lt50 >= 0.4 && m.realized < 0) return "P1";
  if (Math.abs(roi) <= 0.1) return "P3";
  if (m.realized < 0 || roi < 0) return "P2";
  return "P3";
}

interface M {
  buy: number; sell: number; trades: number; days: number; perDay: number; tn: number; winrate: number; realized: number; cost: number; roi: number;
  gt5: number; x2_5: number; x0_2: number; n50_0: number; lt_n50: number; lt50: number; small: number; fees: number; avgHoldS: number;
  created: number; createdAt: number; follow: number; tags: string[]; isDev: boolean;
}

function readStats(s: Dict, days: number): M {
  const ps = obj(s.pnl_stat);
  const c = obj(s.common);
  const buy = num("buy" in s ? s.buy : s.buy_count);
  const sell = num("sell" in s ? s.sell : s.sell_count);
  const tn0 = num(ps.token_num);
  const b = { gt5: num(ps.pnl_gt_5x_num), x2_5: num(ps.pnl_2x_5x_num), x0_2: num(ps.pnl_0x_2x_num), n50_0: num(ps.pnl_nd5_0x_num), lt_n50: num(ps.pnl_lt_nd5_num) };
  const tn = tn0 || b.gt5 + b.x2_5 + b.x0_2 + b.n50_0 + b.lt_n50;
  const created = num(c.created_token_count);
  return {
    buy, sell, trades: buy + sell, days, perDay: (buy + sell) / days, tn, winrate: num(ps.winrate), realized: num(s.realized_profit),
    cost: num("bought_cost" in s ? s.bought_cost : s.total_cost), roi: num("realized_profit_pnl" in s ? s.realized_profit_pnl : s.pnl), ...b,
    lt50: b.lt_n50 / Math.max(1, tn), small: b.n50_0 / Math.max(1, tn), fees: num(s.bought_fee) + num(s.sold_fee), avgHoldS: num(ps.avg_holding_period),
    created, createdAt: num(c.created_at), follow: num(c.follow_count),
    tags: (arr(c.tags).length ? arr(c.tags) : c.tag ? [c.tag] : []).map((t) => str(t).trim()).filter(Boolean),
    isDev: created > 0 && created > 0.5 * Math.max(1, tn),
  };
}

function rowsOf(v: unknown, keys = ["activities", "list", "holdings"]): Dict[] {
  const d = unwrap(v);
  if (Array.isArray(d)) return d.map(obj);
  const o = obj(d);
  for (const k of keys) if (Array.isArray(o[k])) return (o[k] as unknown[]).map(obj);
  return [];
}

const money = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(1)}K`;
  if (a < 20) return `$${a.toFixed(1)}`;
  return `$${a.toFixed(0)}`;
};
const pctR = (x: number) => (Math.abs(x) < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
const holdTxt = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)} days`);

export function walletProfileScores(input: WalletProfileInput): WalletProfileResult {
  try {
    return walletUnsafe(input);
  } catch {
    return { style: null, score: UNKNOWN_SCORE, review: null, copy: UNKNOWN_SCORE };
  }
}

function walletUnsafe(input: WalletProfileInput): WalletProfileResult {
  const s = obj(unwrap(input.stats));
  const days = input.period === "30d" ? 30 : 7;
  const win = days === 30 ? "over the last 30 days" : "over the last 7 days";
  const m = readStats(s, days);
  const NOW = nowSeconds(input.now);
  const voice = input.voice === "self" ? "self" : "other";

  // Step 0: no trades, no tokens, no launches → a token contract, a fresh wallet or transfer-only. Say nothing.
  if (m.trades === 0 && m.tn === 0 && m.created === 0) {
    return { style: null, score: { ...UNKNOWN_SCORE, summary: "No trades in this window to judge." }, review: null, copy: UNKNOWN_SCORE };
  }

  // ── behaviour sample: buy / sell rows only (transfers are not trades) ──
  const acts = rowsOf(input.activity).filter((a) => ["buy", "sell"].includes(str(a.event_type || a.type).toLowerCase()));
  const et = (a: Dict) => str(a.event_type || a.type).toLowerCase();
  const tok = (a: Dict) => str(obj(a.token).address);
  const byTok = new Map<string, Dict[]>();
  for (const a of acts) if (tok(a)) byTok.set(tok(a), [...(byTok.get(tok(a)) ?? []), a]);
  const mcaps: number[] = [];
  for (const a of acts) {
    if (et(a) !== "buy") continue;
    const mc = num(a.price_usd) * num(obj(a.token).total_supply);
    if (mc > 0) mcaps.push(mc);
  }
  const entryP50 = median(mcaps);
  const copyWindows: number[] = [];
  const buysPer: number[] = [];
  const sellsPer: number[] = [];
  for (const evs0 of byTok.values()) {
    const evs = [...evs0].sort((x, y) => num(x.timestamp) - num(y.timestamp));
    const buys = evs.filter((e) => et(e) === "buy");
    const sells = evs.filter((e) => et(e) === "sell");
    buysPer.push(buys.length);
    sellsPer.push(sells.length);
    if (buys.length) {
      const fb = num(buys[0].timestamp);
      const fsell = sells.find((e) => num(e.timestamp) > fb); // first sell after the first buy
      if (fsell) copyWindows.push(num(fsell.timestamp) - fb);
    }
  }
  const cwS = median(copyWindows);
  const cwN = copyWindows.length;
  const flash5 = cwN ? copyWindows.filter((x) => x <= 5).length / cwN : 0;
  const avgBuysPer = buysPer.length ? buysPer.reduce((a, b) => a + b, 0) / buysPer.length : 0;
  const avgSellsPer = sellsPer.length >= 5 ? sellsPer.reduce((a, b) => a + b, 0) / sellsPer.length : 0; // gated: one token is not a habit
  const buyByTok = new Map<string, number>();
  for (const a of acts) if (et(a) === "buy" && tok(a)) buyByTok.set(tok(a), (buyByTok.get(tok(a)) ?? 0) + num(a.cost_usd));
  const totBuy = [...buyByTok.values()].reduce((a, b) => a + b, 0);
  const top3 = totBuy > 0 && buyByTok.size >= 5 ? [...buyByTok.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / totBuy : null;
  const ts = acts.map((a) => num(a.timestamp)).filter((t) => t > 0);
  const spanH = ts.length >= 2 ? (Math.max(...ts) - Math.min(...ts)) / 3600 : 0;
  let hourPeak: number | null = null;
  if (ts.length >= 20 && spanH >= 12) {
    const hours = new Array(24).fill(0);
    for (const t of ts) hours[Math.floor(t / 3600) % 24] += 1;
    let best = 0;
    for (let h = 0; h < 24; h++) { let sum = 0; for (let k = 0; k < 6; k++) sum += hours[(h + k) % 24]; best = Math.max(best, sum); }
    hourPeak = best / ts.length;
  }

  // ── style ──
  let style: WalletProfileResult["style"] = null;
  {
    const badges: string[] = [];
    if (m.tags.includes("wash_trader")) badges.push(STYLE_BADGES.wash); // a flag, not a veto; listed first
    if (m.trades < 20) badges.push(`${STYLE_BADGES.smallSample} (${plural(m.trades, "trade")} in ${days}D)`); // gated on buy + sell, never token_num
    if (m.winrate < 0.35 && m.gt5 >= 1 && m.tn >= 5) badges.push(STYLE_BADGES.lottery);
    if (mcaps.length >= 5 && entryP50 > 0 && entryP50 < 100_000) badges.push(STYLE_BADGES.sniper);
    if (avgBuysPer >= 3) badges.push(STYLE_BADGES.scalesIn);
    if (avgSellsPer >= 3) badges.push(STYLE_BADGES.scalesOut);
    if (top3 !== null && top3 >= 0.7) badges.push(STYLE_BADGES.concentrated);
    if ((m.sell > 0 && m.buy / m.sell >= 3) || (m.sell === 0 && m.buy > 0)) badges.push(STYLE_BADGES.accumulating);
    if ((m.buy > 0 && m.sell / m.buy >= 3) || (m.buy === 0 && m.sell > 0)) badges.push(STYLE_BADGES.distributing);
    if (hourPeak !== null && hourPeak >= 0.7) badges.push(STYLE_BADGES.fixedHours);
    if (m.buy > 0 && m.cost / m.buy >= 10_000) badges.push(STYLE_BADGES.whale);
    if (m.isDev) badges.push(STYLE_BADGES.launcher);
    if (m.createdAt > 0 && (NOW - m.createdAt) / 86400 < 30) badges.push(STYLE_BADGES.newWallet);
    for (const t of m.tags) {
      const k = t.toLowerCase();
      if (TOOL_TAGS.has(k)) continue;
      const name = GMGN_LABELS[k] ?? safeText(k.replace(/_/g, " "), 20);
      if (name) badges.push(`GMGN: ${name}`);
    }
    let title: string;
    let subtitle: string | null = null;
    if (m.trades === 0 || m.tn < 5) title = "Too early to tell"; // a four-token wallet has nothing to label yet
    else {
      const cell = `${freqLevel(m.perDay)}×${pnlLevel(m)}` as const;
      title = STYLE_TITLES[cell].title;
    }
    if (cwN >= 3 && cwS > 0) {
      const sp = STYLE_SPEEDS.find((x) => cwS < x.under)!;
      subtitle = `${sp.title} · median round trip ${holdTxt(cwS)}`;
    }
    style = { title, subtitle, badges };
  }

  // ── score: gmgn-wallet-score track record ──
  let score: Score = UNKNOWN_SCORE;
  if (m.trades > 0) {
    const tn = Math.max(1, m.tn);
    const fac = {
      tail: 1 - m.lt_n50 / tn,
      upside: (m.gt5 + m.x2_5 + m.x0_2) / tn,
      roi: clamp((m.roi + 0.05) / 0.35),
      win: clamp(m.winrate / 0.5),
      size: clamp((tn - 20) / 300),
    };
    const T = new Tally().start(`Cuts losses: ${pct(m.lt50)} of coins fell more than half`, 34 * clamp(fac.tail), "pnl_stat.pnl_lt_nd5_num");
    T.add(`${pct(clamp(fac.upside))} of coins at or above break-even`, 28 * clamp(fac.upside), "pnl_stat.pnl_*_num", true);
    T.add(`Return on capital ${m.roi >= 0 ? "+" : ""}${pct(m.roi)}`, 16 * fac.roi, "realized_profit_pnl", true);
    T.add(`Win rate ${pct(m.winrate)}`, 10 * fac.win, "pnl_stat.winrate", true);
    T.add(`${plural(m.tn, "coin")} traded`, 12 * fac.size, "pnl_stat.token_num", true);
    if (m.isDev) T.add("Mostly trades coins it launched itself, so the record is discounted", -(T.value * (1 - 0.45)), "common.created_token_count");
    if (m.tags.includes("wash_trader")) T.note("GMGN flags this wallet as a wash trader; its trade count and profit may be self-made", "common.tags");
    if (m.trades < 10) T.note(`Only ${plural(m.trades, "trade")} in ${days}D, so this is a weak read`, "buy/sell");
    const v = T.value;
    let grade: Score["grade"] = v >= 60 ? "good" : v < 40 ? "risky" : "mixed";
    let title = v >= 60 ? "Strong record" : v < 40 ? "Weak record" : "Middling record";
    if (m.isDev) { grade = "mixed"; title = "Mostly launches coins"; }
    if (m.tags.includes("wash_trader") && grade === "good") grade = "mixed";
    if (m.trades < 10 && grade !== "risky") { grade = "unknown"; title = "Too few trades"; }
    const summary = `${m.realized >= 0 ? "Made" : "Lost"} ${money(m.realized)} ${win} on ${plural(m.tn, "coin")}; ${pct(m.winrate, 0)} win rate, ${pct(m.lt50)} of coins down more than half.${m.tags.includes("wash_trader") ? " GMGN flags it for wash trading." : ""}`;
    score = { value: v, grade, title, reasons: T.reasons, summary };
  }

  // ── copy-tradeability (gmgn-wallet-score) — needs the activity sample ──
  let copy: Score = UNKNOWN_SCORE;
  if (m.trades > 0 && acts.length) {
    // wallet-score pairs each sell with the latest preceding buy for its 5-second flip rate.
    let pairs = 0;
    let fast = 0;
    for (const evs0 of byTok.values()) {
      let lastBuy: number | null = null;
      for (const e of [...evs0].sort((x, y) => num(x.timestamp) - num(y.timestamp))) {
        if (et(e) === "buy") lastBuy = num(e.timestamp);
        else if (lastBuy !== null) { pairs += 1; if (num(e.timestamp) - lastBuy <= 5) fast += 1; lastBuy = null; }
      }
    }
    const flip = pairs ? fast / pairs : 0;
    const early = mcaps.length ? mcaps.filter((x) => x < 100_000).length / mcaps.length : 0;
    const avgTrade = m.sell ? m.realized / m.sell : 0;
    const f = {
      entry: clamp(0.12 + (1 - early)),
      profit: clamp(avgTrade / 80),
      hold: clamp((1 - flip * 1.6) * clamp(m.avgHoldS / 172800 + 0.15)),
      feasible: clamp(1 - m.trades / 2500),
      edge: clamp(1 - 0.6 * early - 0.6 * flip),
    };
    const C = new Tally().start(`${pct(early, 0)} of entries under $100K market cap`, 22 * f.entry, "activity.price_usd × token.total_supply");
    C.add(`About ${money(avgTrade)} profit per closing trade`, 22 * f.profit, "realized_profit / sell", true);
    C.add(`${pct(flip, 0)} of round trips closed within 5s`, 20 * f.hold, "activity.timestamp", true);
    C.add(`${m.trades.toLocaleString("en-US")} trades in ${days}D`, 18 * f.feasible, "buy/sell", true);
    C.add("Edge type: picks over speed", 18 * f.edge, "activity", true);
    if (m.isDev) C.add("Mostly trades coins it launched itself, so this is discounted", -(C.value * (1 - 0.45)), "common.created_token_count");
    const v = C.value;
    const thin = m.trades < 10 || acts.length < 5;
    copy = {
      value: v, grade: thin ? "unknown" : v >= 55 ? "good" : v < 35 ? "risky" : "mixed",
      title: thin ? "Too few trades" : v >= 55 ? "Easy to follow" : v < 35 ? "Hard to follow" : "Somewhat followable",
      reasons: C.reasons,
      summary: `${pct(early, 0)} of entries under $100K, ${pct(flip, 0)} of round trips within 5s, about ${money(avgTrade)} per closing trade.`,
    };
  }

  return { style, score, review: buildReview(m, input, { acts, byTok, et, cwS, cwN, flash5, entryP50, win, voice }), copy };
}

// ─── gmgn-wallet-review ──────────────────────────────────────────────────

interface Ctx {
  acts: Dict[]; byTok: Map<string, Dict[]>; et: (a: Dict) => string; cwS: number; cwN: number; flash5: number; entryP50: number; win: string; voice: "self" | "other";
}
interface Pos { hold: number; realized: number; cost: number; buys: number; ticket: number }

function buildReview(m: M, input: WalletProfileInput, c: Ctx): string | null {
  if (m.trades === 0) return null;
  if (m.tn < 5) return `Too few coins traded ${c.win} (under 5) to sum up yet.`;
  const self = c.voice === "self";
  const He = self ? "You" : "This wallet";
  const he = self ? "you" : "it";
  const his = self ? "your" : "its";

  // Payoff: Σ(cost_usd − buy_cost_usd) per token over sell rows; rows with no buy_cost_usd are skipped, never 0.
  const pnlByTok: number[] = [];
  for (const evs of c.byTok.values()) {
    const sells = evs.filter((e) => c.et(e) === "sell" && e.buy_cost_usd !== null && e.buy_cost_usd !== undefined && str(e.buy_cost_usd) !== "");
    if (sells.length) pnlByTok.push(sells.reduce((a, e) => a + num(e.cost_usd) - num(e.buy_cost_usd), 0));
  }
  const wins = pnlByTok.filter((x) => x > 0);
  const losses = pnlByTok.filter((x) => x < 0);
  const payoff = wins.length >= 5 && losses.length >= 5 ? wins.reduce((a, b) => a + b, 0) / wins.length / (Math.abs(losses.reduce((a, b) => a + b, 0)) / losses.length) : null;

  // Closed positions: holdings preferred, activity fallback when fewer than 30.
  const hold = rowsOf(input.holdings, ["holdings", "list"]);
  const fromHoldings: Pos[] = hold
    .filter((h) => num(h.start_holding_at) > 0 && num(h.end_holding_at) >= num(h.start_holding_at) && num(h.history_total_sells) > 0)
    .map((h) => ({ hold: num(h.end_holding_at) - num(h.start_holding_at), realized: num(h.realized_profit), cost: num(h.history_bought_cost), buys: num(h.history_total_buys), ticket: num(h.history_total_buys) > 0 ? num(h.history_bought_cost) / num(h.history_total_buys) : 0 }));
  let positions = fromHoldings;
  if (positions.length < 30) {
    positions = [];
    for (const evs of c.byTok.values()) {
      const buys = evs.filter((e) => c.et(e) === "buy");
      const sells = evs.filter((e) => c.et(e) === "sell");
      if (!buys.length || !sells.length) continue;
      const fb = Math.min(...buys.map((e) => num(e.timestamp)));
      const ls = Math.max(...sells.map((e) => num(e.timestamp)));
      const realized = sells.filter((e) => str(e.buy_cost_usd) !== "" && e.buy_cost_usd !== null && e.buy_cost_usd !== undefined).reduce((a, e) => a + num(e.cost_usd) - num(e.buy_cost_usd), 0);
      positions.push({ hold: ls - fb, realized, cost: buys.reduce((a, e) => a + num(e.cost_usd), 0), buys: buys.length, ticket: 0 });
    }
  }
  // 3d — holding-time split
  let split: { W: string; wRoi: number; wShare: number; B: string; bRoi: number } | null = null;
  if (positions.length >= 30) {
    const groups = [
      { name: "under a minute", test: (s: number) => s <= 60 },
      { name: "1–30 minutes", test: (s: number) => s > 60 && s <= 1800 },
      { name: "30 minutes to 6 hours", test: (s: number) => s > 1800 && s <= 21600 },
      { name: "over 6 hours", test: (s: number) => s > 21600 },
    ].map((g) => {
      const ps = positions.filter((p) => g.test(p.hold));
      const cost = ps.reduce((a, p) => a + p.cost, 0);
      const realized = ps.reduce((a, p) => a + p.realized, 0);
      return { name: g.name, n: ps.length, share: ps.length / positions.length, roi: cost > 0 ? realized / cost : 0, realized };
    });
    const W = [...groups].sort((a, b) => b.share - a.share)[0];
    const B = groups.filter((g) => g !== W && g.n >= 10).sort((a, b) => b.roi - a.roi)[0];
    if (W && B && W.share >= 0.4 && W.roi < 0.05 && B.roi >= 0.15 && B.roi >= 5 * Math.max(W.roi, 0.001) && B.realized > 0) {
      split = { W: W.name, wRoi: W.roi, wShare: W.share, B: B.name, bRoi: B.roi };
    }
  }
  // 3e — discipline rules (holdings only, ≥ 30 closed positions)
  let holdLosers: { l: number; w: number } | null = null;
  let sizeLosers: { l: number; w: number } | null = null;
  let badAdds: { added: number; single: number } | null = null;
  let bagHold = 0;
  if (fromHoldings.length >= 30) {
    const W = fromHoldings.filter((p) => p.realized > 0);
    const Lz = fromHoldings.filter((p) => p.realized < 0);
    if (W.length >= 10 && Lz.length >= 10) {
      const lh = median(Lz.map((p) => p.hold));
      const wh = median(W.map((p) => p.hold));
      if (lh >= 2 * wh) holdLosers = { l: lh, w: wh };
      const lt = median(Lz.map((p) => p.ticket)); // per-buy ticket, never cumulative cost
      const wt = median(W.map((p) => p.ticket));
      if (wt > 0 && lt >= 1.5 * wt) sizeLosers = { l: lt, w: wt };
    }
    const added = fromHoldings.filter((p) => p.buys >= 3);
    const single = fromHoldings.filter((p) => p.buys === 1);
    if (added.length >= 10 && single.length >= 10) {
      const roi = (ps: Pos[]) => { const cst = ps.reduce((a, p) => a + p.cost, 0); return cst > 0 ? ps.reduce((a, p) => a + p.realized, 0) / cst : 0; };
      if (roi(added) <= roi(single) - 0.1) badAdds = { added: roi(added), single: roi(single) };
    }
    bagHold = hold.filter((h) => num(h.end_holding_at) === 0 && num(h.balance) > 0 && num(h.unrealized_profit_pnl) <= -0.5 && num(h.history_bought_cost) >= 50).length;
    if (bagHold < 3) bagHold = 0;
  }
  // decline: the previous (longer) window's ROI > 0 and this one < 0.75 × it.
  let decline = false;
  if (input.stats30d && input.period !== "30d") {
    const s30 = readStats(obj(unwrap(input.stats30d)), 30);
    if (s30.cost > 0 && m.cost > 0 && s30.roi > 0 && m.roi < 0.75 * s30.roi) decline = true;
  }
  const graduated = input.createdTokens ? num(obj(unwrap(input.createdTokens)).open_count) : null;
  const fired = {
    heavy_loss: m.lt50 >= 0.35,
    fee: m.realized > 0 && m.fees / m.realized >= 0.3,
    net_loss: m.realized < 0,
    decline,
    small_loss: m.small >= 0.35,
    launcher: graduated !== null && m.created >= 20 && graduated / m.created < 0.05,
    crowd: m.follow >= 10_000 && c.entryP50 < 1_000_000,
    hold_split: !!split,
    size_losers: !!sizeLosers,
    hold_losers: !!holdLosers,
    bad_adds: !!badAdds,
    bag_hold: bagHold > 0,
    fast: c.cwN >= 3 && c.cwS > 0 && c.cwS < 60,
  };
  type K = keyof typeof fired;
  const feeRatio = m.realized > 0 ? m.fees / m.realized : 0;
  const clause: Partial<Record<K, string>> = {
    heavy_loss: `${pctR(m.lt50)} of ${his} coins fell more than half`,
    fee: feeRatio < 0.95 ? `fees ate ${pctR(feeRatio)} of the profit` : feeRatio < 1 ? "fees ate almost all of the profit" : `${he} paid more in fees than ${he} made`,
    hold_split: split ? `${pctR(split.wShare)} of ${his} coins were held ${split.W}, ${split.wRoi >= 0 ? `returning only ${pctR(split.wRoi)}` : "and those lost money"}` : undefined,
    size_losers: `${his} losing trades are sized bigger than the winners`,
    hold_losers: `${he} ${self ? "hold" : "holds"} losers longer than winners`,
    bad_adds: `coins ${he} added to did worse`,
    bag_hold: `${plural(bagHold, "position")} down more than 50% ${bagHold === 1 ? "is" : "are"} still open`,
    decline: "returns are weakening compared with the last 30 days",
    small_loss: `${pctR(m.small)} of ${his} coins were small losses`,
    launcher: graduated !== null ? `only ${graduated} of the ${m.created} coins ${he} launched graduated` : undefined,
  };
  // Strength (first match): clean loss-cutting (contradicted by hold_losers / bag_hold), win rate, payoff.
  let strength: string | null = null;
  if (m.lt50 < 0.05 && !fired.hold_losers && !fired.bag_hold) strength = self ? "cut losers quickly" : "cuts losers quickly";
  else if (m.winrate >= 0.6) strength = `${self ? "win" : "wins"} ${pctR(m.winrate)} of the time`;
  else if (payoff !== null && payoff >= 2) strength = `${self ? "have" : "has"} an average win ${payoff.toFixed(1)}× the average loss`;

  const recapOrder: K[] = ["heavy_loss", "fee", "hold_split", "size_losers", "hold_losers", "bad_adds", "bag_hold", "decline", "small_loss", "launcher"];
  const used = recapOrder.find((k) => fired[k] && clause[k]);
  const head = Math.abs(m.realized) < 1 ? `${He} roughly broke even ${c.win}` : `${He} ${m.realized >= 0 ? "made" : "lost"} ${money(m.realized)} ${c.win}`;
  const recap = `${head}${strength ? ` and ${strength}` : ""}${used ? `, but ${clause[used]}` : ""}.`;

  const order: K[] = self
    ? ["heavy_loss", "net_loss", "hold_split", "size_losers", "hold_losers", "bad_adds", "bag_hold", "fee", "decline", "small_loss", "launcher"]
    : ["net_loss", "heavy_loss", "hold_split", "fee", "size_losers", "hold_losers", "bad_adds", "bag_hold", "fast", "decline", "crowd", "small_loss", "launcher"];
  const firedList = order.filter((k) => fired[k]);
  const pick = firedList.find((k) => k !== used) ?? (firedList.length === 1 ? firedList[0] : undefined);
  const perTrade = m.trades ? m.realized / m.trades : 0;
  const cw = `${Math.round(c.cwS)}s`;
  const next = (() => {
    if (!pick) return self ? "Keep the current pace and keep an eye on how quickly you cut losses." : "No clear weak spot in this window.";
    const sp = split;
    switch (pick) {
      case "heavy_loss": return self ? "A hard stop that closes a coin before it is down 50% would cut the biggest losses." : "This wallet tends to ride losers down instead of cutting them.";
      case "net_loss": return self ? "Fewer trades, focused on the setups you know best, would help." : "This wallet is losing money in this window.";
      case "hold_split": return self
        ? `Your trades held ${sp!.B} return ${pctR(sp!.bRoi)}, while those held ${sp!.W} ${sp!.wRoi >= 0 ? `return only ${pctR(sp!.wRoi)}` : "lose money"}.`
        : `Its trades held ${sp!.B} return ${pctR(sp!.bRoi)}, while those held ${sp!.W} ${sp!.wRoi >= 0 ? `return only ${pctR(sp!.wRoi)}` : "lose money"}${fired.fast ? "; the fastest flips are too quick to follow" : ""}.`;
      case "fee": return self
        ? c.flash5 >= 0.2 ? `Fewer 5-second flips (${pctR(c.flash5)} of round trips) would keep more of the profit.` : "Fewer, larger trades would keep more of the profit away from fees."
        : `This wallet makes about ${money(perTrade)} per trade${fired.fast ? ` and closes in about ${cw}` : ""}, which delay and slippage would mostly eat for anyone following.`;
      case "fast": return `This wallet closes positions in about ${cw}, faster than anyone can follow by hand${fired.crowd ? `, and about ${m.follow.toLocaleString("en-US")} people follow this wallet` : ""}.`;
      case "size_losers": return self
        ? `Your losing trades are ${(sizeLosers!.l / sizeLosers!.w).toFixed(1)}× the size of your winners; starting smaller on less certain coins would help.`
        : `Its losing trades are sized bigger than its winners (median ${money(sizeLosers!.l)} vs ${money(sizeLosers!.w)}).`;
      case "hold_losers": return `${self ? "You hold" : "This wallet holds"} losers longer than winners (median ${holdTxt(holdLosers!.l)} vs ${holdTxt(holdLosers!.w)})${self ? "; cutting losses as fast as taking profits would help" : ""}.`;
      case "bad_adds": return `Coins ${he} added to returned ${pctR(badAdds!.added)}, against ${pctR(badAdds!.single)} for single entries${self ? "; adding to coins that are going the wrong way hurts" : ""}.`;
      case "bag_hold": return self ? `You still have ${plural(bagHold, "position")} down more than 50% to deal with.` : `This wallet is still holding ${plural(bagHold, "position")} down more than 50%.`;
      case "decline": return self ? "Your recent losing trades are worth a review: did the market change, or the approach?" : "Its returns have been weakening lately.";
      case "crowd": return `About ${m.follow.toLocaleString("en-US")} people follow this wallet, so prices often move before followers get in.`;
      case "small_loss": return self ? `Being pickier about entries would help (median entry market cap ${money(c.entryP50)}).` : "This wallet makes its money by cutting small losses quickly.";
      case "launcher": return self ? "Launching fewer coins would help how others see this wallet." : "This wallet launches many coins and few of them graduate.";
    }
  })();
  return `${recap} ${next}`;
}
