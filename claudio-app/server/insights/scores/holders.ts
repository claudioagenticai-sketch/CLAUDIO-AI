// gmgn-holder-analysis port (skills/gmgn-holder-analysis: analyze.py + SKILL.md "Rating Standard"). Reads the top-100
// holder list (GET /v1/token/holders data) plus token info, and reproduces the skill's rating exactly:
//   ⚪ Cannot Assess  tradeable float < 2% of supply, or no holders (dev sock-puppet still escalates to 🔴)
//   🔴 Not Recommended  any of: rat traders > 5% / largest wallet > 10% / dev chips routed to a top-100 wallet
//   ⚠️ Caution          ≥ 2 of: dev still holds > 1% / airdrop > 20% / risk wallets > 35% / linked > 15% / contract self-holds > 10%
//   🟡 Light            exactly 1 of those
//   ✅ Normal           none
// Every percentage is a share of the TRADEABLE FLOAT (1 − burn − DEX), not of total supply (burn / DEX / self-held are
// total-supply basis, because they define the float). The skill emits a rating, not a number; the 0–100 here is the
// rating band (Normal 80–100, Light 60–79, Caution 40–59, Not recommended 0–39) placed inside the band by the per-metric
// 🟡/🔴 flags of the same skill, so the grade can never disagree with the rating.
// Not ported: the buying-power section (needs a live native-token price) — it never fed the rating; only its zero-balance
// flag is used, from native_balance on chains with known decimals.
import type { TokenScores, WalletTag } from "@shared/insights";
import { arr, num, obj, pct, plural, str, Tally, unwrap, UNKNOWN_SCORE, type Dict } from "./util";

const WINDOW = 300; // same-window funding (s)
const TIGHT = 60; // scripted batch funding (s)
const FLOAT_MIN = 0.02;
const NATIVE_DENOM: Record<string, number> = { sol: 1e9, bsc: 1e18, eth: 1e18, base: 1e18 };

export interface HolderAnalysisInput {
  info: unknown; // GET /v1/token/info data
  holders: unknown; // GET /v1/token/holders data (top 100)
  devHolders?: unknown; // GET /v1/token/holders?tag=dev data, when available (falls back to info.dev)
  chain?: string;
}

type Breakdown = TokenScores["holders"]["breakdown"];

function list(v: unknown): Dict[] {
  const d = unwrap(v);
  return (Array.isArray(d) ? d : arr(obj(d).list)).map(obj);
}
const tagsOf = (h: Dict) => arr(h.tags).map(str);
const makerOf = (h: Dict) => arr(h.maker_token_tags).map(str);
const ap = (h: Dict) => num(h.amount_percentage);
const tr = (h: Dict, k: string) => obj(h.native_transfer)[k];
// "Zero cost" must be proven: a missing buy count is not an airdrop when a cost basis exists (avg_cost or a finite PnL ratio).
const hasCostBasis = (h: Dict) => num(h.avg_cost) > 0 || (h.unrealized_pnl !== null && h.unrealized_pnl !== undefined);

export function holderAnalysis(input: HolderAnalysisInput): TokenScores["holders"] {
  try {
    return holderAnalysisUnsafe(input);
  } catch {
    return { ...UNKNOWN_SCORE, breakdown: [] };
  }
}

function holderAnalysisUnsafe(input: HolderAnalysisInput): TokenScores["holders"] {
  const info = obj(unwrap(input.info));
  const chain = (input.chain || "sol").toLowerCase();
  const holders = list(input.holders);
  const SELF = str(info.address).toLowerCase();
  const isSelf = (h: Dict) => !!SELF && str(h.address).toLowerCase() === SELF;
  // The pool / bonding-curve vault is not a holder wallet either. Measured on the near-completion fixture: the curve
  // came back as addr_type 0 holding 100% of supply, its account_address equal to info.pool.base_vault_address — the
  // same per-token upstream classification gap as the self-held contract row, so it is reclassified as DEX (which then
  // makes the float degenerate → Cannot Assess, the skill's documented reading of a pre-migration launchpad coin).
  const ip = obj(info.pool);
  const poolIds = new Set([str(ip.pool_address), str(ip.base_vault_address), str(info.biggest_pool_address), str(info.migrated_pool)].filter(Boolean));
  const at = (h: Dict) => (poolIds.has(str(h.address)) || poolIds.has(str(h.account_address)) ? 2 : num(h.addr_type, 0));

  // The token's own contract address is not a holder wallet: reported on its own line (total-supply basis).
  const selfheld = holders.filter(isSelf);
  const normal = holders.filter((h) => at(h) === 0 && !isSelf(h)).sort((a, b) => ap(b) - ap(a));
  const burn = holders.filter((h) => at(h) === 1);
  const dex = holders.filter((h) => at(h) === 2);
  const burnPct = burn.reduce((a, h) => a + ap(h), 0);
  const dexPct = dex.reduce((a, h) => a + ap(h), 0);
  const floatRaw = 1 - burnPct - dexPct;
  const floatShare = Math.max(floatRaw, 1e-9);
  const selfPct = selfheld.reduce((a, h) => a + ap(h), 0);
  const floatDegenerate = floatRaw < FLOAT_MIN;
  const noHolders = normal.length === 0;
  const unassessable = floatDegenerate || noHolders;
  const fs = (ws: Iterable<Dict>) => { let s = 0; for (const h of ws) s += ap(h); return s / floatShare; };
  const f1 = (v: number) => v / floatShare;

  const top10 = fs(normal.slice(0, 10));
  const top20 = fs(normal.slice(0, 20));
  const noBuy = normal.filter((h) => num(h.buy_tx_count_cur) === 0 && num(h.balance) > 0);
  const airdrop = noBuy.filter((h) => !hasCostBasis(h));
  const bundlers = normal.filter((h) => makerOf(h).includes("bundler"));
  const rats = normal.filter((h) => makerOf(h).includes("rat_trader"));
  const snipers = normal.filter((h) => makerOf(h).includes("sniper"));
  const fresh = normal.filter((h) => tagsOf(h).includes("fresh_wallet"));
  const wash = normal.filter((h) => tagsOf(h).includes("wash_trader"));
  const riskAll = new Set([...rats, ...bundlers, ...snipers, ...fresh, ...wash].map((h) => str(h.address)));
  const riskPct = fs(normal.filter((h) => riskAll.has(str(h.address))));
  const airdropPct = fs(airdrop);
  const ratsPct = fs(rats);

  // ── related funds: a shared source only counts when coherent (funded within 6h, or amounts within 15%) and ≥ 3
  // wallets — a CEX hot wallet funding 30 strangers looks identical otherwise. Plus sliding-window same-time funding.
  const nonwallet = new Set([...burn, ...dex].map((h) => str(h.address)));
  const coherent = (ws: Dict[]) => {
    const ts = ws.map((w) => num(tr(w, "timestamp"))).filter((t) => t);
    const am = ws.map((w) => num(tr(w, "amount")));
    const tight = ts.length > 0 && Math.max(...ts) - Math.min(...ts) <= 6 * 3600;
    const m = am.length ? am.reduce((a, b) => a + b, 0) / am.length : 0;
    const uniform = m > 0 && (Math.max(...am) - Math.min(...am)) / m <= 0.15;
    return tight || uniform;
  };
  const fromMap = new Map<string, Dict[]>();
  for (const h of normal) {
    const fa = str(tr(h, "from_address"));
    if (fa && !nonwallet.has(fa)) fromMap.set(fa, [...(fromMap.get(fa) ?? []), h]);
  }
  const sameSrc = [...fromMap.values()].filter((ws) => ws.length >= 3 && coherent(ws));
  const funded = normal.filter((h) => num(tr(h, "timestamp"))).map((h) => [num(tr(h, "timestamp")), h] as const).sort((a, b) => a[0] - b[0]);
  const winGroups: Dict[][] = [];
  let cur: (readonly [number, Dict])[] = [];
  for (const p of funded) {
    if (cur.length && p[0] - cur[cur.length - 1][0] > WINDOW) {
      if (cur.length >= 2) winGroups.push(cur.map((x) => x[1]));
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length >= 2) winGroups.push(cur.map((x) => x[1]));
  const span = (v: Dict[]) => { const ts = v.map((h) => num(tr(h, "timestamp"))).filter((t) => t); return ts.length ? Math.max(...ts) - Math.min(...ts) : 0; };
  const tightGroups = winGroups.filter((v) => span(v) <= TIGHT);
  const related = new Set<string>();
  for (const ws of [...sameSrc, ...winGroups]) for (const h of ws) related.add(str(h.address));
  const relatedPct = fs(normal.filter((h) => related.has(str(h.address))));

  const smart = normal.filter((h) => tagsOf(h).some((t) => t === "smart_degen" || t === "pump_smart"));
  const kol = normal.filter((h) => tagsOf(h).some((t) => t === "kol" || t === "renowned"));
  const whales = normal.filter((h) => makerOf(h).includes("whale"));
  const diamond = normal.filter((h) => hasCostBasis(h) && num(h.sell_tx_count_cur) === 0 && num(h.balance) > 0);
  const diamondPct = fs(diamond);

  // ── dev: dual-source (tag=dev list, else token info dev.creator_address / creator_token_balance) ──
  const top100 = new Map(holders.filter((h) => !isSelf(h)).map((h) => [str(h.address), h]));
  const devRows = input.devHolders !== undefined ? list(input.devHolders) : holders.filter((h) => makerOf(h).some((t) => t === "creator" || t === "dev_team"));
  let creator = devRows.find((d) => makerOf(d).includes("creator"));
  let devHolding = devRows.filter((d) => num(d.balance) >= 1);
  let devHoldPct = f1(devHolding.reduce((a, d) => a + ap(d), 0));
  let sock: string | null = null;
  const dInfo = obj(info.dev);
  const creatorAddr = creator ? str(creator.address) : str(dInfo.creator_address);
  if (creator) {
    const to = str(obj(creator.token_transfer_out).address);
    if (to && top100.has(to) && to !== creatorAddr) sock = to;
  } else if (creatorAddr) {
    // Fallback judge: a top-100 holder whose gas came from the creator. A miss is not reported as clean.
    const row = top100.get(creatorAddr);
    if (row) creator = row;
    const bal = row ? num(row.balance) : num(dInfo.creator_token_balance);
    const supply = num(info.total_supply);
    if (bal >= 1) {
      devHolding = row ? [row] : [];
      devHoldPct = row ? f1(ap(row)) : supply > 0 ? f1(bal / supply) : 0;
    }
    const funder = normal.find((h) => str(tr(h, "from_address")) === creatorAddr && str(h.address) !== creatorAddr);
    if (funder) sock = str(funder.address);
  }

  const biggest = normal[0];
  const biggestPct = biggest ? f1(ap(biggest)) : 0;
  const dangers: { label: string; field: string }[] = [];
  if (!floatDegenerate) {
    if (rats.length && ratsPct > 0.05) dangers.push({ label: `Insider (rat) traders hold ${pct(ratsPct)} of the float`, field: "holders.maker_token_tags" });
    if (biggestPct > 0.1) dangers.push({ label: `Largest wallet holds ${pct(biggestPct)} of the float`, field: "holders.amount_percentage" });
  }
  if (sock) dangers.push({ label: "Dev moved coins to (or funded) another top-100 wallet", field: "holders.token_transfer_out" });

  const warns: { label: string; field: string }[] = [];
  if (!unassessable) {
    if (devHolding.length && devHoldPct > 0.01) warns.push({ label: `Dev still holds ${pct(devHoldPct, 2)} of the float`, field: "holders.balance" });
    if (selfPct > 0.1) warns.push({ label: `The token contract itself holds ${pct(selfPct)} of supply`, field: "holders.amount_percentage" });
    if (airdropPct > 0.2) warns.push({ label: `${pct(airdropPct)} of the float was transferred in, never bought`, field: "holders.buy_tx_count_cur" });
    if (riskPct > 0.35) warns.push({ label: `Risk-tagged wallets hold ${pct(riskPct)} of the float`, field: "holders.maker_token_tags" });
    if (relatedPct > 0.15) warns.push({ label: `${plural(related.size, "linked wallet")} hold ${pct(relatedPct)} of the float`, field: "holders.native_transfer" });
  }

  const rating = unassessable && !dangers.length ? "cannot" : dangers.length ? "not_recommended" : warns.length >= 2 ? "caution" : warns.length === 1 ? "light" : "normal";

  // ── breakdown (float basis unless "of supply") ──
  const bd: Breakdown = [];
  const row = (label: string, ws: Dict[], tag?: WalletTag) => { if (ws.length) bd.push({ label: `${label} (${ws.length})`, pct: fs(ws), ...(tag ? { tag } : {}) }); };
  if (!unassessable) {
    bd.push({ label: "Top 10 wallets", pct: top10, tag: "top10" });
    row("Insider (rat) traders", rats, "rat");
    row("Bundlers", bundlers, "bundler");
    row("Snipers", snipers, "sniper");
    row("Fresh wallets", fresh, "fresh");
    row("Wash traders", wash, "wash");
    row("Smart money", smart, "smart");
    row("KOLs", kol, "kol");
    row("Whales", whales, "whale");
    if (devHolding.length && devHoldPct > 0) bd.push({ label: "Dev", pct: devHoldPct, tag: "dev" });
    if (related.size) bd.push({ label: `Linked wallets (${related.size})`, pct: relatedPct });
    if (airdrop.length) bd.push({ label: `Transferred in, never bought (${airdrop.length})`, pct: airdropPct });
    if (diamond.length) bd.push({ label: `Never sold (${diamond.length})`, pct: diamondPct });
  }
  if (burnPct > 0) bd.push({ label: "Burned (of supply)", pct: burnPct });
  if (dexPct > 0) bd.push({ label: "Liquidity pool (of supply)", pct: dexPct, tag: "pool" });
  if (selfPct > 0) bd.push({ label: "Token contract (of supply)", pct: selfPct });

  if (rating === "cannot") {
    const why = noHolders ? "GMGN returned no holder wallets, so the holder structure can't be read." : `Only ${pct(Math.max(0, floatRaw), 2)} of supply is tradeable (pool ${pct(dexPct)}, burned ${pct(burnPct)}), usually a launchpad coin before migration, so holder shares would be noise.`;
    return { ...UNKNOWN_SCORE, title: "Can't assess holders", summary: why, breakdown: bd };
  }

  // ── score: the rating band, positioned by the skill's own per-metric 🟡/🔴 flags ──
  const T = new Tally().start("Starts at 100", 100);
  for (const d of dangers) T.add(d.label, -30, d.field);
  for (const w of warns) T.add(w.label, -20, w.field);
  if (!unassessable) {
    const flag = (x: number, red: number, yellow: number, label: string, field: string, skip = false) => {
      if (skip) return;
      if (red > 0 && x > red) T.add(label, -10, field);
      else if (x > yellow) T.add(label, -5, field);
    };
    flag(top10, 0.6, 0.4, `Top 10 wallets hold ${pct(top10)} of the float`, "holders.amount_percentage");
    flag(top20, 0.75, 0.55, `Top 20 wallets hold ${pct(top20)} of the float`, "holders.amount_percentage");
    flag(airdropPct, 0.25, 0.1, `${pct(airdropPct)} of the float was transferred in, never bought`, "holders.buy_tx_count_cur", airdropPct > 0.2);
    flag(riskPct, 0, 0.15, `Risk-tagged wallets hold ${pct(riskPct)} of the float`, "holders.maker_token_tags", riskPct > 0.35);
    flag(relatedPct, 0.25, 0.1, `Linked wallets hold ${pct(relatedPct)} of the float`, "holders.native_transfer", relatedPct > 0.15);
    // Scripted batch funding (within 60 s) escalates to at least 🟡 regardless of size.
    if (tightGroups.length && !(relatedPct > 0.1)) T.add(`${plural(tightGroups.reduce((a, v) => a + v.length, 0), "wallet")} were funded within the same minute`, -5, "holders.native_transfer");
    const denom = NATIVE_DENOM[chain];
    if (denom) {
      const zero = normal.filter((h) => num(h.native_balance) / denom <= 0);
      const zp = fs(zero);
      if (zp > 0.1) T.add(`Wallets with no gas left hold ${pct(zp)} of the float`, -5, "holders.native_balance");
    }
  }
  const band = rating === "not_recommended" ? [0, 39] : rating === "caution" ? [40, 59] : rating === "light" ? [60, 79] : [80, 100];
  T.cap(band[1], "Kept inside the rating band").floor(band[0], "Kept inside the rating band");
  if (burnPct > 0.05) T.note(`${pct(burnPct)} of supply is burned`, "holders.addr_type");
  if (smart.length) T.note(`${plural(smart.length, "smart-money wallet")} hold ${pct(fs(smart), 2)} of the float`, "holders.tags");
  if (kol.length) T.note(`${plural(kol.length, "KOL")} in the top 100`, "holders.tags");
  const buyingWhales = whales.filter((h) => num(h.buy_tx_count_cur) > 0 && num(h.sell_tx_count_cur) === 0);
  if (buyingWhales.length) T.note(`${plural(buyingWhales.length, "whale")} still buying, none selling`, "holders.maker_token_tags");
  if (diamondPct > 0.5) T.note(`Wallets that never sold hold ${pct(diamondPct)} of the float`, "holders.sell_tx_count_cur");

  const titles = { normal: "Healthy holders", light: "One holder concern", caution: "Several holder concerns", not_recommended: "Holder red flags" } as const;
  const grade = rating === "normal" ? "good" : rating === "not_recommended" ? "risky" : "mixed";
  const first = (dangers[0] ?? warns[0])?.label;
  const summary = first
    ? `${first}${dangers.length + warns.length > 1 ? `, plus ${plural(dangers.length + warns.length - 1, "more issue")}` : ""}.`
    : `No holder red flags: top 10 hold ${pct(top10)} of the float${smart.length ? ` and ${plural(smart.length, "smart-money wallet")} are in` : ""}.`;
  return { value: T.value, grade, title: titles[rating], reasons: T.reasons, summary, breakdown: bd };
}
