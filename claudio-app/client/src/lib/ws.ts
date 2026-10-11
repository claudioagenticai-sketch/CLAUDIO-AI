// Reconnecting WebSocket client with topic subscriptions.
// Topics are re-subscribed automatically after reconnect. Messages fan out to listeners.

import type { ClientMsg, ServerMsg, Topic } from "@shared/types";

type Listener = (msg: ServerMsg) => void;
export type ConnState = "connecting" | "open" | "closed";

class FeedSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private topics = new Map<Topic, number>(); // refcounts
  private retry = 0;
  private pingTimer: number | undefined;
  state: ConnState = "closed";
  latencyMs = 0;

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.setState("connecting");

    ws.onopen = () => {
      this.retry = 0;
      this.setState("open");
      if (this.topics.size) this.send({ t: "sub", topics: [...this.topics.keys()] });
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: "ping", ts: Date.now() }), 5000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.t === "pong") this.latencyMs = Date.now() - msg.ts;
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.setState("closed");
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private setState(s: ConnState) {
    this.state = s;
    this.stateListeners.forEach((l) => l(s));
  }

  private send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(topics: Topic[]): () => void {
    const fresh: Topic[] = [];
    for (const t of topics) {
      const n = this.topics.get(t) ?? 0;
      this.topics.set(t, n + 1);
      if (n === 0) fresh.push(t);
    }
    if (fresh.length) this.send({ t: "sub", topics: fresh });
    return () => {
      const gone: Topic[] = [];
      for (const t of topics) {
        const n = (this.topics.get(t) ?? 1) - 1;
        if (n <= 0) {
          this.topics.delete(t);
          gone.push(t);
        } else this.topics.set(t, n);
      }
      if (gone.length) this.send({ t: "unsub", topics: gone });
    };
  }

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onState(l: (s: ConnState) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }
}

export const socket = new FeedSocket();
