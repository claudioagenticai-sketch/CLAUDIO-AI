// PumpPortal realtime feed (Solana: pump.fun + bonk.fun launches, migrations, optional trades).
//
// ONE connection to wss://pumpportal.fun/api/data — the docs warn that opening many connections gets you
// banned ("You should NOT open a new Websocket connection for every token…"). Reconnect with backoff ≥ 5s.
// Free: subscribeNewToken, subscribeMigration. Paid (API key, funded wallet): subscribeTokenTrade {keys:[mint…]}.
//
// Verified 2026-09-27 with a single 12s connection: ack messages {"message":"Successfully subscribed to token
// creation events."} / {"message":"Subscribed to 'migration' events."}, then create events with exactly:
// signature, mint, traderPublicKey, txType:"create", initialBuy, solAmount, bondingCurveKey, vTokensInBondingCurve,
// vSolInBondingCurve, marketCapSol, name, symbol, uri, is_mayhem_mode, pool:"pump".
// Migration verified in a second 75s capture: {"signature","mint","txType":"migrate","pool":"pump-amm"}.
// Trade payloads (paid) were NOT observed (no API key) → parsed defensively from the documented field names.
//
// Trade subscriptions are WATCH-DRIVEN (server/trades/live owns the set: coin pages open, $CLAUDIO, fresh Claudio
// launches) — never "every new launch". The wanted set is diffed against what this socket has subscribed and flushed
// every 250 ms as at most one subscribeTokenTrade + one unsubscribeTokenTrade message (≤ 50 keys each), on the SAME
// connection. After a reconnect the current set is resubscribed once, in batches. The connection carries the API key
// only when PUMPPORTAL_API_KEY is set and the key isn't cooling down after a metering / auth / ban signal; the free
// launch + migration streams run either way. The wallet private key is never read (the data API doesn't need it).

import WebSocket from "ws";
import { blankToken, tokenStore } from "../../store";
import { markEvent, setSource } from "../../store/status";
import { fetchMeta } from "../meta";
import { errMsg, ilog, ilogThrottled } from "../log";

const URL_BASE = "wss://pumpportal.fun/api/data";
const PUMP_SUPPLY = 1e9;
const PUMP_CURVE_TOKENS = 793_100_000; // real tokens sold on the curve
const PUMP_FINAL_VTOKENS = 279_900_000; // virtual token reserves when complete (1073M − 793.1M)
const BATCH_MS = 250;
const BATCH_KEYS = 50;
/** Hard ceiling on subscribe/unsubscribe messages per minute (a bug must never become a resubscribe storm). */
const MAX_SUB_MSGS_PER_MIN = 40;
const RECONNECT_MIN_MS = Math.max(50, Number(process.env.PUMPPORTAL_RECONNECT_MS) || 5000);
const KEY_COOLDOWN_MS = 15 * 60_000;
const KEY_COOLDOWN_MAX_MS = 2 * 3_600_000;
const BAN_COOLDOWN_MS = 10 * 60_000;
const BAN_COOLDOWN_MAX_MS = 60 * 60_000;

interface PPMessage {
  message?: string;
  errors?: unknown;
  signature?: string;
  mint?: string;
  traderPublicKey?: string;
  txType?: string;
  initialBuy?: number;
  tokenAmount?: number;
  solAmount?: number;
  bondingCurveKey?: string;
  vTokensInBondingCurve?: number;
  vSolInBondingCurve?: number;
  marketCapSol?: number;
  name?: string;
  symbol?: string;
  uri?: string;
  pool?: string;
  is_mayhem_mode?: boolean;
}

let ws: WebSocket | null = null;
let retry = 0;
let started = false;
let lastMsgAt = 0;
let reconnectTimer: NodeJS.Timeout | undefined;
/** Keys this socket has subscribed (cleared on every new connection). */
const tradeSubs = new Set<string>();
/** Keys the live-trades manager wants (survives reconnects). */
const wantedTrades = new Set<string>();
let flushTimer: NodeJS.Timeout | undefined;
let socketKeyed = false;
let connectedAt = 0;
let keyCooldownUntil = 0;
let keyStrikes = 0;
let banStrikes = 0;
let nextConnectNotBefore = 0;
let lastError: string | null = null;
let lastTradeAt = 0;
const subMsgTimes: number[] = [];
const apiKey = (): string => process.env.PUMPPORTAL_API_KEY?.trim() ?? "";
const urlBase = (): string => process.env.PUMPPORTAL_WS_URL?.trim() || URL_BASE;
/** The key goes on the connection only while it isn't cooling down after a metering / auth signal. */
const keyUsable = (): boolean => !!apiKey() && Date.now() >= keyCooldownUntil;

// Per-second counters over the last minute: metered trade events and all messages.
class MinuteCounter {
  private buckets = new Array<number>(60).fill(0);
  private stamps = new Array<number>(60).fill(0);
  add(n = 1, now = Date.now()): void {
    const sec = Math.floor(now / 1000);
    const i = sec % 60;
    if (this.stamps[i] !== sec) {
      this.stamps[i] = sec;
      this.buckets[i] = 0;
    }
    this.buckets[i] += n;
  }
  total(now = Date.now()): number {
    const sec = Math.floor(now / 1000);
    let t = 0;
    for (let i = 0; i < 60; i++) if (sec - this.stamps[i] < 60) t += this.buckets[i];
    return t;
  }
}
const tradeEvents = new MinuteCounter();
const allMessages = new MinuteCounter();
let tradeEventsTotal = 0;

export interface PumpPortalTradeHooks {
  /** A trade message arrived (any token). */
  onTradeEvent?: (mint: string) => void;
  /** The paid trade feed is unusable for a while (metering / auth / ban / stall) — route trades elsewhere. */
  onTradesUnavailable?: (reason: string, untilMs: number) => void;
  /** The keyed socket is (again) open and accepting trade subscriptions. */
  onTradesAvailable?: () => void;
}
let hooks: PumpPortalTradeHooks = {};
export function setPumpPortalTradeHooks(h: PumpPortalTradeHooks): void {
  hooks = h;
}

function bondingPctPump(vTokens: number): number {
  if (!(vTokens > 0)) return 0;
  const pct = (1 - (vTokens - PUMP_FINAL_VTOKENS) / PUMP_CURVE_TOKENS) * 100;
  return Math.max(0, Math.min(100, pct));
}

function send(obj: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function venueOf(pool: string | undefined): string {
  const p = (pool ?? "").toLowerCase();
  if (p.includes("raydium") || p === "bonk" || p.includes("launchlab")) return "raydium-cpmm";
  return "pumpswap";
}

function onCreate(m: PPMessage): void {
  if (!m.mint) return;
  const mint = m.mint;
  const key = `sol:${mint}`;
  const launchpad = m.pool === "bonk" ? "bonk" : "pump";
  const vT = Number(m.vTokensInBondingCurve ?? 0);
  const vS = Number(m.vSolInBondingCurve ?? 0);
  const mcapSol = Number(m.marketCapSol ?? 0);
  // pump: vSol/vTokens is exact. bonk (Raydium LaunchLab): reserve fields are not pump-shaped (a live bonk create
  // produced a 100× too-high vSol/vTokens price) → prefer marketCapSol, and don't derive bonding % from vTokens.
  const priceNative =
    launchpad === "pump" && vT > 0 ? vS / vT : mcapSol > 0 ? mcapSol / PUMP_SUPPLY : vT > 0 ? vS / vT : 0;
  const bondingPct = launchpad === "pump" ? bondingPctPump(vT) : 0;
  const now = Date.now();
  tokenStore.register(
    blankToken({
      chain: "sol",
      address: mint,
      launchpad,
      name: (m.name ?? "").slice(0, 64) || "Unknown",
      symbol: (m.symbol ?? "").slice(0, 16) || "???",
      creator: m.traderPublicKey ?? "",
      createdAt: now,
      createTx: m.signature,
      pool: m.bondingCurveKey,
      quoteSymbol: "SOL",
      priceNative,
      bondingPct,
    }),
    { supply: PUMP_SUPPLY, excluded: m.bondingCurveKey ? [m.bondingCurveKey] : [], createBlock: 0, trackedFromCreation: true },
  );
  const initialBuy = Number(m.initialBuy ?? 0);
  if (initialBuy > 0 && m.traderPublicKey) {
    // The create tx's initial buy is the dev buy.
    tokenStore.addTrade(
      {
        id: `${m.signature ?? mint}:create`,
        key,
        chain: "sol",
        tx: m.signature ?? "",
        block: 0,
        ts: now,
        side: "buy",
        trader: m.traderPublicKey,
        amountToken: initialBuy,
        amountNative: Number(m.solAmount ?? 0),
        amountUsd: 0,
        priceUsd: 0,
        mcapUsd: 0,
        tags: ["dev"],
      },
      { spotPriceNative: priceNative, bondingPct, liquidityNative: launchpad === "pump" ? Math.max(0, vS - 30) : undefined },
    );
  }
  if (m.uri) {
    const missingName = !m.name || !m.symbol;
    void fetchMeta(m.uri).then((meta) => {
      if (!meta) return;
      tokenStore.patch(key, {
        image: meta.image,
        description: meta.description,
        socials: meta.socials,
        ...(missingName && meta.name ? { name: meta.name } : {}),
        ...(missingName && meta.symbol ? { symbol: meta.symbol } : {}),
      });
    });
  }
  markEvent("sol");
}

function onMigrate(m: PPMessage): void {
  if (!m.mint) return;
  const key = `sol:${m.mint}`;
  if (!tokenStore.has(key)) return; // migrations of tokens we never indexed carry no metadata → skip
  tokenStore.migrate(key, { venue: venueOf(m.pool) });
  markEvent("sol");
}

function onTrade(m: PPMessage): void {
  if (!m.mint || !m.traderPublicKey || !m.signature) return;
  tradeEvents.add();
  tradeEventsTotal++;
  lastTradeAt = Date.now();
  keyStrikes = 0; // the paid feed works → the next cooldown starts short again
  try {
    hooks.onTradeEvent?.(m.mint);
  } catch {
    /* hook errors never break the feed */
  }
  const key = `sol:${m.mint}`;
  if (!tokenStore.has(key)) return;
  const vT = Number(m.vTokensInBondingCurve ?? 0);
  const vS = Number(m.vSolInBondingCurve ?? 0);
  const t = tokenStore.get(key);
  const isPump = t?.launchpad === "pump";
  const spot = isPump && vT > 0 ? vS / vT : m.marketCapSol ? m.marketCapSol / PUMP_SUPPLY : vT > 0 ? vS / vT : undefined;
  const onCurve = isPump && t?.phase !== "migrated" && vT > 0;
  tokenStore.addTrade(
    {
      id: `${m.signature}:${m.traderPublicKey}:${m.txType}`,
      key,
      chain: "sol",
      tx: m.signature,
      block: 0, // PumpPortal trade messages carry no slot → bundle-by-slot detection is unavailable on SOL
      ts: Date.now(),
      side: m.txType === "sell" ? "sell" : "buy",
      trader: m.traderPublicKey,
      amountToken: Number(m.tokenAmount ?? 0),
      amountNative: Number(m.solAmount ?? 0),
      amountUsd: 0,
      priceUsd: 0,
      mcapUsd: 0,
      tags: [],
    },
    {
      spotPriceNative: spot,
      bondingPct: onCurve ? bondingPctPump(vT) : undefined,
      liquidityNative: onCurve ? Math.max(0, vS - 30) : undefined,
    },
  );
  markEvent("sol");
}

/** Mints pinned by other modules (e.g. the official $CLAUDIO token) — the live-trades manager keeps them watched. */
const pinnedSubs = new Set<string>();
let pinListener: ((mint: string) => void) | null = null;

/** Keep `mint`'s live trade feed on permanently (PumpPortal when keyed, else the Alchemy fallback). */
export function pinTradeSubscription(mint: string): void {
  pinnedSubs.add(mint);
  pinListener?.(mint);
}
export function pinnedTradeMints(): string[] {
  return [...pinnedSubs];
}
export function setPinListener(fn: ((mint: string) => void) | null): void {
  pinListener = fn;
}

/** True when trade subscriptions can be served: key set, not cooling down, keyed socket open. */
export function pumpPortalTradesAvailable(): boolean {
  return keyUsable() && socketKeyed && !!ws && ws.readyState === WebSocket.OPEN;
}

/** Replace the wanted trade-subscription set (mints). Diffed + batched; safe to call often. */
export function setPumpPortalTradeKeys(mints: Iterable<string>): void {
  wantedTrades.clear();
  for (const m of mints) if (m) wantedTrades.add(m);
  scheduleFlush();
}

/** Stop using the paid feed for `ms` (metering / auth problem). The free streams keep running. */
export function coolDownPumpPortalTrades(reason: string, ms = KEY_COOLDOWN_MS): void {
  const until = Date.now() + ms;
  if (until <= keyCooldownUntil) return;
  keyCooldownUntil = until;
  lastError = reason;
  ilog("pumpportal", `trade feed paused for ${Math.round(ms / 60_000)} min: ${reason}`);
  // Drop the metered subscriptions now (one message) — the socket itself stays for launches + migrations.
  if (tradeSubs.size) sendSubMsg("unsubscribeTokenTrade", [...tradeSubs]);
  tradeSubs.clear();
  try {
    hooks.onTradesUnavailable?.(reason, until);
  } catch {
    /* ignore */
  }
  // Keyed connection only while the key is usable: reopen without it (one socket, free streams continue).
  if (socketKeyed && ws && ws.readyState === WebSocket.OPEN) setTimeout(forceReconnect, 500).unref?.();
  // After the cooldown, reconnect with the key (if the server didn't already close us) and let the manager resubscribe.
  setTimeout(() => {
    if (Date.now() < keyCooldownUntil) return;
    ilog("pumpportal", "trade feed cooldown over → reconnecting with the API key");
    forceReconnect();
  }, ms + 1000).unref?.();
}

function nextKeyCooldown(): number {
  const ms = Math.min(KEY_COOLDOWN_MAX_MS, KEY_COOLDOWN_MS * 2 ** Math.min(keyStrikes, 4));
  keyStrikes++;
  return ms;
}

function subMsgBudgetOk(now: number): boolean {
  while (subMsgTimes.length && now - subMsgTimes[0] > 60_000) subMsgTimes.shift();
  return subMsgTimes.length < MAX_SUB_MSGS_PER_MIN;
}

function sendSubMsg(method: "subscribeTokenTrade" | "unsubscribeTokenTrade", keys: string[]): boolean {
  if (!keys.length || !ws || ws.readyState !== WebSocket.OPEN) return false;
  const now = Date.now();
  if (!subMsgBudgetOk(now)) {
    ilogThrottled("pumpportal", "sub-budget", `subscription message budget (${MAX_SUB_MSGS_PER_MIN}/min) reached — deferring`);
    return false;
  }
  subMsgTimes.push(now);
  send({ method, keys });
  return true;
}

function scheduleFlush(delay = BATCH_MS): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    flushTradeSubs();
  }, delay);
  flushTimer.unref?.();
}

/** Diff wanted vs subscribed → ≤ 1 unsubscribe + ≤ 1 subscribe message per tick (≤ 50 keys each). */
function flushTradeSubs(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return; // the open handler flushes
  const usable = keyUsable() && socketKeyed;
  const want = usable ? wantedTrades : new Set<string>();
  const drop = [...tradeSubs].filter((k) => !want.has(k)).slice(0, BATCH_KEYS);
  const add = [...want].filter((k) => !tradeSubs.has(k)).slice(0, BATCH_KEYS);
  let more = false;
  if (drop.length) {
    if (sendSubMsg("unsubscribeTokenTrade", drop)) for (const k of drop) tradeSubs.delete(k);
    else more = true;
  }
  if (add.length) {
    if (sendSubMsg("subscribeTokenTrade", add)) for (const k of add) tradeSubs.add(k);
    else more = true;
  }
  const pending = [...tradeSubs].some((k) => !want.has(k)) || [...want].some((k) => !tradeSubs.has(k));
  if (pending) scheduleFlush(more ? 5_000 : BATCH_MS);
}

/** Message text that means the paid feed is refused (metering exhausted, bad key, ban). */
const METERING_RE = /insufficient|balance|fund|credit|quota|exceed|limit|payment|pay |unauthori[sz]ed|invalid (api )?key|api.?key|forbidden|banned|blocked|too many|not allowed|expired/i;

function onServerNotice(text: string, isError: boolean): void {
  if (!METERING_RE.test(text)) {
    if (isError) lastError = text.slice(0, 200);
    return;
  }
  lastError = text.slice(0, 200);
  if (/banned|too many/i.test(text)) banStrikes++;
  // Only meaningful while we use (or want) the paid feed; a stray notice must not pause an idle key.
  if (apiKey() && (tradeSubs.size || wantedTrades.size)) coolDownPumpPortalTrades(`server said: ${text.slice(0, 120)}`, nextKeyCooldown());
}

export function pumpPortalTradeStatus(): {
  connected: boolean;
  keyed: boolean;
  keyConfigured: boolean;
  subscribed: number;
  wanted: number;
  eventsPerMin: number;
  messagesPerMin: number;
  eventsTotal: number;
  lastTradeAt: number | null;
  connectedAt: number | null;
  cooldownUntil: number | null;
  lastError: string | null;
} {
  const open = !!ws && ws.readyState === WebSocket.OPEN;
  return {
    connected: open,
    keyed: open && socketKeyed,
    keyConfigured: !!apiKey(),
    subscribed: open ? tradeSubs.size : 0,
    wanted: wantedTrades.size,
    eventsPerMin: tradeEvents.total(),
    messagesPerMin: allMessages.total(),
    eventsTotal: tradeEventsTotal,
    lastTradeAt: lastTradeAt || null,
    connectedAt: open ? connectedAt : null,
    cooldownUntil: keyCooldownUntil > Date.now() ? keyCooldownUntil : null,
    lastError,
  };
}

function handle(raw: string): void {
  lastMsgAt = Date.now();
  allMessages.add();
  let m: PPMessage;
  try {
    m = JSON.parse(raw) as PPMessage;
  } catch {
    return;
  }
  if (m.message) {
    ilogThrottled("pumpportal", `msg:${m.message.slice(0, 60)}`, m.message, 10_000);
    onServerNotice(m.message, /error|fail|denied|invalid/i.test(m.message));
    return;
  }
  if (m.errors) {
    const text = typeof m.errors === "string" ? m.errors : JSON.stringify(m.errors);
    ilogThrottled("pumpportal", "errors", `error: ${text.slice(0, 200)}`);
    onServerNotice(text, true);
    return;
  }
  const tx = (m.txType ?? "").toLowerCase();
  if (tx === "create") return onCreate(m);
  if (tx === "buy" || tx === "sell") return onTrade(m);
  if (tx === "migrate" || tx === "migration" || (!tx && m.mint && m.pool)) return onMigrate(m);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  // ≥5s floor: repeated rapid reconnects are what gets IPs banned. A ban signal (HTTP 429/403) waits ≥ 10 min.
  const base = Math.min(120_000, RECONNECT_MIN_MS * 2 ** Math.min(retry++, 5));
  const jitter = Math.floor(Math.random() * Math.min(1000, RECONNECT_MIN_MS));
  const delay = Math.max(base + jitter, nextConnectNotBefore - Date.now());
  ilog("pumpportal", `reconnecting in ${Math.round(delay / 1000)}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
  reconnectTimer.unref?.();
}

function forceReconnect(): void {
  if (!ws) return;
  try {
    ws.terminate(); // close handler schedules the reconnect
  } catch {
    scheduleReconnect();
  }
}

function connect(): void {
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.terminate();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  const key = keyUsable() ? apiKey() : "";
  const url = key ? `${urlBase()}?api-key=${encodeURIComponent(key)}` : urlBase();
  let sock: WebSocket;
  try {
    sock = new WebSocket(url, { handshakeTimeout: 15_000 });
  } catch (e) {
    ilog("pumpportal", `connect failed: ${errMsg(e)}`);
    setSource("sol", "pumpportal", false, errMsg(e));
    scheduleReconnect();
    return;
  }
  ws = sock;
  tradeSubs.clear(); // a new socket has no subscriptions
  socketKeyed = !!key;
  sock.on("unexpected-response", (_req, res) => {
    // Handshake refused. 401/402/403 with a key → the key is the problem: cool it down, reconnect free.
    // 429 (or 403 without a key) → IP rate-limited / banned: back off hard.
    const code = res.statusCode ?? 0;
    lastError = `handshake HTTP ${code}`;
    ilog("pumpportal", `handshake refused: HTTP ${code}${key ? " (keyed)" : ""}`);
    if (key && (code === 401 || code === 402 || code === 403)) {
      nextConnectNotBefore = Date.now() + RECONNECT_MIN_MS;
      coolDownPumpPortalTrades(`handshake HTTP ${code}`, nextKeyCooldown());
    } else if (code === 429 || code === 403) {
      nextConnectNotBefore = Date.now() + Math.min(BAN_COOLDOWN_MAX_MS, BAN_COOLDOWN_MS * 2 ** Math.min(banStrikes++, 3));
      if (key) coolDownPumpPortalTrades(`handshake HTTP ${code} (rate-limited / banned)`, nextKeyCooldown());
    }
    try {
      sock.terminate();
    } catch {
      /* ignore */
    }
    if (ws !== sock) return;
    setSource("sol", "pumpportal", false, `handshake HTTP ${code}`);
    scheduleReconnect();
  });
  sock.on("open", () => {
    retry = 0;
    banStrikes = 0;
    lastMsgAt = Date.now();
    connectedAt = Date.now();
    setSource("sol", "pumpportal", true);
    ilog("pumpportal", `connected${key ? " (API key: trade feed available)" : apiKey() ? " (API key cooling down: launches + migrations only)" : " (no API key: launches + migrations only)"}`);
    send({ method: "subscribeNewToken" });
    send({ method: "subscribeMigration" });
    if (key) {
      try {
        hooks.onTradesAvailable?.();
      } catch {
        /* ignore */
      }
    }
    scheduleFlush(BATCH_MS); // resubscribe the current wanted set once, in batches
  });
  sock.on("message", (data: WebSocket.RawData) => {
    try {
      handle(data.toString());
    } catch (e) {
      ilogThrottled("pumpportal", "handle", `handler error: ${errMsg(e)}`);
    }
  });
  sock.on("close", (code: number, reason: Buffer) => {
    if (ws !== sock) return;
    const why = reason?.toString().slice(0, 120) ?? "";
    setSource("sol", "pumpportal", false, `socket closed (${code}${why ? `: ${why}` : ""})`);
    tradeSubs.clear();
    // Policy-type closes on a keyed socket (1008 policy, 1013 try later, 4xxx app codes) or a metering-like reason.
    if (key && (code === 1008 || code === 1013 || (code >= 4000 && code < 5000) || METERING_RE.test(why))) {
      coolDownPumpPortalTrades(`socket closed ${code}${why ? ` (${why})` : ""}`, nextKeyCooldown());
    } else if (key && wantedTrades.size) {
      try {
        hooks.onTradesUnavailable?.(`socket closed (${code})`, Date.now() + RECONNECT_MIN_MS);
      } catch {
        /* ignore */
      }
    }
    scheduleReconnect();
  });
  sock.on("error", (e: Error) => {
    ilogThrottled("pumpportal", "sock-err", `socket error: ${e.message}`);
    setSource("sol", "pumpportal", false, e.message);
  });
}

export function startPumpPortal(): void {
  if (started) return;
  started = true;
  connect();
  // Watchdog: launches arrive every few seconds; 90s of silence means a dead socket.
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsgAt > 90_000) {
      ilog("pumpportal", "no messages for 90s → reconnecting");
      setSource("sol", "pumpportal", false, "stalled");
      forceReconnect();
    }
  }, 30_000).unref();
}

/** Tests only: drop the socket and timers so a mock server can be torn down. */
export function stopPumpPortalForTests(): void {
  started = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  ws = null;
}
