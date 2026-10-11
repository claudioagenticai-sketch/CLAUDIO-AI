// gmgn-contract-dd port (skills/gmgn-contract-dd/SKILL.md): contract safety (0.45) + holder structure (0.35) + price
// action (0.20) → one 0–100, capped by GMGN's own rug label. Every deduction names the field it read; an absent field is
// never a passing check (it only lowers coverage → confidence), with exactly the skill's three exceptions (missing EVM
// honeypot / open-source check → cap 79; fewer than 24 candles → −12 / −6). Tiers inside one field are mutually
// exclusive (worst matching row only); different fields add. All GMGN rates are fractions in [0, 1]; a rate above 1 is an
// anomaly and is treated as unavailable, never silently reinterpreted.
//
// rug_ratio is not on token info / security / pool — it only appears on trenches / trending rows, so the caller passes it
// (`rugRatio`) when it has one; absent means "unavailable", never a measured 0.
import type { Score } from "@shared/insights";
import { clamp, mean, nowSeconds, num, numOrNull, obj, pct, plural, r1, str, Tally, unwrap, usd, UNKNOWN_SCORE, type Candle, type Dict } from "./util";

const EVM_MEME = new Set(["bsc", "base", "eth", "robinhood", "arc", "stable"]); // unlocked LP => −12 and cap 79
const LP_SKIP = new Set(["arbitrum", "hyperevm"]); // unlocked is normal for their bluechips: row skipped

type SectionKey = "contract" | "holders" | "price";
interface Ded { label: string; points: number; field: string }
class Section {
  executed = 0;
  skipped = 0;
  heldOut = 0;
  deds: Ded[] = [];
  constructor(public key: SectionKey, public weight: number) {}
  pass() { this.executed += 1; }
  skip(n = 1) { this.skipped += n; }
  hold(n = 1) { this.heldOut += n; }
  ded(label: string, points: number, field: string) { this.executed += 1; this.deds.push({ label, points, field }); }
  get raw() { return 100 - this.deds.reduce((a, d) => a + d.points, 0); }
  get score() { return clamp(this.raw, 0, 100); }
  get hasData() { return this.executed > 0; }
}

/** A GMGN fraction; null when absent/blank or anomalous (> 1). */
function rate(v: unknown): number | null {
  const n = numOrNull(v);
  if (n === null || n < 0 || n > 1) return null;
  return n;
}
const isNullish = (v: unknown) => v === null || v === undefined || v === "";

export interface ContractDDInput {
  info: unknown; // GET /v1/token/info data
  security: unknown; // GET /v1/token/security data
  holders?: unknown; // (accepted for API symmetry; the DD reads holder structure from info.stat)
  candles?: Candle[]; // kline, any resolution (the skill scores 15m); undefined = price not checked
  pool?: unknown; // GET /v1/token/pool data (falls back to info.pool)
  chain?: string; // default "sol"
  rugRatio?: number | null; // GMGN rug_ratio from a trenches / trending row, 0–1
  now?: number;
}

export type ContractDDScore = Score & {
  sections: { contract: number; holders: number | null; price: number | null };
  confidence: "sufficient" | "low" | "insufficient";
};

export function contractDD(input: ContractDDInput): ContractDDScore {
  try {
    return contractDDUnsafe(input);
  } catch {
    return { ...UNKNOWN_SCORE, sections: { contract: 0, holders: null, price: null }, confidence: "insufficient" };
  }
}

function contractDDUnsafe(input: ContractDDInput): ContractDDScore {
  const info = obj(unwrap(input.info));
  const sec = obj(unwrap(input.security));
  const chain = (input.chain || "sol").toLowerCase();
  const sol = chain === "sol";
  const empty = (title: string, summary: string): ContractDDScore => ({
    ...UNKNOWN_SCORE, title, summary, sections: { contract: 0, holders: null, price: null }, confidence: "insufficient",
  });

  // Step 0 — only info.symbol decides existence (security.address and info.address are echoed for unknown addresses).
  if (!str(info.symbol).trim()) return empty("No record", "GMGN has no record of this token yet, so there is nothing to score.");

  const price = obj(info.price);
  const stat = obj(info.stat);
  const pool = Object.keys(obj(unwrap(input.pool))).length ? obj(unwrap(input.pool)) : obj(info.pool);
  const hasSecurity = Object.keys(sec).length > 0;
  const contract = new Section("contract", 0.45);
  const holders = new Section("holders", 0.35);
  const priceS = new Section("price", 0.2);
  const caps: { at: number; label: string; field: string }[] = [];
  const notes: { label: string; field: string }[] = [];
  let hardStop: string | null = null;

  // Step 1A — is the EVM security block populated? ("0" counts as empty for the three numeric fields.)
  const zeroish = (v: unknown) => isNullish(v) || str(v).trim() === "0";
  const evmPopulated = !(
    isNullish(sec.is_honeypot) && isNullish(sec.is_open_source) && isNullish(sec.is_blacklist) && isNullish(sec.is_renounced) &&
    zeroish(sec.top_10_holder_rate) && zeroish(sec.buy_tax) && zeroish(sec.sell_tax)
  );

  // Step 1B — is info.stat populated? Two tests, either fires => unpopulated (never decide by chain).
  const infoHolders = num(info.holder_count);
  const TEN = ["creator_hold_rate", "top_bundler_trader_percentage", "top70_sniper_hold_rate", "top_rat_trader_percentage", "top_entrapment_trader_percentage", "bot_degen_rate", "fresh_wallet_rate", "private_vault_hold_rate", "creator_created_count", "top_10_holder_rate"];
  const statPopulated = !((num(stat.holder_count) === 0 && infoHolders > 0) || TEN.every((k) => num(stat[k]) === 0));

  // ── Step 2 — chain mode ──
  if (sol) {
    if (!hasSecurity) contract.skip(2);
    else {
      // Real measurements on sol once the token exists (is_honeypot / is_open_source are null by design there).
      if (sec.renounced_mint !== true) contract.ded("Mint authority not renounced, so supply can be increased", 25, "security.renounced_mint");
      else contract.pass();
      if (sec.renounced_freeze_account !== true) contract.ded("Freeze authority not renounced, so wallets can be frozen", 20, "security.renounced_freeze_account");
      else contract.pass();
    }
  } else if (!hasSecurity || !evmPopulated) {
    contract.skip(4); // unpopulated EVM block: struct defaults, never read as measurements, never capped
  } else {
    if (sec.is_honeypot === true) {
      hardStop = "Flagged as a honeypot: buys go through but sells fail";
      contract.ded(hardStop, 0, "security.is_honeypot");
    } else if (isNullish(sec.is_honeypot)) {
      contract.skip();
      caps.push({ at: 79, label: "Honeypot check missing, so capped at 79", field: "security.is_honeypot" });
    } else contract.pass();
    if (sec.is_open_source === false) contract.ded("Contract source is not published", 15, "security.is_open_source");
    else if (isNullish(sec.is_open_source)) {
      contract.skip();
      caps.push({ at: 79, label: "Open-source check missing, so capped at 79", field: "security.is_open_source" });
    } else contract.pass();
    if (sec.is_renounced === false) contract.ded("Ownership not renounced", 8, "security.is_renounced");
    else if (isNullish(sec.is_renounced)) contract.skip();
    else contract.pass();
    if (sec.is_blacklist === true) contract.ded("Contract can blacklist wallets from trading", 20, "security.is_blacklist");
    else if (isNullish(sec.is_blacklist)) contract.skip();
    else contract.pass();
  }

  // ── Step 3 — contract safety ──
  // Taxes: "0" is a real 0% tax; "" is unavailable (and so is everything on an unpopulated EVM block).
  const bt = rate(sec.buy_tax);
  const st = rate(sec.sell_tax);
  if (!hasSecurity || (!sol && !evmPopulated) || (bt === null && st === null)) contract.skip();
  else {
    const tax = Math.max(bt ?? 0, st ?? 0);
    if (tax > 0.1) contract.ded(`Trading tax of ${pct(tax)}`, 25, "security.buy_tax/sell_tax");
    else if (tax > 0.05) contract.ded(`Trading tax of ${pct(tax)}`, 10, "security.buy_tax/sell_tax");
    else contract.pass();
  }
  // LP locked (and, on sol only, burned).
  const ls = sec.lock_summary;
  const locked = ls && typeof ls === "object" ? (ls as Dict).is_locked : undefined;
  if (LP_SKIP.has(chain) || isNullish(locked)) contract.skip();
  else if (sol) {
    const burn = str(sec.burn_status);
    if (locked === false || locked === 0) {
      if (!burn) contract.skip();
      else if (burn !== "burn") contract.ded("Liquidity is neither locked nor burned", 12, "security.lock_summary.is_locked");
      else contract.pass();
    } else contract.pass();
  } else if (EVM_MEME.has(chain) && (locked === false || locked === 0)) {
    contract.ded("Liquidity is not locked", 12, "security.lock_summary.is_locked");
    caps.push({ at: 79, label: "Unlocked liquidity, so capped at 79", field: "security.lock_summary.is_locked" });
  } else contract.pass();
  // Liquidity: take the non-zero of info / pool; a 0 in both is a dead pool only when 24h volume is also 0.
  const infoLiq = numOrNull(info.liquidity);
  const poolLiq = numOrNull(pool.liquidity);
  const liq = (infoLiq ?? 0) > 0 ? (infoLiq as number) : (poolLiq ?? 0);
  if (infoLiq === null && poolLiq === null) contract.skip();
  else if (liq <= 0) {
    if (num(price.volume_24h) === 0) contract.ded("Liquidity pool is empty", 15, "info.liquidity");
    else contract.skip();
  } else if (liq < 10_000) contract.ded(`Liquidity only ${usd(liq)}`, 15, "info.liquidity");
  else if (liq < 50_000) contract.ded(`Liquidity only ${usd(liq)}`, 6, "info.liquidity");
  else contract.pass();
  // Pool shrink: initial_liquidity 0 is normal on old pools (unavailable); growth is never a finding.
  const initLiq = num(pool.initial_liquidity);
  if (initLiq <= 0 || !(num(pool.liquidity) > 0 || liq > 0)) contract.skip();
  else {
    const ratio = (num(pool.liquidity) || liq) / initLiq;
    if (ratio < 0.5) contract.ded(`Pool shrank to ${pct(ratio, 0)} of its opening depth`, 10, "pool.liquidity/initial_liquidity");
    else contract.pass();
  }
  // creator_created_count lives in stat: held out with the stat block when it is unpopulated.
  if (!statPopulated) contract.hold();
  else {
    const n = num(stat.creator_created_count);
    const d = n >= 500 ? 18 : n >= 200 ? 14 : n >= 50 ? 10 : n >= 10 ? 6 : n >= 3 ? 3 : 0;
    if (d) contract.ded(`Creator has launched ${n.toLocaleString("en-US")} tokens`, d, "info.stat.creator_created_count");
    else contract.pass();
  }
  // Logo reuse: flat −6 (it cannot say who copied whom).
  const dup = numOrNull(info.image_dup_count);
  if (dup === null) contract.skip();
  else if (dup > 0) contract.ded(`Logo is shared with ${plural(dup, "other token")}`, 6, "info.image_dup_count");
  else contract.pass();
  // Candle count: a bounded deduction for unverifiability (dropping the price section would otherwise reward no history).
  const candles = Array.isArray(input.candles)
    ? input.candles.filter((c) => c && num(c.c) > 0 && num(c.h) > 0 && num(c.l) > 0).sort((a, b) => num(a.t) - num(b.t))
    : null;
  if (!candles) contract.skip();
  else if (candles.length < 8) contract.ded(`Only ${plural(candles.length, "candle")} of price history`, 12, "kline.list");
  else if (candles.length < 24) contract.ded(`Only ${candles.length} candles of price history`, 6, "kline.list");
  else contract.pass();

  // ── Step 4 — holder structure ──
  const secTop = rate(sec.top_10_holder_rate);
  const statTop = rate(stat.top_10_holder_rate);
  const top10 = (secTop ?? 0) > 0 ? secTop : (statTop ?? 0) > 0 ? statTop : null; // 0% top-10 does not exist
  if (top10 === null) holders.skip();
  else if (top10 > 0.5) holders.ded(`Top 10 wallets hold ${pct(top10)}`, 25, "security.top_10_holder_rate");
  else if (top10 > 0.3) holders.ded(`Top 10 wallets hold ${pct(top10)}`, 14, "security.top_10_holder_rate");
  else if (top10 > 0.2) holders.ded(`Top 10 wallets hold ${pct(top10)}`, 6, "security.top_10_holder_rate");
  else holders.pass();
  if (infoHolders <= 0) holders.skip(); // 0 is unpopulated, not "zero holders"
  else if (infoHolders < 200) holders.ded(`Only ${plural(infoHolders, "holder")}`, 12, "info.holder_count");
  else if (infoHolders < 500) holders.ded(`Only ${infoHolders} holders`, 5, "info.holder_count");
  else holders.pass();
  if (!statPopulated) {
    holders.hold(8);
    notes.push({ label: "GMGN has no wallet analysis for this token, so the holder read rests on concentration and holder count", field: "info.stat" });
  } else {
    // The top_*_percentage family are shares of GMGN's analysed-trader cohort — never of supply.
    const tiers: [string, number[], number[], (x: number) => string][] = [
      ["creator_hold_rate", [0.05, 0.02], [20, 10], (x) => `Creator still holds ${pct(x)}`],
      ["top_bundler_trader_percentage", [0.3, 0.15, 0.05], [20, 10, 4], (x) => `${pct(x)} of analysed traders are bundlers`],
      ["top70_sniper_hold_rate", [0.15, 0.05], [15, 6], (x) => `Early snipers hold ${pct(x)}`],
      ["top_rat_trader_percentage", [0.05, 0.01], [12, 5], (x) => `${pct(x)} of analysed traders are insider (rat) traders`],
      ["top_entrapment_trader_percentage", [0.5, 0.2, 0.05], [22, 16, 10], (x) => `${pct(x)} of analysed traders are flagged as trap wallets`],
      ["bot_degen_rate", [0.7, 0.5], [12, 6], (x) => `${pct(x)} of analysed traders are bots`],
      ["fresh_wallet_rate", [0.5], [8], (x) => `${pct(x)} of analysed traders are fresh wallets`],
      ["private_vault_hold_rate", [0.05], [8], (x) => `Private vaults hold ${pct(x)}`],
    ];
    for (const [k, th, ds, label] of tiers) {
      const x = rate(stat[k]);
      if (x === null) { holders.skip(); continue; }
      const i = th.findIndex((t) => x > t);
      if (i >= 0) holders.ded(label(x), ds[i], `info.stat.${k}`);
      else holders.pass();
    }
  }

  // ── Step 5 — price action (needs >= 8 candles; scored whole or not at all) ──
  if (!candles || candles.length < 8) priceS.skip(4);
  else {
    const W = candles.slice(-Math.min(96, candles.length));
    const C = W.map((c) => num(c.c));
    const O = W.map((c) => num(c.o));
    const H = W.map((c) => num(c.h));
    const V = W.map((c) => num(c.v));
    const maxH = H.reduce((a, b) => Math.max(a, b), 0);
    if (maxH <= 0) priceS.skip();
    else {
      const dd = 1 - C[C.length - 1] / maxH;
      const d = dd > 0.7 ? 30 : dd > 0.5 ? 18 : dd > 0.3 ? 8 : 0;
      if (d) priceS.ded(`Down ${pct(dd, 0)} from the recent high`, d, "kline.close/high");
      else priceS.pass();
    }
    const moves = W.map((_, i) => (O[i] > 0 ? (C[i] - O[i]) / O[i] : null)).filter((x): x is number => x !== null);
    if (!moves.length) priceS.skip();
    else {
      const worst = moves.reduce((a, b) => Math.min(a, b));
      if (worst < -0.5) priceS.ded(`One candle fell ${pct(-worst, 0)}`, 14, "kline.open/close");
      else if (worst < -0.3) priceS.ded(`One candle fell ${pct(-worst, 0)}`, 7, "kline.open/close");
      else priceS.pass();
    }
    const p = num(price.price);
    const p24 = num(price.price_24h); // the price 24h AGO, not a percent change
    if (p24 <= 0 || p <= 0) priceS.skip();
    else if (p / p24 < 0.5) priceS.ded(`Price fell ${pct(1 - p / p24, 0)} in 24h`, 10, "info.price.price_24h");
    else priceS.pass();
    const earlier = W.length >= 40 ? mean(V.slice(-40, -20)) : 0;
    if (W.length < 40 || earlier <= 0) priceS.skip();
    else {
      const vr = mean(V.slice(-20)) / earlier;
      if (vr < 0.2) priceS.ded(`Volume dried up to ${pct(vr, 0)} of the earlier window`, 18, "kline.volume");
      else priceS.pass();
    }
  }

  // ── Step 7 — tokenized-equity honeypot exemption (EVM only; opens only on evidence, never on silence) ──
  if (hardStop) {
    const sells = num(price.sells_24h);
    const sv = num(price.sell_volume_24h);
    const bv = num(price.buy_volume_24h);
    const priv = sec.privileges;
    const privEmpty = (Array.isArray(priv) && priv.length === 0) || (!!priv && typeof priv === "object" && !Array.isArray(priv) && Object.values(priv as Dict).every((x) => !x || (Array.isArray(x) && !x.length)));
    const noTax = bt === 0 && st === 0;
    if (sells > 500 && sv > 100_000 && bv > 0 && sv / bv >= 0.3 && sv / bv <= 3 && noTax && privEmpty) {
      caps.push({ at: 59, label: "Honeypot flag contradicted by real two-sided trading, so capped at 59 instead of 0", field: "security.is_honeypot" });
      hardStop = null;
    }
  }
  // ── Step 5B — GMGN's own rug label caps (never raises; 0 is not evidence of safety) ──
  const rug = typeof input.rugRatio === "number" && Number.isFinite(input.rugRatio) ? input.rugRatio : null;
  if (rug !== null && rug >= 0.5) caps.push({ at: 59, label: `GMGN rates the rug risk at ${pct(rug, 0)}, so capped at 59`, field: "rug_ratio" });
  else if (rug !== null && rug >= 0.3) caps.push({ at: 79, label: `GMGN rates the rug risk at ${pct(rug, 0)}, so capped at 79`, field: "rug_ratio" });
  if (/\[filtered\]/i.test(`${str(info.name)} ${str(info.symbol)}`)) notes.push({ label: "Token name contained text trying to steer automated readers", field: "info.name" });

  // ── Step 6 — combine ──
  const kept = [contract, holders, priceS].filter((s) => s.hasData);
  const wTot = kept.reduce((a, s) => a + s.weight, 0) || 1;
  const T = new Tally().start("Starts at 100", 100);
  for (const s of kept) {
    const w = s.weight / wTot;
    for (const d of s.deds) if (d.points) T.add(d.label, -d.points * w, d.field);
    if (s.raw < 0) T.add(`${s.key[0].toUpperCase()}${s.key.slice(1)} checks bottomed out at 0`, -s.raw * w);
  }
  if (hardStop) T.cap(0, `${hardStop}, so the score is 0`, "security.is_honeypot");
  const lowest = caps.sort((a, b) => a.at - b.at)[0];
  if (lowest) T.cap(lowest.at, lowest.label, lowest.field);
  T.clamp();
  for (const n of notes) T.note(n.label, n.field);
  if (rug === null) T.note("GMGN rug label not available for this token", "rug_ratio");

  const executed = contract.executed + holders.executed + priceS.executed;
  const skipped = contract.skipped + holders.skipped + priceS.skipped;
  const coverage = executed + skipped ? executed / (executed + skipped) : 0;
  const confidence: ContractDDScore["confidence"] = coverage >= 0.8 ? "sufficient" : coverage >= 0.5 ? "low" : "insufficient";

  const value = T.value;
  const sections = { contract: r1(contract.score), holders: holders.hasData ? r1(holders.score) : null, price: priceS.hasData ? r1(priceS.score) : null };
  const weak = kept.filter((s) => s.score < 60).map((s) => s.key);
  const clause =
    weak.length >= 2 ? "Problems on more than one side"
      : weak[0] === "holders" ? "Contract looks fine, but a few wallets control the supply"
        : weak[0] === "price" ? "Contract looks fine, but the price structure has broken"
          : weak[0] === "contract" ? "The problem is in the contract itself"
            : contract.score < 80 ? "No clear problem, but the contract side is thin"
              : "Nothing stands out on the contract, holders or price";
  const heaviest = kept.flatMap((s) => s.deds.map((d) => ({ ...d, w: d.points * (s.weight / wTot) }))).sort((a, b) => b.w - a.w)[0];
  const created = num(info.open_timestamp) || num(info.creation_timestamp);
  const ageH = created > 0 ? (nowSeconds(input.now) - created) / 3600 : null;
  const age = ageH === null || ageH < 0 ? "" : ageH < 48 ? ` Token is ${Math.max(1, Math.round(ageH))}h old.` : ` Token is ${Math.round(ageH / 24)} days old.`;
  const summary = `${clause}.${hardStop ? ` ${hardStop}.` : heaviest ? ` Biggest issue: ${heaviest.label.charAt(0).toLowerCase()}${heaviest.label.slice(1)}.` : ""}${age}${confidence === "insufficient" ? " Too little data to lean on this score." : ""}`;

  let grade: Score["grade"];
  let title: string;
  if (confidence === "insufficient") {
    grade = "unknown";
    title = "Too little data";
  } else if (value >= 80) {
    grade = "good";
    title = "No red flags found";
  } else if (value >= 60) {
    grade = "mixed";
    title = "Some concerns";
  } else if (value >= 40) {
    grade = "risky";
    title = "Serious concerns";
  } else {
    grade = "risky";
    title = hardStop ? "Can't sell" : "Major red flags";
  }
  return { value, grade, title, reasons: T.reasons, summary, sections, confidence };
}
