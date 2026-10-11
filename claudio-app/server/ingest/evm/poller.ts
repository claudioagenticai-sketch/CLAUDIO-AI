// Generic per-chain eth_getLogs poller.
//
//  - One JSON-RPC *batch* per tick: [eth_getBlockByNumber(latest), eth_getLogs × filters (up to the head known from
//    the previous tick), eth_gasPrice (every 15s)]. Public RPCs rate-limit per request (HOOD's public endpoint
//    returned "429 Rate Limit Hit, limit will reset in 60 seconds" during research), so we keep it to ~1 HTTP
//    request per tick plus adapter multicalls. Falls back to parallel single calls if batching is unsupported.
//  - Address-filtered subscriptions are merged into ONE getLogs (address[] × topic0[]) and routed back by
//    (address, topic0). Topic-only filters (e.g. Pons curves) and topic1 OR-lists (v4 PoolIds) stay separate.
//  - Logs are dispatched in (block, logIndex) order; then each adapter's afterBatch runs.
//  - Range-limit errors halve the range (regrows on success); rate limits back off exponentially and rotate URLs.
//  - Optional `wsUrl`: eth_subscribe("newHeads") triggers ticks immediately; data still flows through HTTP getLogs.
//  - Reports ChainStatus: latency (batch round trip), lastBlock, gas.

import WebSocket from "ws";
import { CHAINS, type ChainId } from "@shared/chains";
import { setSource, updateChainStats } from "../../store/status";
import { errMsg, ilog, ilogThrottled } from "../log";
import { JsonRpc, RpcError, logParams, num, type LogFilter, type RpcLog } from "./rpc";

export interface PollCtx {
  chain: ChainId;
  rpc: JsonRpc;
  head: number;
  /** Poller's first block (logs at or after this block were seen "live" → creation-tracked). */
  startBlock: number;
  /** Estimated ms timestamp of a block (uses log.blockTimestamp when the node provides a non-zero one). */
  blockTs(block: number, log?: RpcLog): number;
}

export interface Subscription {
  /** Filters for this tick (may change between ticks), or null to skip. */
  filters(): LogFilter[] | null;
  onLog(log: RpcLog, ctx: PollCtx): void;
}

export interface Adapter {
  name: string;
  subs: Subscription[];
  /** One-shot history load before live polling (e.g. creations in the last N blocks). */
  bootstrap?(ctx: PollCtx): Promise<void>;
  /** After each dispatched batch (e.g. multicall reserves for touched curves). */
  afterBatch?(ctx: PollCtx): Promise<void>;
}

export interface PollerOpts {
  chain: ChainId;
  rpcUrls: string[];
  wsUrl?: string;
  intervalMs: number;
  maxRange: number;
  /** Blocks of trade history replayed on start. */
  backfillBlocks: number;
  confirmations?: number;
  /** Minimum spacing between HTTP requests (public RPC protection). */
  minRequestGapMs?: number;
}

interface Job {
  filter: LogFilter;
  /** Routes for the merged address job; single route otherwise. */
  routes: { sub: Subscription; adapter: Adapter; addrs?: Set<string>; t0s?: Set<string> }[];
}

interface HeadBlock {
  number?: string;
  timestamp?: string;
}

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => x.toLowerCase());
}

export class EvmPoller {
  readonly rpc: JsonRpc;
  private adapters: Adapter[] = [];
  private lastBlock = 0;
  private knownHead = 0;
  private startBlock = 0;
  private range: number;
  private running = false;
  private ticking = false;
  private timer: NodeJS.Timeout | undefined;
  private failures = 0;
  private backoffUntil = 0;
  private anchorBlock = 0;
  private anchorTs = 0;
  private msPerBlock: number;
  private lastGasAt = 0;
  private bootstrapped = false;
  private batchOk = true;
  private wsRetry = 0;

  constructor(readonly opts: PollerOpts) {
    this.rpc = new JsonRpc(opts.rpcUrls, 12_000, opts.minRequestGapMs ?? 0);
    this.range = opts.maxRange;
    this.msPerBlock = CHAINS[opts.chain].blockTimeMs;
  }

  use(adapter: Adapter): this {
    this.adapters.push(adapter);
    return this;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    let host = "rpc";
    try {
      host = new URL(this.rpc.url).host;
    } catch {
      /* keep placeholder */
    }
    ilog(this.opts.chain, `poller starting [${this.adapters.map((a) => a.name).join(", ")}] via ${host}, every ${this.opts.intervalMs}ms`);
    this.schedule(0);
    if (this.opts.wsUrl) this.connectWs(this.opts.wsUrl);
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), Math.max(0, ms));
  }

  private ctx(): PollCtx {
    return {
      chain: this.opts.chain,
      rpc: this.rpc,
      head: this.knownHead,
      startBlock: this.startBlock,
      blockTs: (block: number, log?: RpcLog) => {
        const t = log?.blockTimestamp ? num(log.blockTimestamp) : 0;
        if (t > 0) return t * 1000;
        if (!this.anchorBlock) return Date.now();
        return Math.round(this.anchorTs - (this.anchorBlock - block) * this.msPerBlock);
      },
    };
  }

  private applyHead(blk: HeadBlock | null | undefined, latency: number): number {
    if (!blk?.number) throw new RpcError("no head block");
    const n = num(blk.number);
    const ts = num(blk.timestamp) * 1000;
    if (this.anchorBlock && n - this.anchorBlock >= 50 && ts > this.anchorTs) {
      const measured = (ts - this.anchorTs) / (n - this.anchorBlock);
      if (measured > 10 && measured < 30_000) this.msPerBlock = this.msPerBlock * 0.8 + measured * 0.2;
    }
    if (!this.anchorBlock || n - this.anchorBlock >= 50) {
      this.anchorBlock = n;
      this.anchorTs = ts;
    }
    updateChainStats(this.opts.chain, { latencyMs: latency, lastBlock: n });
    if (n > this.knownHead) this.knownHead = n;
    return n;
  }

  private buildJobs(): Job[] {
    const merged: Job = { filter: { address: [], topics: [[]] }, routes: [] };
    const addrs = new Set<string>();
    const t0s = new Set<string>();
    const jobs: Job[] = [];
    for (const adapter of this.adapters) {
      for (const sub of adapter.subs) {
        const fs = sub.filters();
        if (!fs) continue;
        for (const f of fs) {
          const t0 = f.topics[0];
          const mergeable = f.address !== undefined && f.topics.length === 1 && t0 !== null && t0 !== undefined;
          if (mergeable) {
            const a = asList(f.address);
            const t = asList(t0 ?? undefined);
            a.forEach((x) => addrs.add(x));
            t.forEach((x) => t0s.add(x));
            merged.routes.push({ sub, adapter, addrs: new Set(a), t0s: new Set(t) });
          } else jobs.push({ filter: f, routes: [{ sub, adapter }] });
        }
      }
    }
    if (merged.routes.length) {
      merged.filter = { address: [...addrs], topics: [[...t0s]] };
      jobs.unshift(merged);
    }
    return jobs;
  }

  private async tick(): Promise<void> {
    if (this.ticking || !this.running) return;
    const now = Date.now();
    if (now < this.backoffUntil) return this.schedule(this.backoffUntil - now);
    this.ticking = true;
    let delay = this.opts.intervalMs;
    try {
      if (!this.bootstrapped) await this.doBootstrap();

      const conf = this.opts.confirmations ?? 0;
      const safeHead = this.knownHead - conf;
      if (safeHead - this.lastBlock > this.opts.maxRange * 20) {
        ilog(this.opts.chain, `skipping ${safeHead - this.lastBlock - this.opts.maxRange} blocks (fell behind)`);
        this.lastBlock = safeHead - this.opts.maxRange;
      }
      const from = this.lastBlock + 1;
      const to = Math.min(safeHead, from + this.range - 1);
      const jobs = to >= from ? this.buildJobs() : [];
      const wantGas = Date.now() - this.lastGasAt > 15_000;

      const calls: { method: string; params: unknown[] }[] = [{ method: "eth_getBlockByNumber", params: ["latest", false] }];
      for (const j of jobs) calls.push({ method: "eth_getLogs", params: [logParams(from, to, j.filter)] });
      if (wantGas) calls.push({ method: "eth_gasPrice", params: [] });

      const started = Date.now();
      const results = await this.send(calls);
      const latency = Date.now() - started;

      const head = results[0];
      if (head.error) throw head.error;
      this.applyHead(head.result as HeadBlock, latency);

      if (wantGas) {
        const g = results[results.length - 1];
        if (typeof g.result === "string") {
          this.lastGasAt = Date.now();
          const gwei = Number(BigInt(g.result)) / 1e9;
          updateChainStats(this.opts.chain, { gas: `${gwei >= 1 ? gwei.toFixed(2) : gwei.toPrecision(2)} Gwei` });
        }
      }

      if (jobs.length) {
        const logsPerJob: RpcLog[][] = [];
        for (let i = 0; i < jobs.length; i++) {
          const r = results[1 + i];
          if (r.error) throw r.error; // don't advance → no gaps
          logsPerJob.push(Array.isArray(r.result) ? (r.result as RpcLog[]) : []);
        }
        await this.dispatch(jobs, logsPerJob);
        this.lastBlock = to;
      }
      if (this.knownHead - conf > this.lastBlock + this.range) delay = 50; // catching up

      this.failures = 0;
      if (this.range < this.opts.maxRange) this.range = Math.min(this.opts.maxRange, this.range * 2);
      setSource(this.opts.chain, `rpc:${this.opts.chain}`, true);
    } catch (e) {
      this.onError(e);
      delay = Math.max(delay, this.backoffUntil - Date.now());
    } finally {
      this.ticking = false;
      this.schedule(delay);
    }
  }

  /** Batch when supported, else parallel singles (same result shape). */
  private async send(calls: { method: string; params: unknown[] }[]): Promise<{ result?: unknown; error?: RpcError }[]> {
    if (this.batchOk) {
      try {
        return await this.rpc.batch<unknown>(calls);
      } catch (e) {
        const err = e instanceof RpcError ? e : new RpcError(errMsg(e));
        if (err.isRateLimit || err.httpStatus !== undefined || err.message.startsWith("network")) throw err;
        this.batchOk = false; // provider rejected the batch shape
        ilog(this.opts.chain, `RPC batch unsupported (${err.message}) → single requests`);
      }
    }
    return Promise.all(
      calls.map((c) =>
        this.rpc.call<unknown>(c.method, c.params).then(
          (result) => ({ result }),
          (e: unknown) => ({ error: e instanceof RpcError ? e : new RpcError(errMsg(e)) }),
        ),
      ),
    );
  }

  private async doBootstrap(): Promise<void> {
    const started = Date.now();
    const blk = await this.rpc.call<HeadBlock | null>("eth_getBlockByNumber", ["latest", false]);
    const head = this.applyHead(blk, Date.now() - started) - (this.opts.confirmations ?? 0);
    this.bootstrapped = true;
    this.startBlock = Math.max(1, head - this.opts.backfillBlocks);
    this.lastBlock = this.startBlock - 1;
    const ctx = this.ctx();
    for (const a of this.adapters) {
      if (!a.bootstrap) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await a.bootstrap(ctx);
          break;
        } catch (e) {
          const err = e instanceof RpcError ? e : undefined;
          ilog(this.opts.chain, `${a.name} bootstrap failed: ${errMsg(e)}${attempt === 0 && err?.isRateLimit ? " (retrying once)" : ""}`);
          if (!(attempt === 0 && err?.isRateLimit)) break;
          await new Promise<void>((r) => setTimeout(r, err.retryAfterMs ?? 15_000));
        }
      }
    }
  }

  private async dispatch(jobs: Job[], logsPerJob: RpcLog[][]): Promise<void> {
    const merged: { log: RpcLog; sub: Subscription; adapter: Adapter }[] = [];
    jobs.forEach((job, i) => {
      for (const log of logsPerJob[i]) {
        if (log.removed) continue;
        if (job.routes.length === 1 && !job.routes[0].addrs) {
          merged.push({ log, sub: job.routes[0].sub, adapter: job.routes[0].adapter });
          continue;
        }
        const addr = log.address.toLowerCase();
        const t0 = (log.topics[0] ?? "").toLowerCase();
        for (const r of job.routes) {
          if (r.addrs?.has(addr) && r.t0s?.has(t0)) merged.push({ log, sub: r.sub, adapter: r.adapter });
        }
      }
    });
    merged.sort((x, y) => num(x.log.blockNumber) - num(y.log.blockNumber) || num(x.log.logIndex) - num(y.log.logIndex));

    const ctx = this.ctx();
    for (const m of merged) {
      try {
        m.sub.onLog(m.log, ctx);
      } catch (e) {
        ilogThrottled(this.opts.chain, `onLog:${m.adapter.name}`, `${m.adapter.name} failed on ${m.log.transactionHash}: ${errMsg(e)}`);
      }
    }
    for (const a of this.adapters) {
      if (!a.afterBatch) continue;
      try {
        await a.afterBatch(ctx);
      } catch (e) {
        ilogThrottled(this.opts.chain, `after:${a.name}`, `${a.name} afterBatch failed: ${errMsg(e)}`);
      }
    }
    if (merged.length) updateChainStats(this.opts.chain, { lastEventAt: Date.now() });
  }

  private onError(e: unknown): void {
    this.failures++;
    const err = e instanceof RpcError ? e : new RpcError(errMsg(e));
    if (err.isRangeLimit && this.range > 1) {
      this.range = Math.max(1, Math.floor(this.range / 2));
      ilogThrottled(this.opts.chain, "range", `getLogs range limited → ${this.range} blocks (${err.message})`, 30_000);
      return;
    }
    // Rate-limited with somewhere else to go: switch endpoint and retry almost immediately, once per endpoint.
    if (err.isRateLimit && this.rpc.size > 1 && this.failures < this.rpc.size) {
      this.rpc.rotate();
      this.backoffUntil = Date.now() + 300;
      ilogThrottled(this.opts.chain, "rotate", `rate limited → switching to ${new URL(this.rpc.url).host}`, 30_000);
      return;
    }
    const base = err.isRateLimit ? 5000 : 1000;
    const backoff = Math.max(err.retryAfterMs ?? 0, Math.min(60_000, base * 2 ** Math.min(this.failures - 1, 5)));
    this.backoffUntil = Date.now() + backoff;
    if (this.failures >= 2) this.rpc.rotate();
    if (this.failures >= 3) setSource(this.opts.chain, `rpc:${this.opts.chain}`, false, err.message);
    ilogThrottled(this.opts.chain, `err:${err.message.slice(0, 40)}`, `poll error (${this.failures}x, backoff ${backoff}ms): ${err.message}`, 30_000);
  }

  // ─── Optional WS head subscription (latency only; liveness is owned by the HTTP path) ───

  private connectWs(url: string): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { handshakeTimeout: 10_000 });
    } catch (e) {
      ilog(this.opts.chain, `ws connect failed: ${errMsg(e)}`);
      return;
    }
    let lastTrigger = 0;
    ws.on("open", () => {
      this.wsRetry = 0;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }));
      ilog(this.opts.chain, "ws newHeads subscribed");
    });
    ws.on("message", () => {
      const now = Date.now();
      if (now - lastTrigger < 150 || this.ticking || now < this.backoffUntil) return;
      lastTrigger = now;
      this.schedule(0);
    });
    ws.on("close", () => {
      if (!this.running) return;
      const delay = Math.min(60_000, 2000 * 2 ** this.wsRetry++);
      setTimeout(() => this.connectWs(url), delay).unref();
    });
    ws.on("error", (e: Error) => {
      ilogThrottled(this.opts.chain, "ws-err", `ws error: ${e.message}`);
    });
  }
}
