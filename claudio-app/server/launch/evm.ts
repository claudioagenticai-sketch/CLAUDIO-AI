// Read-only viem helpers for the launch module (the server never signs EVM transactions).
import {
  BaseError,
  createPublicClient,
  decodeErrorResult,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { ChainId } from "@shared/chains";
import { KNOWN_ERRORS } from "./abis";
import { evmTransport } from "../rpc";

const clients = new Map<ChainId, PublicClient>();

export function evmClient(chain: ChainId): PublicClient {
  const existing = clients.get(chain);
  if (existing) return existing;
  const client = createPublicClient({
    transport: evmTransport(chain, { timeout: 15_000, retryCount: 1, launch: true }),
  }) as PublicClient;
  clients.set(chain, client);
  return client;
}

/** Best-effort human reason for a failed eth_call / estimateGas (decodes custom errors we know). */
export function describeEvmError(e: unknown): string {
  if (e instanceof BaseError) {
    const withData = e.walk((x) => {
      const d = (x as { data?: unknown }).data;
      return typeof d === "string" && d.startsWith("0x") && d.length >= 10;
    }) as unknown as { data?: string } | null;
    const data = withData?.data;
    if (data) {
      try {
        const decoded = decodeErrorResult({ abi: KNOWN_ERRORS, data: data as Hex });
        const args = (decoded.args ?? []) as readonly unknown[];
        const argStr = args.map((a) => (typeof a === "bigint" ? a.toString() : String(a))).join(", ");
        return `${decoded.errorName}(${argStr})`;
      } catch {
        return `reverted with data ${data.slice(0, 10)}`;
      }
    }
    return e.shortMessage || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export interface EvmSimResult {
  ok: boolean;
  error?: string;
  gas?: bigint;
}

/** eth_call + estimateGas as the creator. Never throws. */
export async function simulateEvm(
  chain: ChainId,
  tx: { from: Address; to: Address; data: Hex; value: bigint },
): Promise<EvmSimResult> {
  const c = evmClient(chain);
  try {
    await c.call({ account: tx.from, to: tx.to, data: tx.data, value: tx.value });
  } catch (e) {
    return { ok: false, error: describeEvmError(e) };
  }
  try {
    const gas = await c.estimateGas({ account: tx.from, to: tx.to, data: tx.data, value: tx.value });
    return { ok: true, gas };
  } catch (e) {
    // call succeeded but estimate failed (e.g. balance too low for gas) — still report it.
    return { ok: false, error: describeEvmError(e) };
  }
}

export async function gasPriceWei(chain: ChainId): Promise<bigint | undefined> {
  try {
    return await evmClient(chain).getGasPrice();
  } catch {
    return undefined;
  }
}
