// Lazily-created viem public clients per EVM chain (read-only; the server never signs).
import { createPublicClient, defineChain, type PublicClient } from "viem";
import { CHAINS, type ChainId } from "@shared/chains";
import { evmTransport, primaryRpc } from "../rpc";

const clients = new Map<ChainId, PublicClient>();

/** Canonical Multicall3. Runtime code verified present on Robinhood Chain (4663) via `cast code` on 2026-09-27. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export function rpcUrl(chain: ChainId): string {
  return primaryRpc(chain);
}

/** viem chain definition for an EVM chain in the registry (used by public and wallet clients). */
export function viemChainFor(chain: ChainId) {
  const info = CHAINS[chain];
  if (info.kind !== "evm" || !info.evmChainId) throw new Error(`${chain} is not an EVM chain`);
  return defineChain({
    id: info.evmChainId,
    name: info.name,
    nativeCurrency: { name: info.nativeSymbol, symbol: info.nativeSymbol, decimals: info.nativeDecimals },
    rpcUrls: { default: { http: [rpcUrl(chain)] } },
    blockExplorers: info.explorer ? { default: { name: "Explorer", url: info.explorer } } : undefined,
  });
}

export function evmClient(chain: ChainId): PublicClient {
  const existing = clients.get(chain);
  if (existing) return existing;
  const info = CHAINS[chain];
  if (info.kind !== "evm" || !info.evmChainId) throw new Error(`${chain} is not an EVM chain`);
  const url = rpcUrl(chain);
  if (!url) throw new Error(`No RPC configured for ${info.name}`);
  const viemChain = viemChainFor(chain);
  // No JSON-RPC batching: when the public HOOD RPC rate-limits it answers a batch with a single error object, which
  // viem's batch parser can't handle. Routes fold their reads into one Multicall3 eth_call instead (MULTICALL3).
  const client = createPublicClient({ chain: viemChain, transport: evmTransport(chain, { timeout: 8_000, retryCount: 2 }) }) as PublicClient;
  clients.set(chain, client);
  return client;
}

// NOTE: tsconfig has no `target` (TS default ES5), so bigint *literals* (`10n`) and bigint `**` don't type-check.
// Use these constants/helpers instead.
export const B0 = BigInt(0);
export const B1 = BigInt(1);
export const B100 = BigInt(100);
export const BPS = BigInt(10_000);

export function pow10(decimals: number): bigint {
  let r = B1;
  const ten = BigInt(10);
  for (let i = 0; i < decimals; i++) r *= ten;
  return r;
}

export function bmin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** bigint → human number (loses precision past ~15 significant digits; fine for display/quotes). */
export function fromUnits(v: bigint, decimals: number): number {
  const base = pow10(decimals);
  const whole = v / base;
  const frac = v % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** Human number → bigint base units without float-string pitfalls (e.g. 1e-7 → "0.0000001"). */
export function toUnits(v: number, decimals: number): bigint {
  if (!Number.isFinite(v) || v <= 0) return B0;
  // 12 dp avoids binary-float noise (0.1 → "0.100000000000"); never exponent notation for v < 1e21.
  const fixed = v.toFixed(Math.min(decimals, 12));
  const [w, f = ""] = fixed.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w) * pow10(decimals) + BigInt(frac || "0");
}
