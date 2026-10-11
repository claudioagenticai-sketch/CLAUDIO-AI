// Token balances for the trade panel ("you hold …") and %-sells. Read-only RPC calls.
import { getAddress, isAddress } from "viem";
import { CHAINS } from "@shared/chains";
import type { TokenSnapshot } from "@shared/types";
import { ERC20_ABI } from "./abis";
import { evmClient, fromUnits } from "./evm";
import { TradeError } from "./types";
import { primaryRpc } from "../rpc";

const decimalsCache = new Map<string, number>();

export function solRpcUrl(): string {
  return primaryRpc("sol");
}

interface ParsedTokenAccount {
  account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null; amount: string; decimals: number } } } } };
}

/** Sum of the owner's token accounts for `mint` (SPL + Token-2022, since we filter by mint). Human units. */
export async function svmTokenBalance(mint: string, owner: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(solRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    throw new TradeError(502, "rpc_unreachable", `Solana RPC unreachable: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as { result?: { value: ParsedTokenAccount[] }; error?: { message: string } } | null;
  if (!json || json.error || !json.result) {
    throw new TradeError(502, "rpc_error", `Solana RPC error: ${json?.error?.message ?? res.statusText}`);
  }
  let total = 0;
  for (const acc of json.result.value) {
    const ta = acc.account.data.parsed.info.tokenAmount;
    total += ta.uiAmount ?? Number(ta.amount) / 10 ** ta.decimals;
  }
  return total;
}

export async function evmTokenBalance(token: TokenSnapshot, owner: string): Promise<number> {
  if (!isAddress(owner) || !isAddress(token.address)) throw new TradeError(400, "bad_address", "Invalid EVM address.");
  const client = evmClient(token.chain);
  const addr = getAddress(token.address);
  const cacheKey = token.key;
  let decimals = decimalsCache.get(cacheKey);
  const balP = client.readContract({ address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [getAddress(owner)] });
  if (decimals === undefined) {
    const d = await client.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" });
    decimals = Number(d);
    decimalsCache.set(cacheKey, decimals);
  }
  const bal = (await balP) as bigint;
  return fromUnits(bal, decimals);
}

export async function tokenBalance(token: TokenSnapshot, owner: string): Promise<number> {
  const info = CHAINS[token.chain];
  if (info.kind === "svm") return svmTokenBalance(token.address, owner);
  if (!info.enabled || !info.publicRpc) throw new TradeError(501, "chain_unsupported", `${info.name} balances aren't available yet.`);
  return evmTokenBalance(token, owner);
}
