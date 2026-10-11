// GMGN OpenAPI gateway — the ONLY way the server talks to GMGN. One process-wide queue in front of the key:
//
//   • Adaptive rate (AIMD): starts at GMGN_RPS (default 2 req/s), never above GMGN_MAX_RPS (2.5), never below 0.5, burst
//     GMGN_BURST (3). GMGN's bucket is weighted per endpoint (holders 5, rank 3, kline 2, info 1 …), so a second bucket in
//     weight units (GMGN_WEIGHT_RATE 2/s at the max rate, capacity GMGN_WEIGHT_BURST 5) scales with the adaptive rate.
//     (Live, 2026-10-08: weight 13 in ~1.5 s — info+security+pool, holders, kline — already drew a 429 with a 30 s reset,
//     and so did three sends inside one second at only 7 weight in 5 s, while spaced weight-5 calls every 3 s passed.
//     So sends go one at a time (GMGN_CONCURRENCY 1), spaced by the request rate (GMGN_BURST 1), at GMGN_WEIGHT_RATE 1.5.)
//     A 429 pauses EVERYTHING until X-RateLimit-Reset (+300–800 ms jitter; 6 s without the header) and halves the rate;
//     nothing is sent while paused (GMGN extends a ban by 5 s per request sent during the cooldown). After 60 s without
//     a 429 the rate grows by 0.1/s up to the cap.
//   • Priority lanes: interactive (a page is waiting) > board (Trenches / Claudio refresh) > background. The queue is
//     bounded (GMGN_MAX_QUEUE, per-lane caps and deadlines): when it is long, background then board work is dropped.
//   • Coalescing: an identical request already queued / in flight is shared (and promoted to the higher lane).
//   • In-memory LRU cache (never the database) with per-endpoint TTLs + stale-while-revalidate (a copy up to 5× its TTL is
//     served at once while a background refresh runs), capped by entries and bytes. Errors are negative-cached briefly.
//   • 8 s timeout, one retry on a network error / 5xx, the key never appears in logs, errors or status.
//   • Without GMGN_API_KEY the gateway is disabled: every call resolves { ok:false, reason:"disabled" } at once.
// Read endpoints only (exist auth: X-APIKEY + timestamp + client_id). No signed / trade / swap / cooking routes.
import { randomUUID } from "crypto";
import type { ChainId } from "@shared/chains";
import type { InsightsStatus } from "@shared/insights";

export type Lane = "interactive" | "board" | "background";
export const LANES: readonly Lane[] = ["interactive", "board", "background"];

export type Endpoint =
  | "info" | "security" | "pool" | "holders" | "traders" | "kline" | "created_tokens" | "wallet_stats" | "wallet_activity"
  | "trenches" | "signals" | "rank" | "hot" | "search" | "kol" | "smartmoney";

interface EndpointDef {
  method: "GET" | "POST";
  path: string;
  /** GMGN's leaky-bucket weight for the route (docs: gmgn-skills). */
  weight: number;
  /** Cache TTL (ms). */
  ttlMs: number;
}

export const ENDPOINTS: Record<Endpoint, EndpointDef> = {
  info: { method: "GET", path: "/v1/token/info", weight: 1, ttlMs: 60_000 }, // 12 s while a page watches the token
  security: { method: "GET", path: "/v1/token/security", weight: 1, ttlMs: 10 * 60_000 },
  pool: { method: "GET", path: "/v1/token/pool_info", weight: 1, ttlMs: 60_000 },
  holders: { method: "GET", path: "/v1/market/token_top_holders", weight: 5, ttlMs: 45_000 },
  traders: { method: "GET", path: "/v1/market/token_top_traders", weight: 5, ttlMs: 60_000 },
  kline: { method: "GET", path: "/v1/market/token_kline", weight: 2, ttlMs: 60_000 },
  created_tokens: { method: "GET", path: "/v1/user/created_tokens", weight: 2, ttlMs: 30 * 60_000 },
  wallet_stats: { method: "GET", path: "/v1/user/wallet_stats", weight: 3, ttlMs: 10 * 60_000 },
  wallet_activity: { method: "GET", path: "/v1/user/wallet_activity", weight: 3, ttlMs: 30_000 },
  trenches: { method: "POST", path: "/v1/trenches", weight: 2, ttlMs: 10_000 },
  signals: { method: "POST", path: "/v1/market/token_signal", weight: 1, ttlMs: 30_000 },
  rank: { method: "GET", path: "/v1/market/rank", weight: 3, ttlMs: 60_000 },
  hot: { method: "POST", path: "/v1/market/hot_searches", weight: 3, ttlMs: 60_000 },
  search: { method: "GET", path: "/v1/market/search", weight: 1, ttlMs: 30_000 },
  kol: { method: "GET", path: "/v1/user/kol", weight: 1, ttlMs: 30_000 },
  smartmoney: { method: "GET", path: "/v1/user/smartmoney", weight: 1, ttlMs: 30_000 },
};

export type Query = Record<string, string | number | string[]>;

export interface CallSpec {
  query?: Query;
  body?: unknown;
}

export interface CallOpts {
  lane?: Lane;
  /** Override the endpoint TTL (e.g. 12 s token info while watched). */
  ttlMs?: number;
  /**
   * Resolve after at most this long: with the stale copy if there is one, else { ok:false, reason:"timeout" }. The call
   * itself continues and fills the cache (so a retry a moment later is a hit).
   */
  maxWaitMs?: number;
  /** Don't serve a stale copy: wait for fresh data when the cached one is older than its TTL. */
  fresh?: boolean;
}

export type FailReason = "disabled" | "dropped" | "timeout" | "rate_limited" | "http" | "api" | "network" | "auth";

export type GmgnResult<T = unknown> =
  | { ok: true; data: T; at: number; cached: boolean; stale: boolean }
  | { ok: false; reason: FailReason; error: string };

/** Minimal fetch surface (tests inject a mock). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface GatewayOptions {
  apiKey?: string | null;
  host?: string;
  fetch?: FetchLike;
  now?: () => number;
  rps?: number;
  maxRps?: number;
  minRps?: number;
  burst?: number;
  /** Weight units per second at the max rate (scaled down with the adaptive rate). */
  weightRate?: number;
  weightBurst?: number;
  /** Additive increase: +recoverStep req/s after recoverAfterMs without a 429. */
  recoverAfterMs?: number;
  recoverStep?: number;
  /** Pause when a 429 carries no X-RateLimit-Reset. */
  pauseDefaultMs?: number;
  jitterMs?: [number, number];
  timeoutMs?: number;
  maxConcurrent?: number;
  maxQueue?: number;
  laneMax?: Partial<Record<Lane, number>>;
  laneDeadlineMs?: Partial<Record<Lane, number>>;
  cacheMaxEntries?: number;
  cacheMaxBytes?: number;
  /** Stale copies are served up to swrFactor × TTL. */
  swrFactor?: number;
  /** API errors (not 429 / network) are remembered this long so a bad address isn't re-asked every request. */
  negativeTtlMs?: number;
  /** Log lines (default console.log with a [gmgn] prefix). */
  log?: (msg: string) => void;
}

interface CacheEntry {
  data: unknown;
  at: number;
  ttlMs: number;
  bytes: number;
}

interface NegEntry {
  reason: FailReason;
  error: string;
  until: number;
}

interface Job {
  key: string;
  endpoint: Endpoint;
  def: EndpointDef;
  spec: CallSpec;
  lane: Lane;
  ttlMs: number;
  enqueuedAt: number;
  deadline: number;
  netRetries: number;
  rlRetries: number;
  promise: Promise<GmgnResult>;
  resolve: (r: GmgnResult) => void;
  state: "queued" | "sending";
}

const DEFAULT_DEADLINE: Record<Lane, number> = { interactive: 10_000, board: 20_000, background: 60_000 };
const DEFAULT_LANE_MAX: Record<Lane, number> = { interactive: 60, board: 40, background: 60 };

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** GMGN chain names. */
export function gmgnChain(chain: ChainId | string): string | null {
  switch (chain) {
    case "sol":
      return "sol";
    case "bsc":
      return "bsc";
    case "base":
      return "base";
    case "hood":
      return "robinhood";
    case "arc":
      return "arc";
    default:
      return null;
  }
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function buildQuery(q: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (Array.isArray(v)) for (const item of v) p.append(k, item);
    else p.set(k, String(v));
  }
  return p.toString();
}

export class GmgnGateway {
  readonly enabled: boolean;
  private readonly key: string;
  private readonly host: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly o: Required<Omit<GatewayOptions, "apiKey" | "host" | "fetch" | "now" | "laneMax" | "laneDeadlineMs" | "log">>;
  private readonly laneMax: Record<Lane, number>;
  private readonly laneDeadline: Record<Lane, number>;
  private readonly log: (msg: string) => void;

  // limiter
  private rps: number;
  private reqTokens: number;
  private wTokens: number;
  private lastRefill: number;
  private pausedUntil = 0;
  private last429 = 0;
  private lastIncrease = 0;
  private authBlockedUntil = 0;
  private authReason: string | null = null;
  private inflight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;

  // queue / coalescing
  private readonly queues: Record<Lane, Job[]> = { interactive: [], board: [], background: [] };
  private readonly pending = new Map<string, Job>();

  // cache
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly neg = new Map<string, NegEntry>();
  private readonly revalidating = new Set<string>();

  // metrics
  private readonly sends: { at: number; w: number; lane: Lane }[] = [];
  private readonly errors: number[] = [];
  private readonly limited: number[] = [];
  private readonly drops: number[] = [];
  private hits = 0;
  private misses = 0;
  private totalSent = 0;
  private total429 = 0;

  constructor(opts: GatewayOptions = {}) {
    this.key = (opts.apiKey ?? "").trim();
    this.enabled = this.key.length > 0;
    this.host = (opts.host ?? "https://openapi.gmgn.ai").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m) => console.log(`${new Date().toLocaleTimeString("en-US", { hour12: true })} [gmgn] ${m}`));
    const maxRps = Math.max(0.5, opts.maxRps ?? 2.5);
    this.o = {
      rps: Math.min(maxRps, Math.max(0.5, opts.rps ?? 2)),
      maxRps,
      minRps: Math.min(maxRps, Math.max(0.05, opts.minRps ?? 0.5)),
      burst: Math.max(1, opts.burst ?? 3),
      weightRate: Math.max(0.5, opts.weightRate ?? 2),
      weightBurst: Math.max(1, opts.weightBurst ?? 5),
      recoverAfterMs: opts.recoverAfterMs ?? 60_000,
      recoverStep: opts.recoverStep ?? 0.1,
      pauseDefaultMs: opts.pauseDefaultMs ?? 6_000,
      jitterMs: opts.jitterMs ?? [300, 800],
      timeoutMs: opts.timeoutMs ?? 8_000,
      maxConcurrent: Math.max(1, opts.maxConcurrent ?? 3),
      maxQueue: Math.max(1, opts.maxQueue ?? 120),
      cacheMaxEntries: opts.cacheMaxEntries ?? 5_000,
      cacheMaxBytes: opts.cacheMaxBytes ?? 50 * 1024 * 1024,
      swrFactor: Math.max(1, opts.swrFactor ?? 5),
      negativeTtlMs: opts.negativeTtlMs ?? 30_000,
    };
    this.laneMax = { ...DEFAULT_LANE_MAX, ...(opts.laneMax ?? {}) };
    this.laneDeadline = { ...DEFAULT_DEADLINE, ...(opts.laneDeadlineMs ?? {}) };
    this.rps = this.o.rps;
    this.reqTokens = this.o.burst;
    this.wTokens = this.o.weightBurst;
    this.lastRefill = this.now();
    this.lastIncrease = this.now();
  }

  // ─── public API ──────────────────────────────────────────────────

  /** Call a GMGN read endpoint through the cache + queue. Never throws. */
  async call<T = unknown>(endpoint: Endpoint, spec: CallSpec = {}, opts: CallOpts = {}): Promise<GmgnResult<T>> {
    if (!this.enabled) return { ok: false, reason: "disabled", error: "GMGN_API_KEY is not set" };
    const def = ENDPOINTS[endpoint];
    const key = this.cacheKey(endpoint, spec);
    const ttl = opts.ttlMs ?? def.ttlMs;
    const lane = opts.lane ?? "interactive";
    const now = this.now();

    const hit = this.cacheGet(key, now);
    if (hit) {
      const age = now - hit.at;
      if (age < ttl) {
        this.hits++;
        return { ok: true, data: hit.data as T, at: hit.at, cached: true, stale: false };
      }
      if (!opts.fresh && age < ttl * this.o.swrFactor) {
        this.hits++;
        this.revalidate(endpoint, def, key, spec, ttl);
        return { ok: true, data: hit.data as T, at: hit.at, cached: true, stale: true };
      }
    }
    const neg = this.neg.get(key);
    if (neg && neg.until > now) {
      this.hits++;
      return { ok: false, reason: neg.reason, error: neg.error };
    }
    this.misses++;
    const job = this.enqueue(endpoint, def, key, spec, lane, ttl);
    const p = job.promise.then((r) => this.withStale<T>(r, key));
    if (!opts.maxWaitMs) return p;
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<GmgnResult<T>>((resolve) => {
      t = setTimeout(() => {
        const s = this.cacheGet(key, this.now());
        resolve(s ? { ok: true, data: s.data as T, at: s.at, cached: true, stale: true } : { ok: false, reason: "timeout", error: `waited ${opts.maxWaitMs} ms` });
      }, opts.maxWaitMs);
      (t as { unref?: () => void }).unref?.();
    });
    const r = await Promise.race([p, timeout]);
    if (t) clearTimeout(t);
    return r;
  }

  /** The cached copy (any age up to swrFactor × TTL) without touching the network. */
  peek<T = unknown>(endpoint: Endpoint, spec: CallSpec = {}): { data: T; at: number } | null {
    const e = this.cacheGet(this.cacheKey(endpoint, spec), this.now());
    return e ? { data: e.data as T, at: e.at } : null;
  }

  isPaused(): boolean {
    return this.now() < this.pausedUntil;
  }

  /** Queue length per lane (callers skip optional work when the board lane is backed up). */
  queued(lane?: Lane): number {
    if (lane) return this.queues[lane].length;
    return this.queues.interactive.length + this.queues.board.length + this.queues.background.length;
  }

  status(): InsightsStatus["gmgn"] & Record<string, unknown> {
    const now = this.now();
    this.prune(now);
    const total = this.hits + this.misses;
    const reason = !this.enabled
      ? "GMGN_API_KEY is not set"
      : now < this.authBlockedUntil
        ? this.authReason
        : now < this.pausedUntil
          ? "rate limited — paused until the reset"
          : null;
    const byLane: Record<Lane, number> = { interactive: 0, board: 0, background: 0 };
    let weight1m = 0;
    for (const s of this.sends) {
      byLane[s.lane]++;
      weight1m += s.w;
    }
    return {
      enabled: this.enabled,
      reason,
      ratePerSec: Math.round(this.rps * 100) / 100,
      maxRatePerSec: this.o.maxRps,
      queued: this.queued(),
      pausedUntil: this.pausedUntil > now ? this.pausedUntil : null,
      calls1m: this.sends.length,
      errors1m: this.errors.length,
      cacheEntries: this.cache.size,
      hitRate: total ? Math.round((this.hits / total) * 1000) / 1000 : 0,
      // additive (not in the shared contract's required set)
      rateLimited1m: this.limited.length,
      dropped1m: this.drops.length,
      weight1m,
      calls1mByLane: byLane,
      inflight: this.inflight,
      cacheBytes: this.cacheBytes,
      totalCalls: this.totalSent,
      total429: this.total429,
      weightPerSec: Math.round(this.weightRate() * 100) / 100,
    };
  }

  /** Test / ops helper. */
  clearCache(): void {
    this.cache.clear();
    this.neg.clear();
    this.cacheBytes = 0;
  }

  // ─── cache ───────────────────────────────────────────────────────

  private cacheKey(endpoint: Endpoint, spec: CallSpec): string {
    return `${endpoint}?${stableStringify(spec.query ?? {})}#${spec.body === undefined ? "" : stableStringify(spec.body)}`;
  }

  private cacheGet(key: string, now: number): CacheEntry | null {
    const e = this.cache.get(key);
    if (!e) return null;
    if (now - e.at >= e.ttlMs * this.o.swrFactor) {
      this.cacheDelete(key);
      return null;
    }
    // LRU: most recently used last.
    this.cache.delete(key);
    this.cache.set(key, e);
    return e;
  }

  private cacheDelete(key: string): void {
    const e = this.cache.get(key);
    if (!e) return;
    this.cacheBytes -= e.bytes;
    this.cache.delete(key);
  }

  private cacheSet(key: string, data: unknown, bytes: number, ttlMs: number): void {
    this.cacheDelete(key);
    this.cache.set(key, { data, at: this.now(), ttlMs, bytes });
    this.cacheBytes += bytes;
    while (this.cache.size > this.o.cacheMaxEntries || (this.cacheBytes > this.o.cacheMaxBytes && this.cache.size > 1)) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cacheDelete(oldest);
    }
    if (this.neg.size > 2_000) {
      const now = this.now();
      for (const [k, n] of this.neg) if (n.until <= now) this.neg.delete(k);
      while (this.neg.size > 2_000) {
        const first = this.neg.keys().next().value;
        if (first === undefined) break;
        this.neg.delete(first);
      }
    }
  }

  private withStale<T>(r: GmgnResult, key: string): GmgnResult<T> {
    if (r.ok) return r as GmgnResult<T>;
    const s = this.cacheGet(key, this.now());
    if (s) return { ok: true, data: s.data as T, at: s.at, cached: true, stale: true };
    return r;
  }

  private revalidate(endpoint: Endpoint, def: EndpointDef, key: string, spec: CallSpec, ttl: number): void {
    if (this.revalidating.has(key) || this.pending.has(key)) return;
    this.revalidating.add(key);
    const job = this.enqueue(endpoint, def, key, spec, "background", ttl);
    void job.promise.finally(() => this.revalidating.delete(key));
  }

  // ─── queue ───────────────────────────────────────────────────────

  private enqueue(endpoint: Endpoint, def: EndpointDef, key: string, spec: CallSpec, lane: Lane, ttlMs: number): Job {
    const existing = this.pending.get(key);
    if (existing) {
      // Coalesce; promote a queued job to the more urgent lane.
      if (existing.state === "queued" && LANES.indexOf(lane) < LANES.indexOf(existing.lane)) {
        const q = this.queues[existing.lane];
        const i = q.indexOf(existing);
        if (i >= 0) q.splice(i, 1);
        existing.lane = lane;
        existing.deadline = Math.max(existing.deadline, this.now() + this.laneDeadline[lane]);
        this.queues[lane].push(existing);
      }
      existing.ttlMs = Math.min(existing.ttlMs, ttlMs);
      return existing;
    }
    let resolve!: (r: GmgnResult) => void;
    const promise = new Promise<GmgnResult>((r) => (resolve = r));
    const now = this.now();
    const job: Job = {
      key,
      endpoint,
      def,
      spec,
      lane,
      ttlMs,
      enqueuedAt: now,
      deadline: now + this.laneDeadline[lane],
      netRetries: 0,
      rlRetries: 0,
      promise,
      resolve: (r) => {
        if (this.pending.get(key) === job) this.pending.delete(key);
        resolve(r);
      },
      state: "queued",
    };
    if (!this.makeRoom(lane)) {
      this.drops.push(now);
      resolve({ ok: false, reason: "dropped", error: `queue full (${lane})` });
      return job;
    }
    this.pending.set(key, job);
    this.queues[lane].push(job);
    this.pump();
    return job;
  }

  /** Make room for one job in `lane`, dropping lower-lane work first. False → reject the new job. */
  private makeRoom(lane: Lane): boolean {
    const total = () => this.queued();
    const rank = LANES.indexOf(lane);
    while (total() >= this.o.maxQueue || this.queues[lane].length >= this.laneMax[lane]) {
      let dropped = false;
      // Lane full on its own: shed that lane's oldest only for interactive (fresh pages beat stale waits).
      if (this.queues[lane].length >= this.laneMax[lane]) {
        if (lane !== "interactive") return false;
        this.dropJob(this.queues.interactive.shift()!, "queue full (interactive, oldest dropped)");
        continue;
      }
      for (let r = LANES.length - 1; r > rank; r--) {
        const q = this.queues[LANES[r]];
        if (q.length) {
          this.dropJob(q.shift()!, `queue full (${LANES[r]} dropped for ${lane})`);
          dropped = true;
          break;
        }
      }
      if (!dropped) return false;
    }
    return true;
  }

  private dropJob(job: Job, why: string): void {
    this.drops.push(this.now());
    job.resolve({ ok: false, reason: "dropped", error: why });
  }

  private nextJob(now: number): Job | null {
    for (const lane of LANES) {
      const q = this.queues[lane];
      while (q.length && q[0].deadline < now) this.dropJob(q.shift()!, `deadline passed (${lane})`);
      if (q.length) return q[0];
    }
    return null;
  }

  private weightRate(): number {
    return this.o.weightRate * (this.rps / this.o.maxRps);
  }

  private refill(now: number): void {
    const dt = Math.max(0, now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.reqTokens = Math.min(this.o.burst, this.reqTokens + dt * this.rps);
    this.wTokens = Math.min(this.o.weightBurst, this.wTokens + dt * this.weightRate());
    // Additive increase after a quiet minute.
    if (this.rps < this.o.maxRps && now - Math.max(this.last429, this.lastIncrease) >= this.o.recoverAfterMs) {
      this.rps = Math.min(this.o.maxRps, Math.round((this.rps + this.o.recoverStep) * 1000) / 1000);
      this.lastIncrease = now;
    }
  }

  private schedule(ms: number): void {
    const at = this.now() + Math.max(1, ms);
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(1, Math.ceil(ms)));
    (this.timer as { unref?: () => void }).unref?.();
  }

  private pump(): void {
    const now = this.now();
    if (now < this.pausedUntil) {
      // Expire what can't wait, then sleep until the reset. Nothing is sent while paused.
      this.nextJob(now);
      if (this.queued()) this.schedule(this.pausedUntil - now);
      return;
    }
    if (now < this.authBlockedUntil) {
      for (const lane of LANES) while (this.queues[lane].length) this.queues[lane].shift()!.resolve({ ok: false, reason: "auth", error: this.authReason ?? "GMGN rejected the key" });
      return;
    }
    while (this.inflight < this.o.maxConcurrent) {
      const job = this.nextJob(now);
      if (!job) return;
      this.refill(now);
      const need = Math.min(job.def.weight, this.o.weightBurst);
      if (this.reqTokens < 1 || this.wTokens < need) {
        const waitReq = this.reqTokens >= 1 ? 0 : (1 - this.reqTokens) / this.rps;
        const waitW = this.wTokens >= need ? 0 : (need - this.wTokens) / this.weightRate();
        this.schedule(Math.max(waitReq, waitW) * 1000 + 5);
        return;
      }
      this.reqTokens -= 1;
      this.wTokens -= job.def.weight; // full weight; a call heavier than the burst leaves the bucket in debt
      this.queues[job.lane].shift();
      job.state = "sending";
      this.inflight++;
      void this.send(job).finally(() => {
        this.inflight--;
        this.pump();
      });
    }
  }

  private requeueFront(job: Job): void {
    job.state = "queued";
    this.queues[job.lane].unshift(job);
  }

  private on429(resetHeader: string | null): void {
    const now = this.now();
    const reset = Number(resetHeader);
    const [jmin, jmax] = this.o.jitterMs;
    const jitter = jmin + Math.random() * Math.max(0, jmax - jmin);
    const until = Number.isFinite(reset) && reset > 0 ? Math.max(now, reset * 1000) + jitter : now + this.o.pauseDefaultMs;
    const wasPaused = now < this.pausedUntil;
    this.pausedUntil = Math.max(this.pausedUntil, until);
    // Halve once per cooldown (several in-flight 429s for the same burst count as one signal).
    if (!wasPaused) this.rps = Math.max(this.o.minRps, Math.round((this.rps / 2) * 1000) / 1000);
    this.reqTokens = 0;
    this.wTokens = 0;
    this.lastRefill = this.pausedUntil;
    this.last429 = now;
    this.total429++;
    this.limited.push(now);
    this.log(`429 → paused ${Math.round((this.pausedUntil - now) / 100) / 10}s, rate now ${this.rps}/s`);
  }

  private redact(s: string): string {
    return this.key ? s.split(this.key).join("***") : s;
  }

  private async send(job: Job): Promise<void> {
    const { def, spec } = job;
    const now = this.now();
    const query: Query = { ...(spec.query ?? {}), timestamp: Math.floor(now / 1000), client_id: randomUUID() };
    const url = `${this.host}${def.path}?${buildQuery(query)}`;
    const headers: Record<string, string> = {
      "X-APIKEY": this.key,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "claudio-insights/1",
    };
    this.sends.push({ at: now, w: def.weight, lane: job.lane });
    this.totalSent++;
    if (process.env.GMGN_DEBUG === "1") this.log(`send ${job.endpoint} w${def.weight} lane=${job.lane} wTokens=${this.wTokens.toFixed(2)} rps=${this.rps}`);
    let status = 0;
    let text = "";
    let resetHeader: string | null = null;
    try {
      const res = await this.fetchImpl(url, {
        method: def.method,
        headers,
        body: def.method === "POST" ? JSON.stringify(spec.body ?? {}) : undefined,
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
      status = res.status;
      resetHeader = res.headers.get("x-ratelimit-reset");
      text = await res.text();
    } catch (e) {
      this.errors.push(this.now());
      const msg = this.redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      if (job.netRetries < 1) {
        job.netRetries++;
        this.requeueFront(job);
        return;
      }
      job.resolve({ ok: false, reason: "network", error: `${job.endpoint}: ${msg}` });
      return;
    }
    let j: { code?: number | string; data?: unknown; message?: string; error?: string } | null = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    const apiErr = typeof j?.error === "string" ? j.error : "";
    if (status === 429 || apiErr === "RATE_LIMIT_EXCEEDED" || apiErr === "RATE_LIMIT_BANNED") {
      this.on429(resetHeader);
      if (job.rlRetries < 1 && job.deadline > this.pausedUntil) {
        job.rlRetries++;
        this.requeueFront(job);
        return;
      }
      job.resolve({ ok: false, reason: "rate_limited", error: `${job.endpoint}: rate limited` });
      return;
    }
    if (status === 401 || status === 403 || apiErr.startsWith("AUTH_")) {
      this.errors.push(this.now());
      // Bad / blocked key or clock skew: stop asking for a while instead of hammering.
      const skew = apiErr === "AUTH_TIMESTAMP_EXPIRED" || apiErr === "AUTH_CLIENT_ID_REPLAYED";
      if (!skew) {
        this.authBlockedUntil = this.now() + 5 * 60_000;
        this.authReason = `GMGN rejected the key (${apiErr || `HTTP ${status}`}) — retrying in 5 min`;
        this.log(this.authReason);
      } else if (job.netRetries < 1) {
        job.netRetries++;
        this.requeueFront(job);
        return;
      }
      job.resolve({ ok: false, reason: "auth", error: this.redact(`${job.endpoint}: ${apiErr || `HTTP ${status}`}`) });
      return;
    }
    if (status >= 500 || !j) {
      this.errors.push(this.now());
      if (job.netRetries < 1 && status >= 500) {
        job.netRetries++;
        this.requeueFront(job);
        return;
      }
      job.resolve({ ok: false, reason: "http", error: `${job.endpoint}: HTTP ${status}${j ? "" : " (non-JSON)"}` });
      return;
    }
    if (j.code !== 0 && j.code !== "0") {
      this.errors.push(this.now());
      const error = this.redact(`${job.endpoint}: ${apiErr || j.code}${j.message ? ` ${String(j.message).slice(0, 160)}` : ""}`);
      this.neg.set(job.key, { reason: "api", error, until: this.now() + this.o.negativeTtlMs });
      job.resolve({ ok: false, reason: "api", error });
      return;
    }
    this.neg.delete(job.key);
    this.cacheSet(job.key, j.data, text.length, job.ttlMs);
    job.resolve({ ok: true, data: j.data, at: this.now(), cached: false, stale: false });
  }

  private prune(now: number): void {
    const cut = now - 60_000;
    while (this.sends.length && this.sends[0].at < cut) this.sends.shift();
    for (const arr of [this.errors, this.limited, this.drops]) while (arr.length && arr[0] < cut) arr.shift();
  }
}

// ─── process-wide singleton ─────────────────────────────────────────

let singleton: GmgnGateway | null = null;

export function gateway(): GmgnGateway {
  if (!singleton) {
    singleton = new GmgnGateway({
      apiKey: process.env.GMGN_API_KEY ?? null,
      host: process.env.GMGN_HOST || undefined,
      rps: envNum("GMGN_RPS", 2),
      maxRps: envNum("GMGN_MAX_RPS", 2.5),
      burst: envNum("GMGN_BURST", 1),
      weightRate: envNum("GMGN_WEIGHT_RATE", 1.5),
      weightBurst: envNum("GMGN_WEIGHT_BURST", 5),
      maxQueue: envNum("GMGN_MAX_QUEUE", 120),
      maxConcurrent: envNum("GMGN_CONCURRENCY", 1),
    });
    setInterval(() => singleton?.status(), 30_000).unref?.(); // prune metric rings
  }
  return singleton;
}

/** Tests swap the singleton (mock fetch / fast clock). */
export function setGatewayForTests(g: GmgnGateway | null): void {
  singleton = g;
}

// ─── typed endpoint helpers ─────────────────────────────────────────

export const TRENCHES_SECTION = { filters: ["offchain", "onchain"], launchpad_platform_v2: true, limit: 80, quote_address_type: [4, 5, 3, 1, 13, 0] };

export const gm = {
  tokenInfo: (chain: string, address: string, o?: CallOpts) => gateway().call("info", { query: { chain, address } }, o),
  tokenSecurity: (chain: string, address: string, o?: CallOpts) => gateway().call("security", { query: { chain, address } }, o),
  tokenPool: (chain: string, address: string, o?: CallOpts) => gateway().call("pool", { query: { chain, address } }, o),
  holders: (chain: string, address: string, o?: CallOpts) => gateway().call("holders", { query: { chain, address, limit: 100 } }, o),
  traders: (chain: string, address: string, o?: CallOpts) => gateway().call("traders", { query: { chain, address, limit: 100 } }, o),
  /** from / to in MILLISECONDS; bucketed to the minute so the cache key is shared. */
  kline: (chain: string, address: string, resolution: string, fromMs: number, toMs: number, o?: CallOpts) =>
    gateway().call("kline", { query: { chain, address, resolution, from: Math.floor(fromMs / 60_000) * 60_000, to: Math.floor(toMs / 60_000) * 60_000 } }, o),
  createdTokens: (chain: string, wallet: string, o?: CallOpts) => gateway().call("created_tokens", { query: { chain, wallet_address: wallet } }, o),
  walletStats: (chain: string, wallet: string, period = "7d", o?: CallOpts) => gateway().call("wallet_stats", { query: { chain, wallet_address: wallet, period } }, o),
  walletActivity: (chain: string, wallet: string, extra: { token?: string; limit?: number } = {}, o?: CallOpts) =>
    gateway().call("wallet_activity", { query: { chain, wallet_address: wallet, limit: extra.limit ?? 50, ...(extra.token ? { token: extra.token } : {}) } }, o),
  trenches: (chain: string, o?: CallOpts) =>
    gateway().call("trenches", { query: { chain }, body: { version: "v2", new_creation: TRENCHES_SECTION, near_completion: TRENCHES_SECTION, completed: TRENCHES_SECTION } }, o),
  signals: (chain: string, o?: CallOpts) => gateway().call("signals", { body: { chain, groups: [{}] } }, o),
  peekSignals: (chain: string) => gateway().peek("signals", { body: { chain, groups: [{}] } }),
  rank: (chain: string, interval: string, orderBy: string, o?: CallOpts) =>
    gateway().call("rank", { query: { chain, interval, limit: 100, order_by: orderBy, direction: "desc" } }, o),
  hot: (chain: string, interval: string, o?: CallOpts) => gateway().call("hot", { body: { params: [{ chain, interval, limit: 100 }] } }, o),
  search: (q: string, chain: string, o?: CallOpts) => gateway().call("search", { query: { q, chain } }, o),
  kol: (chain: string, o?: CallOpts) => gateway().call("kol", { query: { chain, limit: 50 } }, o),
  smartmoney: (chain: string, o?: CallOpts) => gateway().call("smartmoney", { query: { chain, limit: 50 } }, o),
};
