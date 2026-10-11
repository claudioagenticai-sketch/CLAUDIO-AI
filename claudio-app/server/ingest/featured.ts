// Keeps the official $CLAUDIO token on the board and its page alive even though it launched before Claudio's indexers
// were watching: registers it in the token store, refreshes price/volume/liquidity from DexScreener's free API every
// 30 s, backfills 1-minute candles from GeckoTerminal once, and pins its PumpPortal trade feed (when the paid key is
// set) so live trades/candles keep flowing. Public, keyless APIs only; failures just retry on the next tick.
import { CLAUDIO_TOKEN } from "@shared/platform";
import type { Candle } from "@shared/types";
import { blankToken, tokenStore } from "../store";
import { pinTradeSubscription } from "./sol/pumpportal";
import { enrichToken } from "../insights/indexing";
import { ilog } from "./log";

const KEY = `sol:${CLAUDIO_TOKEN.mint}`;
const REFRESH_MS = 30_000;
let started = false;
let seeded = false;
let lastOk = 0;
/** DexScreener's 24 h price change (the token snapshot has no 24 h field). */
let change24h: number | null = null;

interface DexPair {
  dexId?: string;
  pairAddress?: string;
  priceUsd?: string;
  priceNative?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number; quote?: number };
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h24?: number };
  txns?: { m5?: { buys?: number; sells?: number }; h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}

/** $CLAUDIO came from pump.fun (its metadata says createdOn "pump"); graduated coins keep the pump launchpad id. */
function launchpadOf(_dexId?: string) {
  return "pump" as const;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

function ensureRegistered(pair?: DexPair): void {
  if (tokenStore.has(KEY)) return;
  tokenStore.register(
    blankToken({
      chain: "sol",
      address: CLAUDIO_TOKEN.mint,
      launchpad: launchpadOf(pair?.dexId),
      name: CLAUDIO_TOKEN.name,
      symbol: CLAUDIO_TOKEN.symbol,
      creator: "",
      createdAt: pair?.pairCreatedAt ?? Date.now(),
      image: pair?.info?.imageUrl ?? "/claudio/avatar-256.webp",
      phase: "migrated",
      bondingPct: 100,
      quoteSymbol: "SOL",
    }),
    { supply: 1e9, pinned: true },
  );
}

async function refresh(): Promise<void> {
  const j = await fetchJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/tokens/${CLAUDIO_TOKEN.mint}`);
  const pairs = (j.pairs ?? []).filter((p) => Number(p.priceUsd) > 0);
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const p = pairs[0];
  ensureRegistered(p);
  if (!p) return;
  const socials: Record<string, string> = {};
  for (const s of p.info?.socials ?? []) if (s.type === "twitter" || s.type === "telegram") socials[s.type] = s.url;
  if (p.info?.websites?.[0]?.url) socials.website = p.info.websites[0].url;
  tokenStore.patch(KEY, {
    priceUsd: Number(p.priceUsd),
    priceNative: Number(p.priceNative) || 0,
    mcapUsd: p.marketCap ?? p.fdv ?? 0,
    liquidityUsd: p.liquidity?.usd ?? 0,
    volume5mUsd: p.volume?.m5 ?? 0,
    volume1hUsd: p.volume?.h1 ?? 0,
    volume24hUsd: p.volume?.h24 ?? 0,
    buys5m: p.txns?.m5?.buys ?? 0,
    sells5m: p.txns?.m5?.sells ?? 0,
    change5mPct: p.priceChange?.m5 ?? 0,
    change1hPct: p.priceChange?.h1 ?? 0,
    ...(p.info?.imageUrl ? { image: p.info.imageUrl } : {}),
    ...(Object.keys(socials).length ? { socials } : {}),
  });
  change24h = Number.isFinite(p.priceChange?.h24) ? Number(p.priceChange?.h24) : null;
  const t = tokenStore.get(KEY);
  if (t && t.mcapUsd > t.athMcapUsd) tokenStore.patch(KEY, { athMcapUsd: t.mcapUsd });
  lastOk = Date.now();
  // Holders / wallet mix / dev numbers DexScreener doesn't have: GMGN token/info (board lane, cached 60 s). The token is
  // pinned, so GMGN's market numbers never override DexScreener's here.
  void enrichToken(KEY, { lane: "board" });
  if (!seeded && p.pairAddress) {
    seeded = true;
    await seedCandles(p.pairAddress).catch((e) => {
      seeded = false;
      ilog("featured", `candle backfill failed: ${(e as Error).message}`);
    });
  }
}

async function seedCandles(pool: string): Promise<void> {
  const j = await fetchJson<{ data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } } }>(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=720&currency=usd`,
  );
  const rows = j.data?.attributes?.ohlcv_list ?? [];
  const candles: Candle[] = rows
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
  const n = tokenStore.seedCandles(KEY, candles);
  ilog("featured", `$CLAUDIO: backfilled ${n} one-minute candles`);
}

/** $CLAUDIO's 24 h price change in %, or null before the first refresh. */
export function featuredChange24h(): number | null {
  return change24h;
}

export function featuredStatus() {
  return { key: KEY, tracked: tokenStore.has(KEY), lastRefreshAt: lastOk ? new Date(lastOk).toISOString() : null };
}

export function startFeaturedTokens(): void {
  if (started) return;
  started = true;
  ensureRegistered();
  pinTradeSubscription(CLAUDIO_TOKEN.mint);
  const tick = () => refresh().catch((e) => ilog("featured", `refresh failed: ${(e as Error).message}`));
  void tick();
  setInterval(tick, REFRESH_MS).unref?.();
}
