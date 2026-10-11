// RPC endpoints + cached clients for the browser. The ONE place to change where the client talks to chains.
// Only public data (addresses, signed txs) ever goes over these connections — never keys.

import { createPublicClient, defineChain, fallback, http, type Chain } from "viem";
import { Connection } from "@solana/web3.js";
import { CHAINS, type ChainId } from "@shared/chains";

export const RPC_CONFIG = {
  /**
   * The browser talks to Solana through our server (`solProxyPath` → SOL_RPC_URL), because Solana's public RPC answers
   * most websites' browser requests with 403 and a paid RPC key must not ship in the bundle. VITE_SOL_RPC, when set,
   * still wins (e.g. a domain-restricted frontend key).
   */
  useSolProxy: !(import.meta.env.VITE_SOL_RPC as string | undefined),
  solProxyPath: "/api/rpc/sol",
  solHttp: ((import.meta.env.VITE_SOL_RPC as string | undefined) || CHAINS.sol.publicRpc) as string,
  /** Optional per-EVM-chain override, e.g. VITE_RPC_HOOD. */
  evmOverride(chain: ChainId): string | undefined {
    const v = import.meta.env[`VITE_RPC_${chain.toUpperCase()}`] as string | undefined;
    return v || undefined;
  },
};

export function solRpcUrl(): string {
  if (RPC_CONFIG.useSolProxy && typeof window !== "undefined") {
    return new URL(RPC_CONFIG.solProxyPath, window.location.origin).toString();
  }
  return RPC_CONFIG.solHttp;
}

export function evmRpcUrl(chain: ChainId): string {
  return evmRpcUrls(chain)[0];
}

/** Override first, then the registry's public endpoints (all CORS-enabled). */
export function evmRpcUrls(chain: ChainId): string[] {
  const c = CHAINS[chain];
  const urls = [RPC_CONFIG.evmOverride(chain), c.publicRpc, ...(c.rpcFallbacks ?? [])].filter((u): u is string => !!u);
  return urls.filter((u, i) => urls.indexOf(u) === i);
}

const chainCache = new Map<ChainId, Chain>();

export function viemChain(chain: ChainId): Chain {
  const hit = chainCache.get(chain);
  if (hit) return hit;
  const c = CHAINS[chain];
  if (c.kind !== "evm" || c.evmChainId === undefined) throw new Error(`${c.name} is not an EVM chain`);
  const def: Chain = {
    id: c.evmChainId,
    name: c.name,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: c.nativeDecimals },
    rpcUrls: { default: { http: evmRpcUrls(chain) } },
    blockExplorers: c.explorer ? { default: { name: `${c.short} explorer`, url: c.explorer } } : undefined,
  };
  const out = defineChain(def) as Chain;
  chainCache.set(chain, out);
  return out;
}

function makePublicClient(chain: ChainId) {
  return createPublicClient({
    chain: viemChain(chain),
    transport: (() => {
      const urls = evmRpcUrls(chain);
      return urls.length === 1
        ? http(urls[0], { retryCount: 1, timeout: 15_000 })
        : fallback(urls.map((u) => http(u, { retryCount: 0, timeout: 15_000 })), { retryCount: 1 });
    })(),
    // Receipt polling tuned to block time (HOOD = 250ms blocks; viem's default is 4s).
    pollingInterval: Math.min(4_000, Math.max(500, CHAINS[chain].blockTimeMs * 2)),
  });
}

const publicClients = new Map<ChainId, ReturnType<typeof makePublicClient>>();

export function publicClient(chain: ChainId): ReturnType<typeof makePublicClient> {
  let c = publicClients.get(chain);
  if (!c) {
    c = makePublicClient(chain);
    publicClients.set(chain, c);
  }
  return c;
}

let solConn: { url: string; conn: Connection } | null = null;

export function solConnection(): Connection {
  const url = solRpcUrl();
  // No websocket: the proxy is HTTP-only, so confirmations poll signature statuses (see lib/wallet/send.ts).
  if (!solConn || solConn.url !== url) solConn = { url, conn: new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: false }) };
  return solConn.conn;
}

/** Chain can be queried from the browser right now. */
export function chainQueryable(chain: ChainId): boolean {
  const c = CHAINS[chain];
  return c.enabled && (c.kind === "svm" ? !!solRpcUrl() : !!evmRpcUrl(chain));
}
