// Live trades while someone is watching a coin. Owner: live-trades workstream.
//
//   browser opens a coin page → hub topic "trades:sol:<mint>" gets its first subscriber → watchToken(key)
//   last subscriber leaves → unwatchToken(key) → the feed stops after a 60 s grace
//   server-side pins: $CLAUDIO (featured.ts → pinTradeSubscription) and Claudio launches younger than 1 h
//
// Sources, in order:
//   1. PumpPortal `subscribeTokenTrade` on the ONE existing data socket (server/ingest/sol/pumpportal.ts), only when
//      PUMPPORTAL_API_KEY is set and not cooling down. Metered: 0.01 SOL per 10,000 trade events.
//   2. Alchemy Solana WebSocket (ALCHEMY_SOL_WS_URL or ALCHEMY_API_KEY): one shared socket, logsSubscribe per bonding
//      curve / canonical PumpSwap pool, pump TradeEvent / PumpSwap Buy/SellEvent decoded from the logs (./decode.ts).
//   3. none — the page still renders; trades just don't stream.
// Trades go into the token store's in-memory ring buffer via tokenStore.addTrade (the same path PumpPortal uses, so
// candles, 5m stats, holders and sniper/dev tags update) and reach the page through the hub's trades:<key> topic.
// Nothing is written to the database. PUMPPORTAL_WALLET_PUBLIC_KEY is only used to show the metering wallet's SOL
// balance; the wallet's private key is never read (the data API authenticates with the API key alone).
import type { InsightsStatus } from "@shared/insights";
import { onTopicActivity } from "../../hub";
import { tokenStore } from "../../store";
import { primaryRpc } from "../../rpc";
import { errMsg, ilog, ilogThrottled } from "../../ingest/log";
import {
  coolDownPumpPortalTrades,
  pinnedTradeMints,
  pumpPortalTradeStatus,
  pumpPortalTradesAvailable,
  setPinListener,
  setPumpPortalTradeHooks,
  setPumpPortalTradeKeys,
} from "../../ingest/sol/pumpportal";
import { AlchemySource, alchemyUrlsFromEnv, type AlchemyTarget, type AlchemyTradeBatch } from "./alchemy";
import type { DecodedTrade } from "./decode";
import { pumpAccounts } from "./pda";
import { WatchManager } from "./watch";

const envInt = (name: string, fallback: number): number => {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const COST_SOL_PER_EVENT = 0.01 / 10_000;
const TICK_MS = 5_000;
const LAUNCH_PIN_MS = 3_600_000;
/** PumpPortal's keyed socket may be down this long (reconnecting) before Alchemy takes over. */
const PP_DOWN_GRACE_MS = 20_000;
/** Keep Alchemy running this long after PumpPortal takes over again (trades dedupe by id). */
const OVERLAP_MS = 30_000;
/** No PumpPortal trade event for this long while a pinned canary token is trading elsewhere → treat the feed as dead. */
const STALL_MS = 10 * 60_000;
const PUMP_CURVE_TOKENS = 793_100_000;
const PUMP_FINAL_VTOKENS = 279_900_000;

const manager = new WatchManager({
  graceMs: envInt("LIVE_TRADES_GRACE_MS", 60_000),
  max: envInt("LIVE_TRADES_MAX", 60),
  onChange: () => scheduleSync(),
});

let started = false;
let alchemy: AlchemySource | null = null;
let syncTimer: NodeJS.Timeout | undefined;
let tickTimer: NodeJS.Timeout | undefined;
let source: "pumpportal" | "alchemy" | "none" = "none";
let ppDownSince = 0;
let alchemyOverlapUntil = 0;
let lastPpTradeAt = 0;
let ppTradingSince = 0;
let switches = 0;
const applied = { alchemy: 0, dropped: 0 };

const isSolKey = (key: string): boolean => key.startsWith("sol:") && key.length > 36;
const mintOf = (key: string): string => key.slice(4);

/** A browser started watching this token (coin page open). Idempotent; reference-counted by the caller. */
export function watchToken(key: string): void {
  if (!isSolKey(key)) return;
  manager.acquire(key, "hub");
}

/** The last watcher left; the subscription is dropped after a grace period. */
export function unwatchToken(key: string): void {
  if (!isSolKey(key)) return;
  manager.release(key, "hub");
}

/** Server-side pin (never evicted, no grace while pinned). */
export function pinToken(key: string, reason = "server"): void {
  if (!isSolKey(key)) return;
  manager.acquire(key, `pin:${reason}`);
}

export function unpinToken(key: string, reason = "server"): void {
  manager.release(key, `pin:${reason}`);
}

/** Keys with a live feed right now. */
export function watchedTokens(): string[] {
  return manager.active();
}

export function startLiveTrades(): void {
  if (started) return;
  started = true;
  // Coin pages: first / last subscriber of trades:<key>.
  onTopicActivity("trades:", watchToken, unwatchToken);
  // Pins from other modules ($CLAUDIO via featured.ts), now and later.
  for (const mint of pinnedTradeMints()) pinToken(`sol:${mint}`, "featured");
  setPinListener((mint) => pinToken(`sol:${mint}`, "featured"));

  const urls = alchemyUrlsFromEnv();
  if (urls) alchemy = new AlchemySource({ ...urls, onTrades: applyAlchemy, txRps: envInt("ALCHEMY_TX_RPS", 5) });

  setPumpPortalTradeHooks({
    onTradeEvent: () => {
      lastPpTradeAt = Date.now();
    },
    onTradesUnavailable: (reason) => {
      ilogThrottled("live-trades", "pp-unavail", `PumpPortal trades unavailable (${reason})`, 10_000);
      scheduleSync(0);
    },
    onTradesAvailable: () => scheduleSync(0),
  });

  const pp = pumpPortalTradeStatus();
  ilog(
    "live-trades",
    `started: PumpPortal trades ${pp.keyConfigured ? "keyed" : "OFF (no PUMPPORTAL_API_KEY)"}, Alchemy fallback ${urls ? "configured" : "OFF (no ALCHEMY_SOL_WS_URL / ALCHEMY_API_KEY)"}, max ${manager.stats().max} tokens`,
  );
  tick();
  tickTimer = setInterval(tick, TICK_MS);
  tickTimer.unref?.();
}

/** Tests only. */
export function stopLiveTradesForTests(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (syncTimer) clearTimeout(syncTimer);
  tickTimer = syncTimer = undefined;
  alchemy?.stop();
  alchemy = null;
  manager.clear();
  setPinListener(null);
  setPumpPortalTradeHooks({});
  started = false;
  source = "none";
}

// ─── source selection + sync ────────────────────────────────────────

function scheduleSync(delay = 100): void {
  if (!started) return;
  if (syncTimer) {
    if (delay > 0) return;
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    sync();
  }, delay);
  syncTimer.unref?.();
}

function pickSource(now: number): "pumpportal" | "alchemy" | "none" {
  const pp = pumpPortalTradeStatus();
  let ppOk = false;
  if (pp.keyConfigured && !pp.cooldownUntil) {
    if (pumpPortalTradesAvailable()) {
      ppDownSince = 0;
      ppOk = true;
    } else {
      if (!ppDownSince) ppDownSince = now;
      ppOk = now - ppDownSince < PP_DOWN_GRACE_MS;
    }
  }
  if (ppOk) return "pumpportal";
  if (alchemy) return "alchemy";
  return pp.keyConfigured && !pp.cooldownUntil ? "pumpportal" : "none";
}

function alchemyTargets(keys: string[]): Map<string, AlchemyTarget> {
  const out = new Map<string, AlchemyTarget>();
  for (const key of keys) {
    const mint = mintOf(key);
    const t = tokenStore.get(key);
    // Only pump.fun coins (bonding curve / canonical PumpSwap pool) decode here; bonk etc. need PumpPortal.
    if (t && t.launchpad !== "pump") continue;
    const acc = pumpAccounts(mint);
    if (!acc) continue;
    const migrated = t?.phase === "migrated";
    const nearGrad = !t || (t.bondingPct ?? 0) >= 90;
    if (!migrated) out.set(acc.curve, { key, mint, kind: "curve" });
    if (migrated || nearGrad) out.set(acc.pool, { key, mint, kind: "pool" });
  }
  return out;
}

function sync(): void {
  const now = Date.now();
  const next = pickSource(now);
  if (next !== source) {
    ilog("live-trades", `source: ${source} → ${next} (${manager.stats().active} token(s) watched)`);
    if (source === "alchemy" && next === "pumpportal") alchemyOverlapUntil = now + OVERLAP_MS;
    if (next === "pumpportal") ppTradingSince = now;
    source = next;
    switches++;
  }
  const keys = manager.active();
  setPumpPortalTradeKeys(source === "pumpportal" ? keys.map(mintOf) : []);
  if (alchemy) {
    const useAlchemy = source === "alchemy" || now < alchemyOverlapUntil;
    alchemy.setWanted(useAlchemy ? alchemyTargets(keys) : new Map());
    if (!useAlchemy && alchemyOverlapUntil && now >= alchemyOverlapUntil) alchemyOverlapUntil = 0;
  }
}

function tick(): void {
  const now = Date.now();
  // Fresh Claudio launches stay live for their first hour.
  try {
    const fresh = new Set(
      tokenStore
        .list("sol", undefined, 1000)
        .filter((t) => t.launchedHere && now - t.createdAt < LAUNCH_PIN_MS && !tokenStore.isSimulated(t.key))
        .map((t) => t.key),
    );
    for (const k of fresh) if (!manager.pinsOf(k).includes("pin:launch")) pinToken(k, "launch");
    for (const k of manager.keysPinnedBy("pin:launch")) if (!fresh.has(k)) unpinToken(k, "launch");
  } catch (e) {
    ilogThrottled("live-trades", "launch-pins", `launch pin scan failed: ${errMsg(e)}`);
  }
  checkPumpPortalStall(now);
  sync();
}

/**
 * No-data detection: PumpPortal took our subscriptions but sends nothing while a pinned token whose market data comes
 * from elsewhere (DexScreener for $CLAUDIO) is clearly trading → the metered feed is dead (e.g. wallet empty).
 */
function checkPumpPortalStall(now: number): void {
  if (source !== "pumpportal" || !pumpPortalTradesAvailable()) return;
  const pp = pumpPortalTradeStatus();
  if (pp.subscribed === 0) return;
  const since = Math.max(ppTradingSince, pp.connectedAt ?? 0);
  if (!since || now - since < STALL_MS) return;
  if (lastPpTradeAt && now - lastPpTradeAt < STALL_MS) return;
  const canaryTrading = manager.active().some((k) => {
    if (!manager.isPinned(k)) return false;
    const t = tokenStore.get(k);
    return !!t && t.buys5m + t.sells5m >= 3;
  });
  if (!canaryTrading) return;
  coolDownPumpPortalTrades(`no trade events for ${Math.round(STALL_MS / 60_000)} min while a pinned token is trading`);
}

// ─── apply decoded trades ───────────────────────────────────────────

function bondingPctPump(vTokens: number): number {
  if (!(vTokens > 0)) return 0;
  const pct = (1 - (vTokens - PUMP_FINAL_VTOKENS) / PUMP_CURVE_TOKENS) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Map one decoded event to the store's Trade (same id scheme as PumpPortal: sig:trader:side → cross-source dedupe). */
export function applyDecodedTrade(key: string, d: DecodedTrade, signature: string, slot: number, dupIndex = 0): boolean {
  if (!tokenStore.has(key)) return false;
  const now = Date.now();
  const chainTs = d.timestamp * 1000;
  const ts = Number.isFinite(chainTs) && Math.abs(now - chainTs) < 10 * 60_000 ? chainTs : now;
  const base = `${signature}:${d.trader}:${d.side}`;
  const before = tokenStore.get(key)?.txCount ?? 0;
  const curve = d.curve;
  const vTokensHuman = curve ? Number(curve.vToken) / 1e6 : 0;
  tokenStore.addTrade(
    {
      id: dupIndex ? `${base}:${dupIndex}` : base,
      key,
      chain: "sol",
      tx: signature,
      block: slot,
      ts,
      side: d.side,
      trader: d.trader,
      amountToken: d.amountToken,
      amountNative: d.amountSol,
      amountUsd: 0,
      priceUsd: 0,
      mcapUsd: 0,
      tags: [],
    },
    {
      execPriceNative: d.priceSol > 0 ? d.priceSol : undefined,
      spotPriceNative: d.spotSol > 0 ? d.spotSol : undefined,
      bondingPct: curve ? bondingPctPump(vTokensHuman) : undefined,
      liquidityNative: curve ? Number(curve.realSol) / 1e9 : d.amm ? (2 * Number(d.amm.quoteReserves)) / 1e9 : undefined,
    },
  );
  return (tokenStore.get(key)?.txCount ?? 0) > before; // false → duplicate (e.g. PumpPortal already had it)
}

function applyAlchemy(b: AlchemyTradeBatch): void {
  const counts = new Map<string, number>();
  for (const e of b.events) {
    const k = `${e.trader}:${e.side}`;
    const n = counts.get(k) ?? 0;
    counts.set(k, n + 1);
    if (applyDecodedTrade(b.target.key, e, b.signature, b.slot, n)) applied.alchemy++;
    else applied.dropped++;
  }
}

// ─── status ─────────────────────────────────────────────────────────

let wallet: { address: string; balanceSol: number | null; checkedAt: number; error?: string } | null = null;
let walletInFlight = false;

function refreshWalletBalance(): void {
  const address = process.env.PUMPPORTAL_WALLET_PUBLIC_KEY?.trim();
  if (!address) {
    wallet = null;
    return;
  }
  if (walletInFlight || (wallet && wallet.address === address && Date.now() - wallet.checkedAt < 60_000)) return;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    wallet = { address, balanceSol: null, checkedAt: Date.now(), error: "not a Solana address" };
    return;
  }
  walletInFlight = true;
  // App RPC (server/rpc.ts — Helius when SOL_RPC_URL is set): a balance read, not trade streaming.
  void fetch(primaryRpc("sol"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }),
    signal: AbortSignal.timeout(8_000),
  })
    .then(async (r) => {
      const j = (await r.json()) as { result?: { value?: number }; error?: { message?: string } };
      if (typeof j.result?.value !== "number") throw new Error(j.error?.message ?? `HTTP ${r.status}`);
      wallet = { address, balanceSol: j.result.value / 1e9, checkedAt: Date.now() };
    })
    .catch((e) => {
      wallet = { address, balanceSol: wallet?.address === address ? wallet.balanceSol : null, checkedAt: Date.now(), error: errMsg(e) };
    })
    .finally(() => {
      walletInFlight = false;
    });
}

export interface LiveTradesStatusEx {
  source: "pumpportal" | "alchemy" | "none";
  watching: number;
  pumpportal: {
    connected: boolean;
    keyed: boolean;
    subscribed: number;
    keyConfigured: boolean;
    eventsPerMin: number;
    /** 0.01 SOL per 10,000 trade events, at the current rate. */
    estCostSolPerHour: number;
    eventsTotal: number;
    cooldownUntil: number | null;
    lastError: string | null;
    wallet: { address: string; balanceSol: number | null; checkedAt: number; error?: string } | null;
  };
  alchemy: {
    configured: boolean;
    connected: boolean;
    subscribed: number;
    wanted: number;
    eventsPerMin: number;
    txFetches: number;
    lastError: string | null;
  };
  watch: { viewed: number; pinned: number; grace: number; evictions: number; max: number };
  /** Alchemy-decoded trades added to the store / dropped (unknown token or already there from PumpPortal). */
  applied: { alchemy: number; dropped: number };
  switches: number;
}

export function liveTradesStatus(): InsightsStatus["liveTrades"] & LiveTradesStatusEx {
  refreshWalletBalance();
  const pp = pumpPortalTradeStatus();
  const w = manager.stats();
  return {
    source: started ? source : "none",
    watching: w.active,
    pumpportal: {
      connected: pp.connected,
      keyed: pp.keyed,
      subscribed: pp.subscribed,
      keyConfigured: pp.keyConfigured,
      eventsPerMin: pp.eventsPerMin,
      estCostSolPerHour: Number((pp.eventsPerMin * 60 * COST_SOL_PER_EVENT).toFixed(6)),
      eventsTotal: pp.eventsTotal,
      cooldownUntil: pp.cooldownUntil,
      lastError: pp.lastError,
      wallet,
    },
    alchemy: {
      configured: !!alchemy,
      connected: alchemy?.connected() ?? false,
      subscribed: alchemy?.subscribedCount() ?? 0,
      wanted: alchemy?.wantedCount() ?? 0,
      eventsPerMin: alchemy?.eventsPerMin() ?? 0,
      txFetches: alchemy?.counters.txFetches ?? 0,
      lastError: alchemy?.lastError ?? null,
    },
    watch: { viewed: w.viewed, pinned: w.pinned, grace: w.grace, evictions: w.evictions, max: w.max },
    applied: { ...applied },
    switches,
  };
}
