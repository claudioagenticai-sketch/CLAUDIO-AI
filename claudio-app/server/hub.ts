// Realtime hub: topic pub/sub over one WebSocket endpoint (/ws) with throttled batching.
//
//  - Token upserts are coalesced per topic (latest object per key) and flushed every 250ms as one `tokens` msg.
//  - Trades are queued per topic and flushed every 150ms as one `trades` msg (chronological order).
//  - Everything else (board snapshots, remove, alert, status, pong) is sent immediately.
//  - `status` is broadcast every 2s to "status" subscribers.
//  - Backpressure: a client whose socket buffer exceeds 1MB is skipped for batched/broadcast traffic.
//
// Only upgrades on pathname `/ws` are handled — Vite HMR shares the same http.Server in dev.

import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import WebSocket, { WebSocketServer } from "ws";
import { CHAINS, type ChainId } from "@shared/chains";
import { BRAND } from "@shared/brand";
import type { ClientMsg, ServerMsg, TokenSnapshot, Topic, Trade } from "@shared/types";
import { tokenStore } from "./store";
import { closedFor } from "./access";

const MAX_BUFFERED = 1 << 20; // 1MB
const MAX_TOPICS_PER_CLIENT = 500;
const MAX_TOPIC_LEN = 200;
const TOKEN_FLUSH_MS = 250;
const TRADE_FLUSH_MS = 150;
const STATUS_MS = 2000;
const HEARTBEAT_MS = 30_000;

interface Client {
  ws: WebSocket;
  topics: Set<Topic>;
  alive: boolean;
  ip: string;
}

const clients = new Set<Client>();
const subs = new Map<Topic, Set<Client>>();
const pendingTokens = new Map<Topic, Map<string, TokenSnapshot>>();
const pendingTrades = new Map<Topic, Trade[]>();

const stats = { sent: 0, dropped: 0, connections: 0 };
const topicHooks: { prefix: string; onFirst: (rest: string) => void; onLast: (rest: string) => void }[] = [];

function runTopicHooks(topic: Topic, first: boolean): void {
  for (const h of topicHooks) {
    if (!topic.startsWith(h.prefix)) continue;
    try {
      (first ? h.onFirst : h.onLast)(topic.slice(h.prefix.length));
    } catch {
      /* hooks must never break the hub */
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export function hasSubscribers(topic: Topic): boolean {
  const s = subs.get(topic);
  return !!s && s.size > 0;
}

/** Publish a message on a topic. Token/trade messages are batched; others go out immediately. */
export function publish(topic: Topic, msg: ServerMsg): void {
  const set = subs.get(topic);
  if (!set || set.size === 0) return;
  switch (msg.t) {
    case "token":
      queueToken(topic, msg.token);
      return;
    case "tokens":
      for (const t of msg.tokens) queueToken(topic, t);
      return;
    case "trade":
      queueTrade(topic, msg.trade);
      return;
    case "trades":
      for (const t of msg.trades) queueTrade(topic, t);
      return;
    case "remove": {
      // Drop queued upserts for removed keys so a flush can't resurrect them client-side.
      const pend = pendingTokens.get(topic);
      if (pend) for (const k of msg.keys) pend.delete(k);
      broadcast(topic, JSON.stringify(msg));
      return;
    }
    default:
      broadcast(topic, JSON.stringify(msg));
  }
}

/**
 * Run `onFirst(rest)` when a topic starting with `prefix` gets its first subscriber and `onLast(rest)` when its last
 * one leaves (e.g. "trades:" → live trades start while a coin page is open). Hook errors never touch the socket.
 */
export function onTopicActivity(prefix: string, onFirst: (rest: string) => void, onLast: (rest: string) => void): void {
  topicHooks.push({ prefix, onFirst, onLast });
}

export function hubStats(): { clients: number; topics: number; sent: number; dropped: number; connections: number } {
  return { clients: clients.size, topics: subs.size, ...stats };
}

let attached = false;

export function attachHub(server: Server): void {
  if (attached) return;
  attached = true;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return;
    }
    if (pathname !== "/ws") return; // leave other upgrades (Vite HMR) alone
    if (closedFor(req as never)) {
      // Coming-soon mode: only browsers with the preview cookie get the live feed.
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const fwd = req.headers["x-forwarded-for"];
    const ip = (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
    const client: Client = { ws, topics: new Set(), alive: true, ip };
    clients.add(client);
    stats.connections++;

    ws.on("pong", () => {
      client.alive = true;
    });
    ws.on("message", (data: WebSocket.RawData) => {
      client.alive = true;
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      handleClientMsg(client, msg);
    });
    ws.on("close", () => dropClient(client));
    ws.on("error", () => dropClient(client));

    sendTo(client, JSON.stringify({ t: "hello", serverTime: Date.now(), version: BRAND.version } satisfies ServerMsg), true);
  });

  setInterval(flushTokens, TOKEN_FLUSH_MS).unref();
  setInterval(flushTrades, TRADE_FLUSH_MS).unref();
  setInterval(broadcastStatus, STATUS_MS).unref();
  setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        dropClient(c);
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        dropClient(c);
      }
    }
  }, HEARTBEAT_MS).unref();
}

// ─── Internals ──────────────────────────────────────────────────────

function dropClient(c: Client): void {
  if (!clients.delete(c)) return;
  for (const t of c.topics) {
    const s = subs.get(t);
    if (!s) continue;
    s.delete(c);
    if (s.size === 0) {
      subs.delete(t);
      pendingTokens.delete(t);
      pendingTrades.delete(t);
      runTopicHooks(t, false);
    }
  }
  c.topics.clear();
}

function sendTo(c: Client, data: string, force = false): void {
  if (c.ws.readyState !== WebSocket.OPEN) return;
  if (!force && c.ws.bufferedAmount > MAX_BUFFERED) {
    stats.dropped++;
    return;
  }
  c.ws.send(data);
  stats.sent++;
}

function broadcast(topic: Topic, data: string): void {
  const set = subs.get(topic);
  if (!set) return;
  for (const c of set) sendTo(c, data);
}

function queueToken(topic: Topic, token: TokenSnapshot): void {
  let m = pendingTokens.get(topic);
  if (!m) {
    m = new Map();
    pendingTokens.set(topic, m);
  }
  m.set(token.key, token); // latest wins
}

function queueTrade(topic: Topic, trade: Trade): void {
  let q = pendingTrades.get(topic);
  if (!q) {
    q = [];
    pendingTrades.set(topic, q);
  }
  q.push(trade);
  if (q.length > 500) q.splice(0, q.length - 500);
}

function flushTokens(): void {
  if (pendingTokens.size === 0) return;
  for (const [topic, m] of pendingTokens) {
    if (m.size === 0) continue;
    const msg: ServerMsg = { t: "tokens", tokens: [...m.values()] };
    broadcast(topic, JSON.stringify(msg)); // serialized at flush → always the latest state
  }
  pendingTokens.clear();
}

function flushTrades(): void {
  if (pendingTrades.size === 0) return;
  for (const [topic, q] of pendingTrades) {
    if (q.length === 0) continue;
    q.sort((a, b) => a.ts - b.ts || a.block - b.block);
    const msg: ServerMsg = { t: "trades", trades: q };
    broadcast(topic, JSON.stringify(msg));
  }
  pendingTrades.clear();
}

function statusMsg(): string {
  const msg: ServerMsg = { t: "status", chains: tokenStore.status() };
  return JSON.stringify(msg);
}

function broadcastStatus(): void {
  if (!hasSubscribers("status")) return;
  broadcast("status", statusMsg());
}

function isTopicList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function handleClientMsg(c: Client, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const msg = raw as Partial<ClientMsg> & { topics?: unknown; ts?: unknown };
  switch (msg.t) {
    case "ping": {
      const ts = typeof msg.ts === "number" ? msg.ts : 0;
      sendTo(c, JSON.stringify({ t: "pong", ts, serverTime: Date.now() } satisfies ServerMsg), true);
      return;
    }
    case "sub": {
      if (!isTopicList(msg.topics)) return;
      for (const topic of msg.topics.slice(0, MAX_TOPICS_PER_CLIENT)) subscribe(c, topic);
      return;
    }
    case "unsub": {
      if (!isTopicList(msg.topics)) return;
      for (const topic of msg.topics) unsubscribe(c, topic);
      return;
    }
    default:
      return;
  }
}

function subscribe(c: Client, topic: Topic): void {
  if (!topic || topic.length > MAX_TOPIC_LEN) return;
  if (c.topics.size >= MAX_TOPICS_PER_CLIENT && !c.topics.has(topic)) return;
  c.topics.add(topic);
  let set = subs.get(topic);
  if (!set) {
    set = new Set();
    subs.set(topic, set);
  }
  const first = set.size === 0;
  set.add(c);
  if (first) runTopicHooks(topic, true);
  sendSnapshot(c, topic);
}

function unsubscribe(c: Client, topic: Topic): void {
  if (!c.topics.delete(topic)) return;
  const set = subs.get(topic);
  if (!set) return;
  set.delete(c);
  if (set.size === 0) {
    subs.delete(topic);
    pendingTokens.delete(topic);
    pendingTrades.delete(topic);
    runTopicHooks(topic, false);
  }
}

function sendSnapshot(c: Client, topic: Topic): void {
  try {
    if (topic === "status") {
      sendTo(c, statusMsg(), true);
      return;
    }
    const idx = topic.indexOf(":");
    if (idx < 0) return;
    const kind = topic.slice(0, idx);
    const rest = topic.slice(idx + 1);
    if (kind === "board") {
      if (!(rest in CHAINS)) return;
      const chain = rest as ChainId;
      const msg: ServerMsg = { t: "board", chain, tokens: tokenStore.list(chain, undefined, 300) };
      sendTo(c, JSON.stringify(msg), true);
    } else if (kind === "token") {
      const token = tokenStore.get(rest);
      if (token) sendTo(c, JSON.stringify({ t: "token", token } satisfies ServerMsg), true);
    } else if (kind === "trades") {
      // store returns newest first; the client prepends each trade, so send oldest first.
      const trades = tokenStore.trades(rest, 50).slice().reverse();
      if (trades.length) sendTo(c, JSON.stringify({ t: "trades", trades } satisfies ServerMsg), true);
    }
    // "wallet:<chain>:<addr>" — no snapshot (tracker feature, P2).
  } catch {
    /* snapshot failures must never kill the socket */
  }
}
