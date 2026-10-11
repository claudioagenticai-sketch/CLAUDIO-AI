// GMGN raw responses (the `data` of each envelope) → our shapes: TokenInsights parts, HolderRow / TraderRow with wallet
// tags, FeedTrade, FeedSignal, and board TokenSnapshots (+ the store overlay) from trenches / rank / hot / search items.
// Pure and defensive: unknown fields / tags are ignored, nothing throws.
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import type {
  DevSummary, FeedSignal, FeedTrade, HolderRow, SignalKind, TokenSecurity, TokenSignal, TokenStats, WalletIdentity, WalletProfile,
  WalletTag, WalletTool,
} from "@shared/insights";
import type { Candle as StoreCandle, Socials, TokenPhase, TokenSnapshot } from "@shared/types";
import type { Candle as ScoreCandle } from "./scores";
import type { ExternalEnrichment } from "../store";
import { blankToken } from "../store";

// ─── parsing helpers ────────────────────────────────────────────────

type Raw = Record<string, unknown>;

export function obj(v: unknown): Raw {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
}
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
/** Number from number / numeric string; null when absent or not finite. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function n0(v: unknown): number {
  return num(v) ?? 0;
}
export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true" || v === "yes";
}
function boolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  return truthy(v);
}
/** Unix seconds (or ms) → ms; null for 0 / absent. */
function ms(v: unknown): number | null {
  const n = num(v);
  if (!n || n <= 0) return null;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}
/** 0–1 rate → 0–100 percent (board units). */
function pct100(v: unknown): number | undefined {
  const n = num(v);
  return n === null ? undefined : Math.max(0, Math.min(100, n * 100));
}
function rate01(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.max(0, Math.min(1, n));
}
/** Sanity cap: GMGN occasionally reports absurd ATHs (1e15). */
function saneUsd(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 && n < 1e12 ? n : null;
}

// ─── wallet tags ────────────────────────────────────────────────────

/** GMGN `tags` (wallet-level) → WalletTag. Every value seen in the recorded fixtures is listed; others are ignored. */
export const GMGN_TAG_MAP: Record<string, WalletTag> = {
  fresh_wallet: "fresh",
  wash_trader: "wash",
  sniper: "sniper",
  kol: "kol",
  renowned: "kol",
  top_followed: "kol",
  smart_degen: "smart",
  smart: "smart",
  smart_money: "smart",
  launchpad_smart: "smart",
  app_smart_money: "smart",
  rat_trader: "rat",
  bundler: "bundler",
  insider: "insider",
  dev: "dev",
  creator: "dev",
  dev_team: "dev",
  bot: "bot",
  bot_degen: "bot",
  arbitrager: "bot",
  sandwich_bot: "bot",
  whale: "whale",
};

/** GMGN `maker_token_tags` (this wallet on this coin). `top_holder` → top10 only when rank ≤ 10. */
export const GMGN_MAKER_TAG_MAP: Record<string, WalletTag> = {
  bundler: "bundler",
  sniper: "sniper",
  insider: "insider",
  dev_team: "dev",
  creator: "dev",
  rat_trader: "rat",
  fresh_wallet: "fresh",
  whale: "whale",
  // top_holder → "top10" (rank ≤ 10, handled below); paper_hands / diamond_hands / transfer_in → no icon
};

/** Trading terminals / bots → tool chips. `fomo` is the Fomo app; `gmgn_go` is GMGN's own app. */
export const GMGN_TOOL_MAP: Record<string, WalletTool> = {
  axiom: "axiom",
  gmgn: "gmgn",
  gmgn_go: "gmgn",
  photon: "photon",
  bullx: "bullx",
  trojan: "trojan",
  padre: "padre",
  maestro: "maestro",
  bonkbot: "bonkbot",
  fomo: "other",
  bloom: "other",
  banana: "other",
  pepeboost: "other",
  sol_trading_bot: "other",
  nova: "other",
};

const POOL_NAME = /\b(vault|pool|bonding curve|amm|liquidity|lp)\b/i;

export interface TagContext {
  /** 1-based rank in the holder list. */
  rank?: number;
  /** Share of supply 0–1. */
  pct?: number;
  usdValue?: number | null;
  /** Known pool / curve addresses of the coin. */
  pools?: Set<string>;
  creator?: string | null;
}

export function walletTagsOf(raw: Raw, ctx: TagContext = {}): { tags: WalletTag[]; tools: WalletTool[] } {
  const tags = new Set<WalletTag>();
  const tools = new Set<WalletTool>();
  for (const t of arr(raw.tags)) {
    if (typeof t !== "string") continue;
    const k = t.toLowerCase();
    if (GMGN_TAG_MAP[k]) tags.add(GMGN_TAG_MAP[k]);
    else if (GMGN_TOOL_MAP[k]) tools.add(GMGN_TOOL_MAP[k]);
  }
  for (const t of arr(raw.maker_token_tags)) {
    if (typeof t !== "string") continue;
    const k = t.toLowerCase();
    if (k === "top_holder") {
      if (ctx.rank !== undefined && ctx.rank <= 10) tags.add("top10");
    } else if (GMGN_MAKER_TAG_MAP[k]) tags.add(GMGN_MAKER_TAG_MAP[k]);
  }
  const address = str(raw.address) ?? "";
  const exchange = str(raw.exchange);
  const addrType = num(raw.addr_type);
  const name = str(raw.name);
  const isPool = addrType === 2 || (!!address && !!ctx.pools?.has(address)) || (!!name && POOL_NAME.test(name) && !str(raw.twitter_username));
  if (isPool) tags.add("pool");
  else if (exchange) tags.add("exchange");
  if (truthy(raw.is_suspicious)) tags.add("suspicious");
  if (ctx.creator && address && address === ctx.creator) tags.add("dev");
  if (!isPool && !tags.has("exchange")) {
    const pct = ctx.pct ?? 0;
    if (pct >= 0.01 || (ctx.usdValue ?? 0) >= 50_000) tags.add("whale");
  } else {
    tags.delete("whale");
    tags.delete("top10");
  }
  return { tags: [...tags], tools: [...tools] };
}

function identity(raw: Raw, address: string, ctx: TagContext, info?: Raw): WalletIdentity {
  const { tags, tools } = walletTagsOf({ ...raw, address }, ctx);
  const i = info ?? raw;
  return {
    address,
    name: str(i.twitter_name) ?? str(i.name) ?? null,
    twitter: str(i.twitter_username),
    avatar: str(i.avatar),
    tags,
    tools,
  };
}

// ─── holders / traders ──────────────────────────────────────────────

export function holderRows(data: unknown, ctx: { pools?: Set<string>; creator?: string | null } = {}): HolderRow[] {
  const list = arr(obj(data).list ?? data);
  const out: HolderRow[] = [];
  list.forEach((r0, i) => {
    const r = obj(r0);
    const address = str(r.address);
    if (!address) return;
    const tagRank = /^TOP(\d+)$/i.exec(str(r.wallet_tag_v2) ?? "");
    const rank = tagRank ? Number(tagRank[1]) : i + 1;
    const pct = rate01(r.amount_percentage) ?? 0;
    const usdValue = num(r.usd_value);
    const id = identity(r, address, { rank, pct, usdValue, pools: ctx.pools, creator: ctx.creator });
    const nt = obj(r.native_transfer);
    out.push({
      ...id,
      rank,
      pct,
      amount: n0(r.amount_cur ?? r.balance),
      usdValue,
      avgCostUsd: num(r.avg_cost),
      realizedPnlUsd: num(r.realized_profit),
      unrealizedPnlUsd: num(r.unrealized_profit),
      pnlRatio: num(r.profit_change),
      buys: num(r.buy_tx_count_cur),
      sells: num(r.sell_tx_count_cur),
      firstSeenAt: ms(r.start_holding_at),
      lastActiveAt: ms(r.last_active_timestamp),
      fundedBy: str(nt.from_address),
    });
  });
  return out;
}

// ─── token info / security / pool ───────────────────────────────────

const WINDOWS = ["1m", "5m", "1h", "6h", "24h"] as const;

export function tokenStatsFromInfo(info: unknown, opts: { nativeUsd?: number } = {}): TokenStats {
  const d = obj(info);
  const p = obj(d.price);
  const stat = obj(d.stat);
  const wts = obj(d.wallet_tags_stat);
  const price = num(p.price);
  const supply = num(d.circulating_supply) ?? num(d.total_supply);
  const windows: TokenStats["windows"] = {};
  for (const w of WINDOWS) {
    if (p[`swaps_${w}`] === undefined && p[`volume_${w}`] === undefined) continue;
    const before = num(p[`price_${w}`]);
    windows[w] = {
      buys: n0(p[`buys_${w}`]),
      sells: n0(p[`sells_${w}`]),
      volumeUsd: n0(p[`volume_${w}`]),
      buyVolumeUsd: n0(p[`buy_volume_${w}`]),
      sellVolumeUsd: n0(p[`sell_volume_${w}`]),
      swaps: n0(p[`swaps_${w}`]),
      priceChangePct: price && before && before > 0 ? (price / before - 1) * 100 : null,
    };
  }
  const migratedTs = ms(d.migrated_timestamp);
  const fee = num(d.total_fee);
  const counts: NonNullable<TokenStats["counts"]> = {};
  const cmap: [keyof NonNullable<TokenStats["counts"]>, string][] = [
    ["smart", "smart_wallets"], ["kol", "renowned_wallets"], ["fresh", "fresh_wallets"], ["sniper", "sniper_wallets"],
    ["bundler", "bundler_wallets"], ["rat", "rat_trader_wallets"], ["whale", "whale_wallets"], ["creator", "creator_wallets"], ["top", "top_wallets"],
  ];
  for (const [k, f] of cmap) {
    const v = num(wts[f]);
    if (v !== null) counts[k] = v;
  }
  const progress = num(d.launchpad_progress);
  return {
    priceUsd: price,
    mcapUsd: price !== null && supply ? price * supply : null,
    liquidityUsd: num(d.liquidity),
    athPriceUsd: num(d.ath_price),
    holders: num(d.holder_count) ?? num(stat.holder_count),
    windows,
    top10Pct: rate01(stat.top_10_holder_rate ?? obj(d.dev).top_10_holder_rate),
    snipersPct: rate01(stat.top70_sniper_hold_rate),
    bundlersPct: rate01(stat.top_bundler_trader_percentage),
    insidersPct: rate01(stat.suspected_insider_hold_rate),
    freshPct: rate01(stat.fresh_wallet_rate),
    botPct: rate01(stat.bot_degen_rate ?? stat.top_bot_degen_percentage),
    ratPct: rate01(stat.top_rat_trader_percentage),
    devHoldPct: rate01(Math.max(n0(stat.dev_team_hold_rate), n0(stat.creator_hold_rate))),
    counts,
    bondingPct: progress === null ? null : Math.max(0, Math.min(100, progress * 100)),
    launchpad: str(d.launchpad_platform) ?? str(d.launchpad),
    migrated: !!migratedTs || !!str(d.migrated_pool) || num(d.launchpad_status) === 1,
    createdAt: ms(d.creation_timestamp) ?? ms(d.open_timestamp),
    migratedAt: migratedTs,
    // GMGN reports fees in the native coin.
    totalFeesUsd: fee !== null && fee > 0 && opts.nativeUsd ? fee * opts.nativeUsd : null,
  };
}

export function securityFrom(sec: unknown, info?: unknown): TokenSecurity {
  const s = obj(sec);
  const lock = obj(s.lock_summary);
  const honeypot = s.is_honeypot === null || s.is_honeypot === undefined ? (s.honeypot === undefined ? null : truthy(s.honeypot)) : truthy(s.is_honeypot);
  const blacklist = s.is_blacklist === null || s.is_blacklist === undefined ? (s.blacklist === undefined ? null : truthy(s.blacklist)) : truthy(s.is_blacklist);
  const buyTax = num(s.buy_tax);
  const sellTax = num(s.sell_tax);
  const top10 = rate01(s.top_10_holder_rate ?? obj(obj(info).stat).top_10_holder_rate);
  const burn = rate01(s.burn_ratio);
  const sec2: TokenSecurity = {
    mintRenounced: boolOrNull(s.renounced_mint),
    freezeRenounced: boolOrNull(s.renounced_freeze_account),
    honeypot,
    buyTaxPct: buyTax === null ? null : buyTax * 100,
    sellTaxPct: sellTax === null ? null : sellTax * 100,
    top10Pct: top10,
    burnRatio: burn,
    burnStatus: str(s.burn_status),
    lpLocked: lock.is_locked === undefined ? null : truthy(lock.is_locked),
    blacklist,
    warnings: [],
  };
  const w = sec2.warnings;
  if (sec2.mintRenounced === false) w.push("Mint authority not renounced — more supply can be minted");
  if (sec2.freezeRenounced === false) w.push("Freeze authority not renounced — wallets can be frozen");
  if (honeypot) w.push("Honeypot suspected — sells may fail");
  if (blacklist) w.push("Contract can blacklist wallets");
  if ((sec2.buyTaxPct ?? 0) >= 1) w.push(`Buy tax ${fmtPct(sec2.buyTaxPct!)}`);
  if ((sec2.sellTaxPct ?? 0) >= 1) w.push(`Sell tax ${fmtPct(sec2.sellTaxPct!)}`);
  if (top10 !== null && top10 >= 0.3) w.push(`Top 10 hold ${Math.round(top10 * 100)}%`);
  if (sec2.lpLocked === false && (burn ?? 0) < 0.5) w.push("Liquidity not locked or burnt");
  if (truthy(s.can_not_sell)) w.push("GMGN: selling may be blocked");
  for (const f of arr(s.flags)) if (typeof f === "string" && f) w.push(f.replace(/_/g, " "));
  return sec2;
}

function fmtPct(v: number): string {
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}%`;
}

export function poolFrom(pool: unknown): { address: string; exchange?: string | null; liquidityUsd?: number | null; quoteSymbol?: string | null; createdAt?: number | null } | null {
  const p = obj(pool);
  const address = str(p.pool_address) ?? str(p.address);
  if (!address) return null;
  return { address, exchange: str(p.exchange), liquidityUsd: num(p.liquidity), quoteSymbol: str(p.quote_symbol), createdAt: ms(p.creation_timestamp) };
}

/** creator_token_status → DevSummary.status. */
export function devStatusOf(v: unknown): DevSummary["status"] {
  const s = str(v)?.toLowerCase() ?? "";
  if (!s) return "unknown";
  if (s.includes("hold") || s.includes("add")) return "holding";
  if (s.includes("close")) return "closed";
  if (s.includes("sell") || s.includes("reduce") || s.includes("remove")) return "sold";
  return "unknown";
}

/** Dev summary from token info (+ the coin's trenches item, + the dev's created_tokens when known). */
export function devSummaryFrom(info: unknown, trench?: unknown, created?: unknown): DevSummary | null {
  const d = obj(info);
  const dev = obj(d.dev);
  const stat = obj(d.stat);
  const t = obj(trench);
  const c = obj(created);
  const address = str(dev.creator_address) ?? str(t.creator) ?? str(obj(c.creator_ath_info).creator);
  if (!address) return null;
  let launches = 0;
  let migrated = 0;
  if (created !== undefined && (c.inner_count !== undefined || c.open_count !== undefined)) {
    migrated = n0(c.open_count);
    launches = n0(c.inner_count) + migrated;
  } else if (t.creator_created_count !== undefined) {
    launches = n0(t.creator_created_count);
    migrated = n0(t.creator_created_open_count);
  } else {
    launches = n0(stat.creator_created_count);
    migrated = n0(dev.creator_open_count);
  }
  const ratio = launches > 0 ? Math.min(1, migrated / launches) : 0;
  const holds = rate01(stat.creator_hold_rate ?? t.creator_balance_rate);
  return {
    address,
    launches,
    migrated,
    migratedRatio: Math.round(ratio * 10_000) / 10_000,
    bestMcapUsd: saneUsd(obj(c.creator_ath_info).ath_mc) ?? saneUsd(obj(dev.ath_token_info).ath_mc),
    holdsPct: holds,
    status: devStatusOf(dev.creator_token_status ?? t.creator_token_status),
    fundedBy: str(dev.fund_from) ?? str(t.fund_from_address) ?? str(t.fund_from),
    rugRatio: rate01(t.rug_ratio),
  };
}

export function devCoinsFrom(created: unknown): { address: string; symbol?: string | null; name?: string | null; athMcapUsd?: number | null; migrated: boolean; createdAt?: number | null }[] {
  return arr(obj(created).tokens)
    .map((x) => {
      const r = obj(x);
      const address = str(r.token_address) ?? str(r.address);
      if (!address) return null;
      return {
        address,
        symbol: str(r.symbol),
        name: str(r.name),
        athMcapUsd: saneUsd(r.token_ath_mc) ?? saneUsd(r.market_cap),
        migrated: truthy(r.is_open),
        createdAt: ms(r.create_timestamp),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

// ─── signals ────────────────────────────────────────────────────────

/** GMGN signal_type 1–21 → our kind + label. */
export const SIGNAL_TYPES: Record<number, { kind: SignalKind; label: string }> = {
  1: { kind: "price_spike", label: "Price spike" },
  2: { kind: "dex_ad", label: "DexScreener ad" },
  3: { kind: "dex_link", label: "DexScreener socials updated" },
  4: { kind: "dex_trending", label: "DexScreener trending bar" },
  5: { kind: "dex_boost", label: "DexScreener boost" },
  6: { kind: "price_spike", label: "Price pumping" },
  7: { kind: "ath", label: "New all-time high" },
  8: { kind: "mcap_level", label: "Market cap milestone" },
  9: { kind: "live", label: "Live stream" },
  10: { kind: "bundler_sell", label: "Bundlers selling" },
  11: { kind: "cto", label: "Community takeover" },
  12: { kind: "smart_buy", label: "Smart money bought" },
  13: { kind: "platform_call", label: "Platform call" },
  14: { kind: "other", label: "Large buy" },
  15: { kind: "other", label: "Multiple buys" },
  16: { kind: "other", label: "Multiple large buys" },
  17: { kind: "bags_claim", label: "Bags fees claimed" },
  18: { kind: "pump_claim", label: "Pump fees claimed" },
  19: { kind: "platform_call", label: "Platform call" },
  20: { kind: "kol_buy", label: "KOL bought" },
  21: { kind: "other", label: "Banker fees claimed" },
};

function usdShort(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function signalFrom(raw: unknown, chain: ChainId = "sol"): FeedSignal | null {
  const r = obj(raw);
  const d = obj(r.data);
  const address = str(r.token_address) ?? str(d.address);
  const type = num(r.signal_type);
  if (!address || type === null) return null;
  const def = SIGNAL_TYPES[type] ?? { kind: "other" as SignalKind, label: `Signal ${type}` };
  const mc = num(r.trigger_mc) ?? num(r.market_cap);
  const times = num(r.signal_times);
  const detailParts: string[] = [];
  if (mc && mc > 0) detailParts.push(`at ${usdShort(mc)} mcap`);
  if (times && times > 1) detailParts.push(`${times}× today`);
  return {
    kind: def.kind,
    label: def.label,
    at: ms(r.trigger_at) ?? Date.now(),
    mcapUsd: mc,
    detail: detailParts.join(" · ") || null,
    tokenKey: `${chain}:${address}`,
    symbol: str(d.symbol),
    name: str(d.name),
    image: str(d.logo),
  };
}

export function signalsFrom(data: unknown, chain: ChainId = "sol"): FeedSignal[] {
  const list = Array.isArray(data) ? data : arr(obj(data).list);
  return list.map((x) => signalFrom(x, chain)).filter((x): x is FeedSignal => !!x).sort((a, b) => b.at - a.at);
}

export function tokenSignalsFor(feed: FeedSignal[], key: string): TokenSignal[] {
  return feed.filter((s) => s.tokenKey === key).map(({ kind, label, at, mcapUsd, detail }) => ({ kind, label, at, mcapUsd, detail }));
}

// ─── feeds (KOL / smart money trades) ───────────────────────────────

export function feedTradesFrom(data: unknown, chain: ChainId = "sol"): FeedTrade[] {
  const out: FeedTrade[] = [];
  for (const x of arr(obj(data).list ?? data)) {
    const r = obj(x);
    const maker = str(r.maker);
    const token = str(r.base_address);
    const side = str(r.side);
    if (!maker || !token || (side !== "buy" && side !== "sell")) continue;
    const info = obj(r.maker_info);
    const bt = obj(r.base_token);
    const { tags, tools } = walletTagsOf({ tags: info.tags, address: maker });
    out.push({
      wallet: { address: maker, name: str(info.twitter_name) ?? str(info.name), twitter: str(info.twitter_username), avatar: str(info.avatar), tags, tools },
      tokenKey: `${chain}:${token}`,
      symbol: str(bt.symbol),
      name: str(bt.name),
      image: str(bt.logo),
      side,
      amountUsd: n0(r.amount_usd),
      priceUsd: num(r.price_usd),
      tx: str(r.transaction_hash),
      at: ms(r.timestamp) ?? Date.now(),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

// ─── wallet ─────────────────────────────────────────────────────────

export function walletProfileFrom(stats: unknown, chain: ChainId, address: string): WalletProfile {
  const s = obj(stats);
  const common = obj(s.common);
  const pnl = obj(s.pnl_stat);
  const { tags, tools } = walletTagsOf({ tags: common.tags, address });
  return {
    address,
    chain,
    name: str(common.twitter_name) ?? str(common.name) ?? str(common.nick_name),
    twitter: str(common.twitter_username),
    avatar: str(common.avatar),
    tags,
    tools,
    nativeBalance: num(s.native_balance),
    realizedPnlUsd: num(s.realized_profit),
    unrealizedPnlUsd: num(s.unrealized_profit),
    winRate: rate01(pnl.winrate),
    buys7d: num(s.buy),
    sells7d: num(s.sell),
    tokensTraded: num(pnl.token_num),
    createdTokens: num(common.created_token_count),
    xFollowers: num(common.twitter_fans_num) ?? num(common.followers_count),
  };
}

/** A wallet's recent buys / sells (wallet_activity) as feed rows, newest first. Transfers etc. are skipped. */
export function walletRecentFrom(activity: unknown, chain: ChainId, wallet: WalletIdentity): FeedTrade[] {
  const out: FeedTrade[] = [];
  for (const x of arr(obj(activity).activities ?? activity)) {
    const r = obj(x);
    const side = str(r.event_type);
    const tok = obj(r.token);
    const address = str(tok.address);
    if (!address || (side !== "buy" && side !== "sell")) continue;
    out.push({
      wallet,
      tokenKey: `${chain}:${address}`,
      symbol: str(tok.symbol),
      name: str(tok.name),
      image: str(tok.logo),
      side,
      amountUsd: n0(r.cost_usd),
      priceUsd: num(r.price_usd),
      tx: str(r.tx_hash),
      at: ms(r.timestamp) ?? Date.now(),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

// ─── candles ────────────────────────────────────────────────────────

/** GMGN kline → score candles (t in ms), oldest first. */
export function candlesFrom(data: unknown): ScoreCandle[] {
  return arr(obj(data).list ?? data)
    .map((x) => {
      const r = obj(x);
      const t = num(r.time);
      const o = num(r.open);
      const c = num(r.close);
      if (t === null || !o || !c) return null;
      const h = num(r.high) ?? Math.max(o, c);
      const l = num(r.low) ?? Math.min(o, c);
      return { t: t < 1e12 ? t * 1000 : t, o, h, l, c, v: n0(r.volume) };
    })
    .filter((x): x is ScoreCandle => !!x)
    .sort((a, b) => a.t - b.t);
}

export function storeCandles(c: ScoreCandle[]): StoreCandle[] {
  return c.map((x) => ({ t: Math.floor(x.t / 1000), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
}

export const KLINE_RES: Record<number, { res: string; sec: number }> = {
  15: { res: "1m", sec: 60 },
  60: { res: "1m", sec: 60 },
  300: { res: "5m", sec: 300 },
  900: { res: "15m", sec: 900 },
  3600: { res: "1h", sec: 3600 },
};

// ─── board snapshots ────────────────────────────────────────────────

const QUOTES: Record<string, { symbol: string; usd?: number }> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL" },
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: { symbol: "USD1", usd: 1 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", usd: 1 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", usd: 1 },
};

/** GMGN launchpad / platform → our launchpad id. `known` false means a fallback for page rendering only. */
export function launchpadOf(chain: ChainId, launchpad: unknown, platform: unknown, migrated: boolean): { id: LaunchpadId; known: boolean; label: string | null } {
  const lp = (str(launchpad) ?? "").toLowerCase();
  const pf = (str(platform) ?? "").toLowerCase();
  const label = str(platform) ?? str(launchpad);
  const any = (...names: string[]) => names.some((n) => lp === n || pf === n);
  if (chain === "sol") {
    if (any("pump", "pump.fun", "pump_mayhem", "pump_mayhem_agent", "pump_agent", "pool_pump_amm")) return { id: "pump", known: true, label: null };
    if (any("letsbonk", "bonkers", "bonk")) return { id: "bonk", known: true, label: null };
    if (any("bags")) return { id: "bags", known: true, label: null };
    if (any("stonkfun")) return { id: "stonkfun", known: true, label: null };
    if (any("heaven")) return { id: "heaven", known: true, label: null };
    // Meteora's dynamic bonding curve is what Bags runs on; other DBC fronts still trade like it.
    if (!migrated && any("meteora_virtual_curve")) return { id: "bags", known: false, label: "Meteora DBC" };
    return { id: "pump", known: false, label: label ?? "DEX" };
  }
  if (chain === "hood") {
    if (any("pons")) return { id: "pons", known: true, label: null };
    if (any("flap", "flap_stocks", "flap_pve")) return { id: "flap", known: true, label: null };
    if (any("bags")) return { id: "bags", known: true, label: null };
    if (any("clanker")) return { id: "clanker", known: true, label: null };
    if (any("trench")) return { id: "trench", known: true, label: null };
    if (any("dyorswap", "dyorfun_v3")) return { id: "dyor", known: true, label: null };
    return { id: "pons", known: false, label: label ?? "DEX" };
  }
  if (chain === "bsc") {
    if (any("fourmeme", "fourmeme_agent", "bn_fourmeme", "four_xmode_agent")) return { id: "four", known: true, label: null };
    if (any("flap", "flap_stocks", "flap_aioracle")) return { id: "flap", known: true, label: null };
    return { id: "four", known: false, label: label ?? "DEX" };
  }
  if (chain === "base") {
    if (any("clanker")) return { id: "clanker", known: true, label: null };
    return { id: "clanker", known: false, label: label ?? "DEX" };
  }
  return { id: "argus", known: false, label: label ?? "DEX" };
}

const VENUES: Record<string, string> = {
  pump_amm: "pumpswap",
  meteora_damm_v2: "meteora-damm-v2",
  meteora_damm: "meteora-damm",
  meteora_dlmm: "meteora-dlmm",
  ray_v4: "raydium-v4",
  ray_clmm: "raydium-clmm",
  ray_cpmm: "raydium-cpmm",
  orca: "orca",
};

function socialUrl(kind: "twitter" | "telegram", v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  const h = s.replace(/^@/, "");
  return kind === "twitter" ? `https://x.com/${h}` : `https://t.me/${h}`;
}

export type GmgnSection = "new_creation" | "near_completion" | "completed";

export interface MappedToken {
  snapshot: TokenSnapshot;
  ext: ExternalEnrichment;
  supply?: number;
  quoteUsd?: number;
  /** The launchpad mapping is real (board-worthy) rather than a fallback. */
  known: boolean;
}

/**
 * A GMGN trenches / rank / hot-search / signal / search item (they share the RankItem long-form fields) → board snapshot
 * plus the overlay for the store. `section` is the trenches column it came from; `interval` the rank window.
 */
export function mapItem(raw: unknown, chain: ChainId, opts: { section?: GmgnSection; interval?: string; now?: number } = {}): MappedToken | null {
  const r = obj(raw);
  const link = obj(r.token_link);
  const address = str(r.address);
  if (!address) return null;
  const now = opts.now ?? Date.now();
  const migrated = opts.section === "completed" || num(r.launchpad_status) === 1 || (num(r.complete_timestamp) ?? 0) > 0 || !!str(r.migrated_pool_exchange);
  const lp = launchpadOf(chain, r.launchpad, r.launchpad_platform, migrated);
  const phase: TokenPhase = migrated ? "migrated" : opts.section === "near_completion" ? "almost" : "new";
  const quoteAddr = str(r.quote_address) ?? str(r.launch_quote_address) ?? "";
  const quote = QUOTES[quoteAddr];
  const createdAt = ms(r.created_timestamp) ?? ms(r.creation_timestamp) ?? ms(r.created_at) ?? ms(r.open_timestamp) ?? now;
  const progress = num(r.progress);
  const bondingPct = migrated ? 100 : progress === null ? undefined : Math.max(0, Math.min(100, progress * 100));
  const socials: Socials = {};
  const tw = socialUrl("twitter", r.twitter ?? r.twitter_username ?? link.twitter_username);
  const tg = socialUrl("telegram", r.telegram ?? link.telegram);
  const web = str(r.website) ?? str(link.website);
  if (tw) socials.twitter = tw;
  if (tg) socials.telegram = tg;
  if (web) socials.website = web;
  const exchange = str(r.exchange) ?? str(r.migrated_pool_exchange);
  const venue = migrated && exchange ? VENUES[exchange] ?? exchange : undefined;
  const price = num(r.price);
  const mcap = num(r.market_cap) ?? num(r.usd_market_cap) ?? num(r.mcp);
  const supply = num(r.total_supply) ?? undefined;
  const devStatus = devStatusOf(r.creator_token_status);
  const buyTax = num(r.buy_tax);
  const sellTax = num(r.sell_tax);
  const iv = opts.interval;

  const snapshot = blankToken({
    chain,
    address,
    launchpad: lp.id,
    name: (str(r.name) ?? "").slice(0, 64) || "Unknown",
    symbol: (str(r.symbol) ?? "").slice(0, 16) || "???",
    creator: str(r.creator) ?? "",
    createdAt,
    image: str(r.logo) ?? undefined,
    socials,
    phase,
    bondingPct: bondingPct ?? 0,
    migratedAt: migrated ? ms(r.complete_timestamp) ?? ms(r.open_timestamp) ?? undefined : undefined,
    pool: str(r.pool_address) ?? undefined,
    venue,
    quoteSymbol: quote?.symbol ?? (chain === "sol" ? "SOL" : undefined),
    launchpadLabel: lp.known ? undefined : lp.label ?? undefined,
  });

  const market: NonNullable<ExternalEnrichment["market"]> = {};
  if (price !== null && price > 0) market.priceUsd = price;
  if (mcap !== null && mcap > 0) market.mcapUsd = mcap;
  const liq = num(r.liquidity);
  if (liq !== null && liq > 0) market.liquidityUsd = liq;
  const v24 = num(r.volume_24h) ?? (iv === "24h" ? num(r.volume) : null);
  const v1h = num(r.volume_1h) ?? (iv === "1h" ? num(r.volume) : null);
  const v5m = num(r.volume_5m) ?? (iv === "5m" ? num(r.volume) : null);
  if (v24 !== null) market.volume24hUsd = v24;
  if (v1h !== null) market.volume1hUsd = v1h;
  if (v5m !== null) market.volume5mUsd = v5m;
  const swaps = num(r.swaps_24h) ?? (iv === "24h" ? num(r.swaps) : null);
  if (swaps !== null) market.txCount = swaps;
  const ch5 = num(r.price_change_percent5m);
  const ch1h = num(r.price_change_percent1h);
  if (ch5 !== null) market.change5mPct = ch5;
  if (ch1h !== null) market.change1hPct = ch1h;
  const ath = num(r.history_highest_market_cap) ?? num(r.ath_market_cap);
  if (ath !== null && ath > 0 && ath < 1e12) market.athMcapUsd = ath;

  const holders: NonNullable<ExternalEnrichment["holders"]> = {};
  const setH = <K extends keyof typeof holders>(k: K, v: (typeof holders)[K] | undefined | null) => {
    if (v !== undefined && v !== null) holders[k] = v;
  };
  setH("holders", num(r.holder_count));
  setH("top10Pct", pct100(r.top_10_holder_rate));
  setH("devHoldPct", pct100(Math.max(n0(r.dev_team_hold_rate), n0(r.creator_balance_rate))));
  setH("snipersPct", pct100(r.top70_sniper_hold_rate));
  setH("snipersCount", num(r.sniper_count));
  setH("insidersPct", pct100(r.suspected_insider_hold_rate));
  setH("bundlersPct", pct100(r.bundler_trader_amount_rate ?? r.bundler_rate));
  setH("freshWalletsPct", pct100(r.fresh_wallet_rate));
  setH("kolBuys", num(r.renowned_count) ?? num(r.kol_count));
  setH("smartBuys", num(r.smart_degen_count));
  setH("botPct", pct100(r.bot_degen_rate));
  setH("ratPct", pct100(r.rat_trader_amount_rate));
  setH("devLaunches", num(r.creator_created_count));
  setH("devMigrations", num(r.creator_created_open_count));
  if (devStatus !== "unknown") setH("devSold", devStatus !== "holding");

  const meta: Partial<TokenSnapshot> = {
    name: snapshot.name !== "Unknown" ? snapshot.name : undefined,
    symbol: snapshot.symbol !== "???" ? snapshot.symbol : undefined,
    image: snapshot.image,
    socials,
    creator: snapshot.creator || undefined,
    pool: snapshot.pool,
    venue,
    gmgnAt: now,
    dexPaid: truthy(r.dexscr_ad) || truthy(r.dexscr_update_link),
    dexAd: truthy(r.dexscr_ad),
    dexTrending: n0(r.dexscr_trending_bar) > 0,
    dexBoost: n0(r.dexscr_boost_fee) > 0 || n0(r.dexscr_boost_ts) > 0,
    dexBoostFee: n0(r.dexscr_boost_fee) || undefined,
    cto: truthy(r.cto_flag),
    xFollowers: num(r.x_user_follower) ?? undefined,
    rugRatio: rate01(r.rug_ratio) ?? undefined,
    kolCount: num(r.renowned_count) ?? num(r.kol_count) ?? undefined,
    smartCount: num(r.smart_degen_count) ?? undefined,
    analyticsAt: Object.keys(holders).length ? now : undefined,
    devStatus: devStatus === "unknown" ? undefined : devStatus,
    devFundedBy: str(r.fund_from_address) ?? undefined,
    buyTaxBps: buyTax !== null && buyTax > 0 ? Math.round(buyTax * 10_000) : undefined,
    sellTaxBps: sellTax !== null && sellTax > 0 ? Math.round(sellTax * 10_000) : undefined,
    launchpadLabel: snapshot.launchpadLabel,
  };
  Object.assign(snapshot, Object.fromEntries(Object.entries(meta).filter(([k, v]) => v !== undefined && k !== "socials")));
  Object.assign(snapshot, holders);
  // A fresh registration shows GMGN's market numbers straight away (the store keeps them as an overlay afterwards).
  Object.assign(snapshot, market);

  return {
    snapshot,
    ext: { at: now, holders, market, meta, bondingPct, phase, migratedAt: snapshot.migratedAt, venue, pool: snapshot.pool },
    supply,
    quoteUsd: quote?.usd,
    known: lp.known,
  };
}

/** Token info (GET /v1/token/info) → board snapshot + overlay (on-demand lookup / Claudio enrichment). */
export function mapInfo(info: unknown, chain: ChainId, opts: { now?: number } = {}): MappedToken | null {
  const d = obj(info);
  const address = str(d.address);
  if (!address || (!str(d.symbol) && !str(d.name))) return null;
  const now = opts.now ?? Date.now();
  const p = obj(d.price);
  const stat = obj(d.stat);
  const dev = obj(d.dev);
  const linkObj = obj(d.link);
  const pool = obj(d.pool);
  const wts = obj(d.wallet_tags_stat);
  const stats = tokenStatsFromInfo(info);
  const migrated = !!stats.migrated;
  const lp = launchpadOf(chain, d.launchpad, d.launchpad_platform, migrated);
  const price = stats.priceUsd ?? null;
  const prevPrice = (w: string) => num(p[`price_${w}`]);
  const change = (w: string) => {
    const b = prevPrice(w);
    return price && b && b > 0 ? (price / b - 1) * 100 : undefined;
  };
  const supply = num(d.circulating_supply) ?? num(d.total_supply) ?? undefined;
  const quote = QUOTES[str(pool.quote_address) ?? ""];
  const devStatus = devStatusOf(dev.creator_token_status);
  const item: Raw = {
    address,
    name: d.name,
    symbol: d.symbol,
    logo: d.logo,
    creator: dev.creator_address,
    creation_timestamp: d.creation_timestamp,
    open_timestamp: d.open_timestamp,
    complete_timestamp: d.migrated_timestamp,
    launchpad: d.launchpad,
    launchpad_platform: d.launchpad_platform,
    launchpad_status: d.launchpad_status,
    progress: d.launchpad_progress,
    pool_address: str(d.migrated_pool) ?? str(d.biggest_pool_address) ?? pool.pool_address,
    exchange: pool.exchange,
    quote_address: pool.quote_address,
    price: price ?? undefined,
    market_cap: stats.mcapUsd ?? undefined,
    liquidity: d.liquidity,
    volume_24h: p.volume_24h,
    volume_1h: p.volume_1h,
    volume_5m: p.volume_5m,
    swaps_24h: p.swaps_24h,
    price_change_percent5m: change("5m"),
    price_change_percent1h: change("1h"),
    holder_count: d.holder_count ?? stat.holder_count,
    top_10_holder_rate: stat.top_10_holder_rate ?? dev.top_10_holder_rate,
    dev_team_hold_rate: stat.dev_team_hold_rate,
    creator_balance_rate: stat.creator_hold_rate,
    top70_sniper_hold_rate: stat.top70_sniper_hold_rate,
    sniper_count: wts.sniper_wallets,
    bundler_trader_amount_rate: stat.top_bundler_trader_percentage,
    fresh_wallet_rate: stat.fresh_wallet_rate,
    renowned_count: wts.renowned_wallets,
    smart_degen_count: wts.smart_wallets,
    bot_degen_rate: stat.bot_degen_rate,
    rat_trader_amount_rate: stat.top_rat_trader_percentage,
    creator_created_count: stat.creator_created_count,
    creator_created_open_count: dev.creator_open_count,
    creator_token_status: dev.creator_token_status,
    twitter: linkObj.twitter_username,
    telegram: linkObj.telegram,
    website: linkObj.website,
    dexscr_ad: dev.dexscr_ad,
    dexscr_update_link: dev.dexscr_update_link,
    dexscr_trending_bar: dev.dexscr_trending_bar,
    dexscr_boost_fee: dev.dexscr_boost_fee,
    dexscr_boost_ts: dev.dexscr_boost_ts,
    cto_flag: dev.cto_flag,
    fund_from_address: dev.fund_from,
    total_supply: supply,
  };
  const m = mapItem(item, chain, { section: migrated ? "completed" : undefined, now });
  if (!m) return null;
  if (stats.athPriceUsd && supply) {
    const athMc = stats.athPriceUsd * supply;
    if (athMc > 0 && athMc < 1e12) {
      m.ext.market = { ...m.ext.market, athMcapUsd: athMc };
      m.snapshot.athMcapUsd = Math.max(m.snapshot.athMcapUsd, athMc);
    }
  }
  const w5 = stats.windows["5m"];
  if (w5) {
    m.ext.market = { ...m.ext.market, buys5m: w5.buys, sells5m: w5.sells };
    m.snapshot.buys5m = w5.buys;
    m.snapshot.sells5m = w5.sells;
  }
  if (devStatus !== "unknown") m.ext.meta = { ...m.ext.meta, devStatus };
  m.known = lp.known;
  m.quoteUsd = quote?.usd;
  return m;
}
