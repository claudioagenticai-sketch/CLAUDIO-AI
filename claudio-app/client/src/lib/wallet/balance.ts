// Balance reads over public RPC (addresses only — no secrets involved).

import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatUnits, type Address } from "viem";
import { PublicKey } from "@solana/web3.js";
import { CHAINS, type ChainId } from "@shared/chains";
import { isEvmAddress, isSolAddress } from "./keys";
import { chainQueryable, publicClient, solConnection } from "./rpc";

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export function addressFitsChain(chain: ChainId, address?: string): address is string {
  if (!address) return false;
  return CHAINS[chain].kind === "evm" ? isEvmAddress(address) : isSolAddress(address);
}

export async function fetchNativeBalance(chain: ChainId, address: string): Promise<number> {
  const c = CHAINS[chain];
  if (c.kind === "evm") {
    const wei = await publicClient(chain).getBalance({ address: address as Address });
    return Number(formatUnits(wei, c.nativeDecimals));
  }
  const lamports = await solConnection().getBalance(new PublicKey(address), "confirmed");
  return lamports / 10 ** c.nativeDecimals;
}

export function useNativeBalance(chain: ChainId, address?: string): { balance?: number; loading: boolean } {
  const enabled = addressFitsChain(chain, address) && chainQueryable(chain);
  const q = useQuery({
    queryKey: ["wallet", "native", chain, address ?? ""],
    queryFn: () => fetchNativeBalance(chain, address as string),
    enabled,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
  });
  return { balance: q.data, loading: enabled && q.isLoading };
}

// ─── Token balances (portfolio) ─────────────────────────────────────

/** address(lowercase for EVM) → human balance */
export type TokenBalances = Record<string, number>;

export async function fetchEvmTokenBalances(chain: ChainId, owner: string, tokens: string[]): Promise<TokenBalances> {
  const client = publicClient(chain);
  const out: TokenBalances = {};
  const unique = Array.from(new Set(tokens.filter(isEvmAddress).map((t) => t.toLowerCase())));
  // Small concurrency window: public RPCs rate-limit aggressively and HOOD has no canonical multicall3 here.
  const WINDOW = 6;
  for (let i = 0; i < unique.length; i += WINDOW) {
    const slice = unique.slice(i, i + WINDOW);
    await Promise.all(
      slice.map(async (token) => {
        try {
          const [raw, decimals] = await Promise.all([
            client.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] }),
            client.readContract({ address: token as Address, abi: erc20Abi, functionName: "decimals" }),
          ]);
          out[token] = Number(formatUnits(raw, decimals));
        } catch {
          /* token unreadable — leave undefined */
        }
      }),
    );
  }
  return out;
}

export async function fetchSolTokenBalances(owner: string): Promise<TokenBalances> {
  const conn = solConnection();
  const ownerPk = new PublicKey(owner);
  const out: TokenBalances = {};
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const results = await Promise.allSettled(programs.map((p) => conn.getParsedTokenAccountsByOwner(ownerPk, { programId: new PublicKey(p) })));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const { account } of r.value.value) {
      const info = (account.data.parsed as { info?: { mint?: string; tokenAmount?: { uiAmount?: number | null; uiAmountString?: string } } } | undefined)?.info;
      const mint = info?.mint;
      if (!mint) continue;
      const amt = info?.tokenAmount?.uiAmount ?? Number(info?.tokenAmount?.uiAmountString ?? 0);
      out[mint] = (out[mint] ?? 0) + (Number.isFinite(amt) ? amt : 0);
    }
  }
  if (results.every((r) => r.status === "rejected")) throw new Error("Solana RPC unavailable");
  return out;
}
