// Minimal JSON-RPC client over fetch with URL fallback, batching and latency tracking.
// Raw JSON-RPC (instead of a viem PublicClient) keeps exact control over eth_getLogs filters (topic OR-lists),
// batch requests, and the round-trip latency we report in ChainStatus. viem is used for ABI coding.

import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex?: string;
  logIndex: string;
  blockTimestamp?: string;
  removed?: boolean;
}

export interface LogFilter {
  address?: string | string[];
  topics: (string | string[] | null)[];
}

export class RpcError extends Error {
  constructor(message: string, readonly code?: number, readonly httpStatus?: number, readonly retryAfterMs?: number) {
    super(message);
  }
  /** Provider refused the query size (range / result count). */
  get isRangeLimit(): boolean {
    const m = this.message.toLowerCase();
    if (this.isRateLimit) return false;
    return (
      this.code === -32005 ||
      (this.code === -32602 && /range|block/.test(m)) ||
      // GlobalStake (HOOD) answers oversized getLogs with "request is too complex/large, try lesser input".
      /limit exceeded|block range|too many|query returned more|exceed|max.*block|response size|too complex|too large|lesser input/.test(m)
    );
  }
  get isRateLimit(): boolean {
    return this.httpStatus === 429 || this.code === 429 || /rate limit|429|too many requests/i.test(this.message);
  }
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

let nextId = 1;

export class JsonRpc {
  private idx = 0;
  latencyMs = 0;
  failures = 0;

  private nextSlot = 0;

  /**
   * @param minGapMs minimum spacing between HTTP requests on this client (public RPCs apply weighted
   *                 rate limits — HOOD's answers 429 with Retry-After after bursts of heavy getLogs/eth_call).
   */
  constructor(readonly urls: string[], private readonly timeoutMs = 10_000, private readonly minGapMs = 0) {
    if (!urls.length) throw new Error("JsonRpc: no URLs");
  }

  private async throttle(): Promise<void> {
    if (this.minGapMs <= 0) return;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.minGapMs;
    if (at > now) await new Promise<void>((r) => setTimeout(r, at - now));
  }

  get url(): string {
    return this.urls[this.idx % this.urls.length];
  }

  get size(): number {
    return this.urls.length;
  }

  rotate(): void {
    if (this.urls.length > 1) this.idx = (this.idx + 1) % this.urls.length;
  }

  private async post(body: unknown): Promise<unknown> {
    await this.throttle();
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new RpcError(`network: ${(e as Error).message}`);
    }
    if (res.status === 429) {
      const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      throw new RpcError("HTTP 429 rate limited", 429, 429, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    }
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, undefined, res.status);
    const json = (await res.json()) as unknown;
    const ms = Date.now() - started;
    this.latencyMs = this.latencyMs ? this.latencyMs * 0.7 + ms * 0.3 : ms;
    return json;
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const json = (await this.post({ jsonrpc: "2.0", id: nextId++, method, params })) as RpcResponse;
    if (json.error) throw new RpcError(json.error.message ?? "rpc error", json.error.code);
    return json.result as T;
  }

  /** JSON-RPC batch. Whole-batch failures throw; per-item errors are returned in `error`. */
  async batch<T>(calls: { method: string; params: unknown[] }[]): Promise<{ result?: T; error?: RpcError }[]> {
    if (!calls.length) return [];
    const base = nextId;
    nextId += calls.length;
    const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: base + i, method: c.method, params: c.params }));
    const json = await this.post(body);
    if (!Array.isArray(json)) {
      const single = json as RpcResponse;
      throw new RpcError(single?.error?.message ?? "batch not supported", single?.error?.code);
    }
    const out: { result?: T; error?: RpcError }[] = calls.map(() => ({ error: new RpcError("missing batch item") }));
    for (const item of json as RpcResponse[]) {
      if (typeof item?.id !== "number") continue;
      const i = item.id - base;
      if (i < 0 || i >= calls.length) continue;
      out[i] = item.error ? { error: new RpcError(item.error.message ?? "rpc error", item.error.code) } : { result: item.result as T };
    }
    return out;
  }

  getLogs(fromBlock: number, toBlock: number, filter: LogFilter): Promise<RpcLog[]> {
    return this.call<RpcLog[]>("eth_getLogs", [logParams(fromBlock, toBlock, filter)]);
  }

  ethCall(to: string, data: Hex): Promise<Hex> {
    return this.call<Hex>("eth_call", [{ to, data }, "latest"]);
  }
}

export function logParams(fromBlock: number, toBlock: number, filter: LogFilter): Record<string, unknown> {
  const params: Record<string, unknown> = { fromBlock: hex(fromBlock), toBlock: hex(toBlock), topics: filter.topics };
  if (filter.address !== undefined) params.address = filter.address;
  return params;
}

export function hex(n: number | bigint): string {
  return `0x${n.toString(16)}`;
}

// ─── Word-level decoding helpers (static ABI words) ─────────────────

export function word(data: string, i: number): bigint {
  const start = 2 + i * 64;
  const w = data.slice(start, start + 64);
  return w.length === 64 ? BigInt(`0x${w}`) : 0n;
}

/** Signed int from a sign-extended 256-bit ABI word (int24/int128/…). */
export function sword(data: string, i: number): bigint {
  const v = word(data, i);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

export function wordAddr(data: string, i: number): string {
  const start = 2 + i * 64 + 24;
  return `0x${data.slice(start, start + 40)}`.toLowerCase();
}

export function topicAddr(topic: string | undefined): string {
  return topic ? `0x${topic.slice(26)}`.toLowerCase() : "";
}

export function num(v: string | undefined): number {
  return v ? Number.parseInt(v, 16) : 0;
}

/** bigint → float with `decimals` (safe for display-grade math). */
export function fmt(v: bigint, decimals = 18): number {
  if (v === 0n) return 0;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = a % base;
  const n = Number(whole) + Number(frac) / Number(base);
  return neg ? -n : n;
}

/** Ratio of two bigints as float (handles huge values without overflow). */
export function ratio(a: bigint, b: bigint): number {
  if (b === 0n) return 0;
  const scale = 10n ** 18n;
  return Number((a * scale) / b) / 1e18;
}

// ─── Multicall3 (canonical address; verified deployed on HOOD via eth_getCode) ───

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MC3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export interface McCall {
  target: string;
  callData: Hex;
}

export interface McResult {
  success: boolean;
  returnData: Hex;
}

/** Multicall3.aggregate3 with allowFailure=true, chunked. Failed chunks yield failed results. */
export async function multicall(rpc: JsonRpc, calls: McCall[], chunk = 150): Promise<McResult[]> {
  const out: McResult[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const part = calls.slice(i, i + chunk);
    try {
      const data = encodeFunctionData({
        abi: MC3_ABI,
        functionName: "aggregate3",
        args: [part.map((c) => ({ target: c.target as Hex, allowFailure: true, callData: c.callData }))],
      });
      const raw = await rpc.ethCall(MULTICALL3, data);
      const decoded = decodeFunctionResult({ abi: MC3_ABI, functionName: "aggregate3", data: raw });
      for (const r of decoded) out.push({ success: r.success, returnData: r.returnData });
    } catch {
      for (let k = 0; k < part.length; k++) out.push({ success: false, returnData: "0x" });
    }
  }
  return out;
}
