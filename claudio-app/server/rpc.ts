// One source of truth for RPC endpoints. Order: env override(s) first, then the registry's public list.
//   <CHAIN>_RPC_URL  (comma-separated for several; SOL_RPC_URL and SOLANA_RPC_URL both work for Solana)
//   <CHAIN>_WS_URL   (comma-separated)
//   <CHAIN>_LAUNCH_RPC_URL  launch module only (plans, simulations, splitter reads), tried before the list above, so a
//                           paid endpoint is spent on launches and never on the feed pollers or trading.
import { fallback, http, type Transport } from "viem";
import { CHAINS, type ChainId } from "@shared/chains";
import { netEnvName } from "./network";

function list(...values: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const part of (v ?? "").split(",")) {
      const t = part.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

// On testnet (CLAUDIO_NETWORK=testnet) these become HOOD_RPC_URL_TESTNET etc., so a mainnet endpoint is never used there.
function envNames(chain: ChainId, suffix: "RPC_URL" | "WS_URL" | "LAUNCH_RPC_URL"): string[] {
  const names = chain === "sol" ? [`SOL_${suffix}`, `SOLANA_${suffix}`] : [`${chain.toUpperCase()}_${suffix}`];
  return names.map(netEnvName);
}

/** True when an operator configured a private endpoint (pollers can then run faster). */
export function hasCustomRpc(chain: ChainId): boolean {
  return envNames(chain, "RPC_URL").some((n) => !!process.env[n]?.trim());
}

export function rpcUrls(chain: ChainId): string[] {
  const info = CHAINS[chain];
  return list(...envNames(chain, "RPC_URL").map((n) => process.env[n]), info.publicRpc, ...(info.rpcFallbacks ?? []));
}

/** Launch-only endpoints first, then the shared list. */
export function launchRpcUrls(chain: ChainId): string[] {
  return list(...envNames(chain, "LAUNCH_RPC_URL").map((n) => process.env[n]), ...rpcUrls(chain));
}

export function wsUrls(chain: ChainId): string[] {
  const info = CHAINS[chain];
  // Opt-in only: a newHeads socket makes the pollers query once per block (see docs/research/rpc.md).
  return list(...envNames(chain, "WS_URL").map((n) => process.env[n]), info.publicWs);
}

export function primaryRpc(chain: ChainId): string {
  return rpcUrls(chain)[0] ?? "";
}

/** viem transport that fails over across every configured endpoint (429s and outages move to the next one). */
export function evmTransport(chain: ChainId, opts: { timeout?: number; retryCount?: number; launch?: boolean } = {}): Transport {
  const urls = opts.launch ? launchRpcUrls(chain) : rpcUrls(chain);
  if (!urls.length) throw new Error(`No RPC configured for ${CHAINS[chain].name}`);
  const transports = urls.map((u) => http(u, { timeout: opts.timeout ?? 10_000, retryCount: 0 }));
  return transports.length === 1 ? http(urls[0], { timeout: opts.timeout, retryCount: opts.retryCount }) : fallback(transports, { retryCount: opts.retryCount ?? 1 });
}
