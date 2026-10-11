// Uniswap v4 PoolManager Swap tracker, filtered by the PoolIds of tokens we index
// (Pons graduated pools, Clanker / Pools instant pools, Bags migrated pools).
//
// Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96,
//      uint128 liquidity, int24 tick, uint24 fee)
// topic0 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f — verified on HOOD PoolManager
// (1095 swaps for a Pons graduated pool in 50k blocks). Amounts are the swapper's deltas: negative = paid in,
// positive = received (a buy has quoteDelta < 0, tokenDelta > 0).
//
// `sender` is the router, not the user → trader = tx.from via a batched eth_getTransactionByHash.

import { encodeAbiParameters, keccak256, type Hex } from "viem";
import type { Trade } from "@shared/types";
import { tokenStore } from "../../store";
import { txSenders } from "./calls";
import { num, sword, topicAddr, word, type RpcLog } from "./rpc";
import type { Adapter, PollCtx } from "./poller";

export const V4_SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
export const HOOD_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

export interface V4PoolReg {
  key: string;
  poolId: string;
  /** Which currency is the memecoin; "auto" infers it from the first swap (the side with the larger amount). */
  token: "c0" | "c1" | "auto";
  quoteDecimals?: number;
  tokenDecimals?: number;
}

interface PoolState extends V4PoolReg {
  lastSeen: number;
}

interface PendingSwap {
  pool: PoolState;
  log: RpcLog;
  a0: bigint;
  a1: bigint;
  sqrtP: bigint;
  liq: bigint;
  sender: string;
}

/** keccak256(abi.encode(PoolKey)) — verified against a live Pons pool (ETH / token / fee 0 / ts 200 / MemeHook). */
export function v4PoolId(currency0: string, currency1: string, fee: number, tickSpacing: number, hooks: string): string {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [currency0 as Hex, currency1 as Hex, fee, tickSpacing, hooks as Hex],
    ),
  ).toLowerCase();
}

export class V4Tracker implements Adapter {
  readonly name = "uniswap-v4";
  private pools = new Map<string, PoolState>();
  private pending: PendingSwap[] = [];

  constructor(private readonly poolManager: string, private readonly maxPools = 400) {}

  add(reg: V4PoolReg): void {
    const id = reg.poolId.toLowerCase();
    const prev = this.pools.get(id);
    this.pools.set(id, { ...prev, ...reg, poolId: id, lastSeen: Date.now() });
    if (this.pools.size > this.maxPools) {
      let oldest: string | undefined;
      let oldestTs = Infinity;
      for (const [k, p] of this.pools) {
        if (p.lastSeen < oldestTs) {
          oldestTs = p.lastSeen;
          oldest = k;
        }
      }
      if (oldest) this.pools.delete(oldest);
    }
  }

  size(): number {
    return this.pools.size;
  }

  readonly subs = [
    {
      filters: () => {
        if (!this.pools.size) return null;
        const ids = [...this.pools.keys()];
        const out = [];
        for (let i = 0; i < ids.length; i += 100) out.push({ address: this.poolManager, topics: [V4_SWAP_TOPIC, ids.slice(i, i + 100)] });
        return out;
      },
      onLog: (log: RpcLog) => {
        const pool = this.pools.get((log.topics[1] ?? "").toLowerCase());
        if (!pool) return;
        pool.lastSeen = Date.now();
        this.pending.push({
          pool,
          log,
          a0: sword(log.data, 0),
          a1: sword(log.data, 1),
          sqrtP: word(log.data, 2),
          liq: word(log.data, 3),
          sender: topicAddr(log.topics[2]),
        });
      },
    },
  ];

  async afterBatch(ctx: PollCtx): Promise<void> {
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    const senders = await txSenders(ctx.rpc, [...new Set(batch.map((p) => p.log.transactionHash))]);
    for (const p of batch) {
      const { pool, log } = p;
      if (!tokenStore.has(pool.key)) {
        this.pools.delete(pool.poolId); // evicted from the board → stop tracking
        continue;
      }
      const qDec = pool.quoteDecimals ?? 18;
      const tDec = pool.tokenDecimals ?? 18;
      if (pool.token === "auto") {
        // Memecoins are priced far below 1 quote unit → the token side moves the larger human amount.
        const abs0 = Math.abs(Number(p.a0));
        const abs1 = Math.abs(Number(p.a1));
        pool.token = abs0 >= abs1 ? "c0" : "c1";
      }
      const tokenIs0 = pool.token === "c0";
      const tokenDelta = tokenIs0 ? p.a0 : p.a1;
      const quoteDelta = tokenIs0 ? p.a1 : p.a0;
      if (tokenDelta === 0n || quoteDelta === 0n) continue;
      const side: Trade["side"] = tokenDelta > 0n ? "buy" : "sell";
      const amountToken = Math.abs(Number(tokenDelta)) / 10 ** tDec;
      const amountNative = Math.abs(Number(quoteDelta)) / 10 ** qDec;

      // Spot price from sqrtPriceX96: price(c1 per c0) in raw units = (sqrtP / 2^96)^2.
      const s = Number(p.sqrtP) / 2 ** 96;
      const dec0 = tokenIs0 ? tDec : qDec;
      const dec1 = tokenIs0 ? qDec : tDec;
      const p1per0 = s * s * 10 ** (dec0 - dec1);
      const spot = tokenIs0 ? p1per0 : p1per0 > 0 ? 1 / p1per0 : 0;
      // Active-liquidity virtual reserves (exact for full-range pools like Pons; approximate for concentrated).
      const L = Number(p.liq);
      const quoteReserveRaw = s > 0 ? (tokenIs0 ? L * s : L / s) : 0;
      const liquidityNative = (2 * quoteReserveRaw) / 10 ** qDec;
      const block = num(log.blockNumber);

      tokenStore.addTrade(
        {
          id: `${log.transactionHash}:${num(log.logIndex)}`,
          key: pool.key,
          chain: ctx.chain,
          tx: log.transactionHash,
          block,
          ts: ctx.blockTs(block, log),
          side,
          trader: senders.get(log.transactionHash) ?? p.sender,
          amountToken,
          amountNative,
          amountUsd: 0,
          priceUsd: 0,
          mcapUsd: 0,
          tags: [],
        },
        {
          spotPriceNative: Number.isFinite(spot) && spot > 0 ? spot : undefined,
          liquidityNative: Number.isFinite(liquidityNative) ? liquidityNative : undefined,
        },
      );
    }
  }
}
