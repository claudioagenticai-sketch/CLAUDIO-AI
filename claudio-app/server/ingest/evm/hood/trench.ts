// Trench (trench.today) on Robinhood Chain — virtual-reserve bonding curve; all events via one factory proxy.
//
// Proxy 0x77dc6f6361b7b99456fc3761ce5b7dda80d83f9d (no Sourcify match). Field names from Bitquery docs,
// types matched against live topic0s (2026-09-27, 3M-block scan: only these three topics appear, very low volume):
//   TokenPurchase(address indexed token,address indexed buyer,uint256 amountOut,uint256 quoteAmountUsed,
//                 uint256 protocolFee,uint256 extraFee,address extraFeeReceiver,uint256 extraFeeRate)
//     0xb284604a447841f5b5ee1495033bc7db1ab2f84c2624a7b7a3e9f014f32e8e7b — verified
//   TokenSale(address indexed token,address indexed seller,uint256 amountIn,uint256 netQuoteOut,uint256 protocolFee,
//             uint256 extraFee,address extraFeeReceiver)
//     0xfe41490121bfbd4555a4f9aabe1e789de1641611b7edd2a0dc1c594f684ba193 — verified
//   Sync(address indexed token,uint256 realQuoteReserves,uint256 realTokenReserves,uint256 virtualQuote,uint256 virtualToken)
//     0x27efe2fec96cb0ff68b9206e3dca402a919bb7172e2f2d12d49b633df3eabc4f — verified (price = vQ / vT)
// UNVERIFIED: TokenCreate(address creator,address curve,address token,address quote,string name,string symbol,
//   uint256 timestamp,string tokenURI) → 0xe2eb7016…df1b (all-non-indexed guess). Never observed in 3M blocks, so
//   tokens are discovered lazily from their first trade (ERC-20 name/symbol read). createdAt = first seen.
// Bonding %: graduation threshold unknown → assumes the curve holds the full supply and graduates at 80% sold.

import { decodeAbiParameters, type Hex } from "viem";
import { blankToken, tokenStore } from "../../../store";
import { fetchMeta } from "../../meta";
import { erc20Info } from "../calls";
import { fmt, num, ratio, topicAddr, word, type RpcLog } from "../rpc";
import type { Adapter, PollCtx } from "../poller";

const PROXY = "0x77dc6f6361b7b99456fc3761ce5b7dda80d83f9d";
const T_PURCHASE = "0xb284604a447841f5b5ee1495033bc7db1ab2f84c2624a7b7a3e9f014f32e8e7b";
const T_SALE = "0xfe41490121bfbd4555a4f9aabe1e789de1641611b7edd2a0dc1c594f684ba193";
const T_SYNC = "0x27efe2fec96cb0ff68b9206e3dca402a919bb7172e2f2d12d49b633df3eabc4f";
const T_CREATE_GUESS = "0xe2eb7016a2fc7f0aec441cc8bc9a7ecd75d29d94478782bab1cfa9c5b0dbdf1b";
const ASSUMED_SOLD_AT_GRAD = 0.8;

export function trenchAdapter(): Adapter {
  const unknown = new Map<string, RpcLog[]>(); // token → logs waiting for discovery
  const supplies = new Map<string, number>();

  function handle(log: RpcLog, ctx: PollCtx): void {
    const token = topicAddr(log.topics[1]);
    const key = `hood:${token}`;
    if (!tokenStore.has(key)) {
      let q = unknown.get(token);
      if (!q) {
        if (unknown.size > 200) return;
        q = [];
        unknown.set(token, q);
      }
      if (q.length < 50) q.push(log);
      return;
    }
    const block = num(log.blockNumber);
    const t0 = log.topics[0];
    if (t0 === T_SYNC) {
      const realToken = fmt(word(log.data, 1), 18);
      const vQ = word(log.data, 2);
      const vT = word(log.data, 3);
      const supply = supplies.get(token) ?? 1e9;
      const sold = Math.max(0, supply - realToken);
      tokenStore.updateMarket(key, {
        spotPriceNative: vT > 0n ? ratio(vQ, vT) : undefined,
        bondingPct: Math.min(100, (sold / (supply * ASSUMED_SOLD_AT_GRAD)) * 100),
        liquidityNative: fmt(word(log.data, 0), 18),
      });
      return;
    }
    const isBuy = t0 === T_PURCHASE;
    tokenStore.addTrade({
      id: `${log.transactionHash}:${num(log.logIndex)}`,
      key,
      chain: "hood",
      tx: log.transactionHash,
      block,
      ts: ctx.blockTs(block, log),
      side: isBuy ? "buy" : "sell",
      trader: topicAddr(log.topics[2]),
      amountToken: fmt(word(log.data, 0), 18),
      amountNative: fmt(word(log.data, 1), 18),
      amountUsd: 0,
      priceUsd: 0,
      mcapUsd: 0,
      tags: [],
    });
  }

  function onCreateGuess(log: RpcLog, ctx: PollCtx): void {
    // Only reached if the guessed signature is right; decode defensively.
    try {
      const [creator, curve, token, , name, symbol, ts, uri] = decodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "string" }],
        log.data as Hex,
      );
      const addr = token.toLowerCase();
      const block = num(log.blockNumber);
      const key = `hood:${addr}`;
      tokenStore.register(
        blankToken({
          chain: "hood",
          address: addr,
          launchpad: "trench",
          name: name.slice(0, 64) || "Unknown",
          symbol: symbol.slice(0, 16) || "???",
          creator: creator.toLowerCase(),
          createdAt: Number(ts) * 1000 || ctx.blockTs(block, log),
          createTx: log.transactionHash,
          pool: curve.toLowerCase(),
        }),
        { excluded: [PROXY, curve.toLowerCase()], createBlock: block, trackedFromCreation: block >= ctx.startBlock },
      );
      if (uri) void fetchMeta(uri).then((m) => m && tokenStore.patch(key, { image: m.image, description: m.description, socials: m.socials }));
    } catch {
      /* guessed layout wrong → ignore */
    }
  }

  return {
    name: "trench",
    subs: [
      {
        filters: () => [{ address: PROXY, topics: [[T_PURCHASE, T_SALE, T_SYNC, T_CREATE_GUESS]] }],
        onLog: (log, ctx) => {
          if (log.topics[0] === T_CREATE_GUESS) onCreateGuess(log, ctx);
          else handle(log, ctx);
        },
      },
    ],
    async afterBatch(ctx) {
      if (!unknown.size) return;
      const tokens = [...unknown.keys()].slice(0, 30);
      const infos = await erc20Info(ctx.rpc, tokens);
      for (const token of tokens) {
        const logs = unknown.get(token) ?? [];
        unknown.delete(token);
        const info = infos.get(token);
        if (!info?.symbol) continue;
        const supply = info.totalSupply ? fmt(info.totalSupply, info.decimals ?? 18) : 1e9;
        supplies.set(token, supply);
        const first = logs[0];
        tokenStore.register(
          blankToken({
            chain: "hood",
            address: token,
            launchpad: "trench",
            name: info.name || "Unknown",
            symbol: info.symbol,
            creator: "",
            createdAt: first ? ctx.blockTs(num(first.blockNumber), first) : Date.now(),
            pool: PROXY,
          }),
          { supply, excluded: [PROXY], trackedFromCreation: false },
        );
        for (const l of logs) handle(l, ctx);
      }
    },
  };
}
