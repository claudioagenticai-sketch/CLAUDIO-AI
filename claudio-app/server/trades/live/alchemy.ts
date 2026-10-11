// Alchemy Solana WebSocket fallback: ONE shared socket, one `logsSubscribe {mentions:[address]}` per watched account
// (the pump.fun bonding curve for curve coins, the canonical PumpSwap pool for graduated ones). Trade events are
// decoded straight from the notification's `Program data:` lines; only when the logs were truncated (or a trade
// instruction ran but no event line survived) is the tx fetched with getTransaction over the Alchemy HTTP endpoint —
// queued, rate-limited, cached by signature — and decoded from the self-CPI event instruction instead.
// The socket is opened lazily (only while something is wanted) and closed after 2 idle minutes.
// Helius (SOL_RPC_URL) is never used here: it is reserved for the app's own RPC.
import WebSocket from "ws";
import { decodeLogs, decodeTransaction, logsTruncated, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID, type DecodedTrade, type JsonTx } from "./decode";
import { errMsg, ilog, ilogThrottled } from "../../ingest/log";

export interface AlchemyTarget {
  key: string;
  mint: string;
  kind: "curve" | "pool";
}

export interface AlchemyTradeBatch {
  target: AlchemyTarget;
  address: string;
  signature: string;
  slot: number;
  events: DecodedTrade[];
  via: "logs" | "tx";
}

export interface AlchemyOptions {
  wsUrl: string;
  httpUrl: string;
  onTrades: (b: AlchemyTradeBatch) => void;
  /** getTransaction calls per second (default 5). */
  txRps?: number;
  commitment?: "processed" | "confirmed" | "finalized";
}

interface SubState {
  target: AlchemyTarget;
  subId?: number;
  reqId?: number;
  retryAt?: number;
}

const BATCH_MS = 250;
const PER_FLUSH = 25;
const IDLE_CLOSE_MS = 120_000;
const TX_CACHE = 2000;
const TX_QUEUE_MAX = 200;
const SEEN_MAX = 5000;
const TRADE_IX = /Instruction: (Buy|Sell|BuyExactQuoteIn|BuyExactSolIn|BuyV2|SellV2|BuyExactQuoteInV2)\b/;

export function alchemyUrlsFromEnv(env = process.env): { wsUrl: string; httpUrl: string } | null {
  const ws = env.ALCHEMY_SOL_WS_URL?.trim();
  const key = env.ALCHEMY_API_KEY?.trim();
  const wsUrl = ws || (key ? `wss://solana-mainnet.g.alchemy.com/v2/${key}` : "");
  if (!wsUrl) return null;
  const httpUrl =
    env.ALCHEMY_SOL_HTTP_URL?.trim() ||
    (ws ? ws.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://") : `https://solana-mainnet.g.alchemy.com/v2/${key}`);
  return { wsUrl, httpUrl };
}

/** Never log a URL with its key. */
const redact = (u: string): string => u.replace(/(\/v2\/)[^/?#]+/i, "$1***").replace(/(api[-_]?key=)[^&]+/i, "$1***");

export class AlchemySource {
  private ws: WebSocket | null = null;
  private wanted = new Map<string, AlchemyTarget>(); // address → target
  private subs = new Map<string, SubState>(); // address → state on the current socket
  private bySubId = new Map<number, string>();
  private pendingReq = new Map<number, { address: string; method: "logsSubscribe" | "logsUnsubscribe" }>();
  private nextId = 1;
  private retry = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private alive = true;
  private stopped = false;
  private seen = new Set<string>();
  private txCache = new Map<string, DecodedTrade[]>();
  private txQueue: { sig: string; address: string; slot: number; tries: number }[] = [];
  private txInFlight = new Set<string>();
  private txTimer?: NodeJS.Timeout;
  private lastTxAt = 0;
  private eventTimes: number[] = [];
  readonly counters = { notifications: 0, trades: 0, txFetches: 0, txErrors: 0, subscribeMsgs: 0, unsubscribeMsgs: 0, connects: 0 };
  lastError: string | null = null;
  connectedAt = 0;

  constructor(private opts: AlchemyOptions) {}

  get configured(): boolean {
    return !!this.opts.wsUrl;
  }

  connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  subscribedCount(): number {
    let n = 0;
    for (const s of this.subs.values()) if (s.subId !== undefined) n++;
    return n;
  }

  /** Trades decoded per minute (last 60 s). */
  eventsPerMin(): number {
    const now = Date.now();
    while (this.eventTimes.length && now - this.eventTimes[0] > 60_000) this.eventTimes.shift();
    return this.eventTimes.length;
  }

  wantedCount(): number {
    return this.wanted.size;
  }

  /** Replace the wanted set (address → target). Diffed + batched. */
  setWanted(next: Map<string, AlchemyTarget>): void {
    this.wanted = new Map(next);
    if (this.stopped) return;
    if (this.wanted.size === 0) {
      this.scheduleFlush();
      this.scheduleIdleClose();
      return;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (!this.ws) this.connect();
    else this.scheduleFlush();
  }

  stop(): void {
    this.stopped = true;
    for (const t of [this.reconnectTimer, this.flushTimer, this.idleTimer, this.txTimer]) if (t) clearTimeout(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.closeSocket();
  }

  // ─── socket ──────────────────────────────────────────────────────

  private closeSocket(): void {
    const s = this.ws;
    this.ws = null;
    this.subs.clear();
    this.bySubId.clear();
    this.pendingReq.clear();
    if (s) {
      try {
        s.removeAllListeners();
        s.on("error", () => {});
        s.terminate();
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer || !this.ws) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.wanted.size === 0 && this.ws) {
        ilog("alchemy", "nothing watched for 2 min → closing the socket");
        this.closeSocket();
      }
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    if (this.wanted.size === 0) return; // reopened lazily when something is wanted again
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.retry++, 6)) + Math.floor(Math.random() * 1000);
    ilogThrottled("alchemy", "reconnect", `reconnecting in ${Math.round(delay / 1000)}s`, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private connect(): void {
    if (this.stopped) return;
    this.closeSocket();
    let sock: WebSocket;
    try {
      sock = new WebSocket(this.opts.wsUrl, { handshakeTimeout: 15_000 });
    } catch (e) {
      this.lastError = errMsg(e);
      this.scheduleReconnect();
      return;
    }
    this.ws = sock;
    this.counters.connects++;
    sock.on("open", () => {
      this.retry = 0;
      this.alive = true;
      this.connectedAt = Date.now();
      ilog("alchemy", `connected (${redact(this.opts.wsUrl)}) — subscribing ${this.wanted.size} account(s)`);
      this.scheduleFlush(0);
    });
    sock.on("pong", () => {
      this.alive = true;
    });
    sock.on("message", (data: WebSocket.RawData) => {
      this.alive = true;
      try {
        this.onMessage(data.toString());
      } catch (e) {
        ilogThrottled("alchemy", "handle", `handler error: ${errMsg(e)}`);
      }
    });
    sock.on("close", (code: number) => {
      if (this.ws !== sock) return;
      this.ws = null;
      this.subs.clear();
      this.bySubId.clear();
      this.pendingReq.clear();
      this.lastError = `socket closed (${code})`;
      this.scheduleReconnect();
    });
    sock.on("error", (e: Error) => {
      this.lastError = e.message.slice(0, 200);
      ilogThrottled("alchemy", "sock-err", `socket error: ${redact(e.message)}`);
    });
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => {
        const s = this.ws;
        if (!s || s.readyState !== WebSocket.OPEN) return;
        if (!this.alive) {
          ilog("alchemy", "no pong → reconnecting");
          s.terminate();
          return;
        }
        this.alive = false;
        try {
          s.ping();
        } catch {
          /* ignore */
        }
      }, 30_000);
      this.pingTimer.unref?.();
    }
  }

  private send(obj: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  private scheduleFlush(delay = BATCH_MS): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, delay);
    this.flushTimer.unref?.();
  }

  /** Diff wanted vs subscribed; ≤ 25 subscribes + ≤ 25 unsubscribes per tick. */
  private flush(): void {
    if (!this.connected()) return;
    const now = Date.now();
    let subs = 0;
    let unsubs = 0;
    for (const [address, st] of this.subs) {
      if (this.wanted.has(address) || unsubs >= PER_FLUSH) continue;
      if (st.subId !== undefined) {
        const id = this.nextId++;
        this.pendingReq.set(id, { address, method: "logsUnsubscribe" });
        this.send({ jsonrpc: "2.0", id, method: "logsUnsubscribe", params: [st.subId] });
        this.bySubId.delete(st.subId);
        this.counters.unsubscribeMsgs++;
        unsubs++;
        this.subs.delete(address);
      } else if (st.reqId === undefined) this.subs.delete(address);
      // else: a subscribe is in flight; its response handler unsubscribes when it's no longer wanted.
    }
    for (const [address, target] of this.wanted) {
      if (subs >= PER_FLUSH) break;
      const st = this.subs.get(address);
      if (st && (st.subId !== undefined || st.reqId !== undefined)) continue;
      if (st?.retryAt && st.retryAt > now) continue;
      const id = this.nextId++;
      this.pendingReq.set(id, { address, method: "logsSubscribe" });
      this.subs.set(address, { target, reqId: id });
      this.send({
        jsonrpc: "2.0",
        id,
        method: "logsSubscribe",
        params: [{ mentions: [address] }, { commitment: this.opts.commitment ?? "confirmed" }],
      });
      this.counters.subscribeMsgs++;
      subs++;
    }
    const pending =
      [...this.wanted.keys()].some((a) => !this.subs.has(a) || (this.subs.get(a)!.retryAt ?? 0) > 0) ||
      [...this.subs.keys()].some((a) => !this.wanted.has(a));
    if (pending) this.scheduleFlush(subs >= PER_FLUSH || unsubs >= PER_FLUSH ? BATCH_MS : 5_000);
  }

  private onMessage(raw: string): void {
    const m = JSON.parse(raw) as {
      id?: number;
      result?: unknown;
      error?: { code?: number; message?: string };
      method?: string;
      params?: { subscription?: number; result?: { context?: { slot?: number }; value?: { signature?: string; err?: unknown; logs?: string[] } } };
    };
    if (m.id !== undefined) {
      const req = this.pendingReq.get(m.id);
      if (!req) return;
      this.pendingReq.delete(m.id);
      if (req.method !== "logsSubscribe") return;
      const st = this.subs.get(req.address);
      if (!st || st.reqId !== m.id) return;
      st.reqId = undefined;
      if (m.error || typeof m.result !== "number") {
        this.lastError = `logsSubscribe failed: ${m.error?.message ?? "no subscription id"}`.slice(0, 200);
        ilogThrottled("alchemy", "sub-err", `${this.lastError} (${req.address.slice(0, 8)}…)`);
        st.retryAt = Date.now() + 30_000;
        this.scheduleFlush(30_000);
        return;
      }
      st.subId = m.result;
      st.retryAt = undefined;
      this.bySubId.set(m.result, req.address);
      if (!this.wanted.has(req.address)) this.scheduleFlush(0); // unwatched while in flight → unsubscribe
      return;
    }
    if (m.method !== "logsNotification") return;
    const subId = m.params?.subscription;
    if (subId === undefined) return;
    const address = this.bySubId.get(subId);
    const st = address ? this.subs.get(address) : undefined;
    const v = m.params?.result?.value;
    if (!address || !st || !v?.signature) return;
    this.counters.notifications++;
    if (v.err) return; // failed tx: no trade
    const seenKey = `${v.signature}:${address}`;
    if (this.seen.has(seenKey)) return;
    this.seen.add(seenKey);
    if (this.seen.size > SEEN_MAX) this.seen = new Set([...this.seen].slice(-SEEN_MAX / 2));
    const slot = Number(m.params?.result?.context?.slot ?? 0);
    const logs = v.logs ?? [];
    const events = decodeLogs(logs);
    const ranTradeIx = logs.some((l) => TRADE_IX.test(l)) && logs.some((l) => l.includes(PUMP_PROGRAM_ID) || l.includes(PUMP_AMM_PROGRAM_ID));
    if (logsTruncated(logs) || (events.length === 0 && ranTradeIx)) {
      this.enqueueTx(v.signature, address, slot);
      return;
    }
    this.emit(st.target, address, v.signature, slot, events, "logs");
  }

  private emit(target: AlchemyTarget, address: string, signature: string, slot: number, all: DecodedTrade[], via: "logs" | "tx"): void {
    const events = all.filter((e) => (target.kind === "curve" ? e.program === "pump" && e.mint === target.mint : e.program === "pump-amm" && e.pool === address));
    if (!events.length) return;
    const now = Date.now();
    for (let i = 0; i < events.length; i++) this.eventTimes.push(now);
    if (this.eventTimes.length > 20_000) this.eventTimes.splice(0, this.eventTimes.length - 20_000);
    this.counters.trades += events.length;
    try {
      this.opts.onTrades({ target, address, signature, slot, events, via });
    } catch (e) {
      ilogThrottled("alchemy", "apply", `apply failed: ${errMsg(e)}`);
    }
  }

  // ─── getTransaction fallback (Alchemy HTTP) ──────────────────────

  private enqueueTx(sig: string, address: string, slot: number): void {
    const cached = this.txCache.get(sig);
    const st = this.subs.get(address);
    if (cached && st) {
      this.emit(st.target, address, sig, slot, cached, "tx");
      return;
    }
    if (this.txInFlight.has(`${sig}:${address}`) || this.txQueue.some((q) => q.sig === sig && q.address === address)) return;
    if (this.txQueue.length >= TX_QUEUE_MAX) {
      ilogThrottled("alchemy", "txq", "getTransaction queue full — dropping (trade lost)");
      return;
    }
    this.txQueue.push({ sig, address, slot, tries: 0 });
    this.pumpTxQueue();
  }

  private pumpTxQueue(): void {
    if (this.txTimer || this.txQueue.length === 0) return;
    const gap = 1000 / Math.max(1, this.opts.txRps ?? 5);
    const wait = Math.max(0, this.lastTxAt + gap - Date.now());
    this.txTimer = setTimeout(() => {
      this.txTimer = undefined;
      const job = this.txQueue.shift();
      if (job) void this.runTx(job);
      this.pumpTxQueue();
    }, wait);
    this.txTimer.unref?.();
  }

  private async runTx(job: { sig: string; address: string; slot: number; tries: number }): Promise<void> {
    this.lastTxAt = Date.now();
    const flightKey = `${job.sig}:${job.address}`;
    this.txInFlight.add(flightKey);
    try {
      let events = this.txCache.get(job.sig);
      if (!events) {
        this.counters.txFetches++;
        const r = await fetch(this.opts.httpUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: [job.sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { result?: JsonTx | null; error?: { message?: string } };
        if (j.error) throw new Error(j.error.message ?? "rpc error");
        if (!j.result) {
          // Not visible yet at this commitment → one more try shortly.
          if (job.tries < 2) setTimeout(() => {
            this.txQueue.push({ ...job, tries: job.tries + 1 });
            this.pumpTxQueue();
          }, 1500).unref?.();
          return;
        }
        events = decodeTransaction(j.result);
        this.txCache.set(job.sig, events);
        if (this.txCache.size > TX_CACHE) {
          const first = this.txCache.keys().next().value;
          if (first !== undefined) this.txCache.delete(first);
        }
      }
      const st = this.subs.get(job.address);
      if (st) this.emit(st.target, job.address, job.sig, job.slot, events, "tx");
    } catch (e) {
      this.counters.txErrors++;
      this.lastError = `getTransaction: ${errMsg(e)}`;
      ilogThrottled("alchemy", "tx-err", redact(this.lastError));
    } finally {
      this.txInFlight.delete(flightKey);
    }
  }
}
