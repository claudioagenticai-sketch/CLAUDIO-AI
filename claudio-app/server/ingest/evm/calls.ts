// View-call helpers on top of Multicall3: selector encoding + safe result decoding.

import { decodeAbiParameters, hexToString, toFunctionSelector, type Hex } from "viem";
import { multicall, word, type JsonRpc, type McCall, type McResult } from "./rpc";

const selCache = new Map<string, Hex>();

/** 4-byte selector for a no-arg call, e.g. sel("symbol()"). */
export function sel(signature: string): Hex {
  let s = selCache.get(signature);
  if (!s) {
    s = toFunctionSelector(signature);
    selCache.set(signature, s);
  }
  return s;
}

export function call(target: string, signature: string): McCall {
  return { target, callData: sel(signature) };
}

function ok(r: McResult | undefined): r is McResult {
  return !!r && r.success && r.returnData.length >= 66;
}

export function decStr(r: McResult | undefined, max = 2048): string | undefined {
  if (!ok(r)) return undefined;
  try {
    const [s] = decodeAbiParameters([{ type: "string" }], r.returnData);
    return s.replace(/\u0000/g, "").trim().slice(0, max);
  } catch {
    // bytes32-style name/symbol (old tokens)
    try {
      return hexToString(r.returnData.slice(0, 66) as Hex).replace(/\u0000/g, "").trim().slice(0, max) || undefined;
    } catch {
      return undefined;
    }
  }
}

export function decStrings(r: McResult | undefined, count: number): string[] | undefined {
  if (!ok(r)) return undefined;
  try {
    const params = Array.from({ length: count }, () => ({ type: "string" as const }));
    const out = decodeAbiParameters(params, r.returnData) as readonly unknown[];
    return out.map((v) => (typeof v === "string" ? v.trim() : ""));
  } catch {
    return undefined;
  }
}

export function decUint(r: McResult | undefined, index = 0): bigint | undefined {
  if (!ok(r)) return undefined;
  if (r.returnData.length < 2 + (index + 1) * 64) return undefined;
  return word(r.returnData, index);
}

export function decAddr(r: McResult | undefined): string | undefined {
  if (!ok(r)) return undefined;
  return `0x${r.returnData.slice(26, 66)}`.toLowerCase();
}

export interface Erc20Info {
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: bigint;
}

const erc20Cache = new Map<string, Erc20Info>();

/** name/symbol/decimals/totalSupply for many tokens via one multicall (cached per address). */
export async function erc20Info(rpc: JsonRpc, addrs: string[]): Promise<Map<string, Erc20Info>> {
  const out = new Map<string, Erc20Info>();
  const need: string[] = [];
  for (const a of addrs) {
    const k = a.toLowerCase();
    const c = erc20Cache.get(k);
    if (c) out.set(k, c);
    else if (!need.includes(k)) need.push(k);
  }
  if (!need.length) return out;
  const calls: McCall[] = [];
  for (const a of need) calls.push(call(a, "name()"), call(a, "symbol()"), call(a, "decimals()"), call(a, "totalSupply()"));
  const res = await multicall(rpc, calls);
  need.forEach((a, i) => {
    const dec = decUint(res[i * 4 + 2]);
    const info: Erc20Info = {
      name: decStr(res[i * 4], 64),
      symbol: decStr(res[i * 4 + 1], 16),
      decimals: dec !== undefined && dec < 78n ? Number(dec) : undefined,
      totalSupply: decUint(res[i * 4 + 3]),
    };
    if (info.symbol !== undefined) {
      erc20Cache.set(a, info);
      if (erc20Cache.size > 20_000) {
        const first = erc20Cache.keys().next().value;
        if (first !== undefined) erc20Cache.delete(first);
      }
    }
    out.set(a, info);
  });
  return out;
}

/** tx.from for many tx hashes via one JSON-RPC batch (cached). */
const fromCache = new Map<string, string>();
export async function txSenders(rpc: JsonRpc, hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need: string[] = [];
  for (const h of hashes) {
    const c = fromCache.get(h);
    if (c) out.set(h, c);
    else if (!need.includes(h)) need.push(h);
  }
  for (let i = 0; i < need.length; i += 100) {
    const part = need.slice(i, i + 100);
    try {
      const res = await rpc.batch<{ from?: string } | null>(part.map((h) => ({ method: "eth_getTransactionByHash", params: [h] })));
      part.forEach((h, k) => {
        const from = res[k]?.result?.from;
        if (typeof from === "string") {
          const f = from.toLowerCase();
          out.set(h, f);
          fromCache.set(h, f);
        }
      });
    } catch {
      /* caller falls back to the event's sender */
    }
  }
  if (fromCache.size > 50_000) fromCache.clear();
  return out;
}
