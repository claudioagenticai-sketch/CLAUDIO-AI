// Bags on Robinhood Chain — x·y=k curve (virtual reserves) → Uniswap v4 (locked LP).
//
// Factory proxy 0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37 → impl 0x7dfa0131f6c8626f199a2e33e49dfb5660e6ef1c
// (ABI from Sourcify chain 4663). graduationThreshold() = 5 ETH (cast call, 2026-09-27).
//   TokenCreated(address indexed token,address indexed curve,address indexed creator,address feeShare,address partner,
//                bytes32 poolId,string name,string symbol,string metadataURI)
//     0x643b3b606052cbadac2f906ad0b462da99eda2a1d4f824d315d7f6edd3e4cced — verified (3 logs / 50k blocks)
// Curve (beacon impl 0x419890a21711c3D3Af46B58548376420B9723275, Sourcify ABI):
//   TokensBought(address indexed buyer,address indexed recipient,uint256 grossQuoteIn,uint256 netQuoteIn,uint256 tokensOut,
//     uint256 feeQuote,uint256 vaultFeeQuote,uint256 creatorFeeWETH,uint256 refundQuote,uint256 price,
//     uint256 virtualTokenReserves,uint256 virtualQuoteReserves)
//     0x6d9c6fad0db13f6f7fca7124777996deaeb1949d0750a4874c18611ff5d436b9 — verified (1 log / 50k blocks)
//   TokensSold(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 grossQuoteOut,
//     uint256 netQuoteToRecipient,uint256 feeQuote,uint256 vaultFeeQuote,uint256 creatorFeeWETH,uint256 price,
//     uint256 virtualTokenReserves,uint256 virtualQuoteReserves)
//     0x813ea2e4b7710a4562c34494d61d6e80fd2ba5105790f740fdcbf64f8b05b80d — from ABI, not yet seen live
//   Migrated(address indexed creator,address indexed platformAdmin,address indexed token,uint256 lpQuote,
//     uint256 lpTokens,bytes32 poolId,uint160 sqrtPriceX96)
//     0x184d2c0f181283dda427e7607f9f42c0c50de3c6aa3fdee4602f68fde61751cb — from ABI, not yet seen live

import { decodeAbiParameters, type Hex } from "viem";
import { blankToken, tokenStore } from "../../../store";
import { fetchMeta } from "../../meta";
import { call, decUint } from "../calls";
import { fmt, multicall, num, ratio, topicAddr, word, type RpcLog } from "../rpc";
import type { Adapter, PollCtx } from "../poller";
import type { V4Tracker } from "../v4";

const FACTORY = "0xe8cc4431adf8b5a847c113ef0c6af9043219cb37";
const T_CREATED = "0x643b3b606052cbadac2f906ad0b462da99eda2a1d4f824d315d7f6edd3e4cced";
const T_BOUGHT = "0x6d9c6fad0db13f6f7fca7124777996deaeb1949d0750a4874c18611ff5d436b9";
const T_SOLD = "0x813ea2e4b7710a4562c34494d61d6e80fd2ba5105790f740fdcbf64f8b05b80d";
const T_MIGRATED = "0x184d2c0f181283dda427e7607f9f42c0c50de3c6aa3fdee4602f68fde61751cb";
const BOOTSTRAP_BLOCKS = 100_000; // Bags is low-volume → look further back (2 × 50k-block calls)

export function bagsAdapter(v4: V4Tracker): Adapter {
  const curves = new Map<string, { key: string; token: string }>();
  const touched = new Set<string>();

  function onCreated(log: RpcLog, ctx: PollCtx): void {
    const token = topicAddr(log.topics[1]);
    const curve = topicAddr(log.topics[2]);
    const creator = topicAddr(log.topics[3]);
    const [feeShare, , poolId, name, symbol, uri] = decodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "string" }, { type: "string" }, { type: "string" }],
      log.data as Hex,
    );
    const block = num(log.blockNumber);
    const key = `hood:${token}`;
    curves.set(curve, { key, token });
    tokenStore.register(
      blankToken({
        chain: "hood",
        address: token,
        launchpad: "bags",
        name: name.slice(0, 64) || "Unknown",
        symbol: symbol.slice(0, 16) || "???",
        creator,
        createdAt: ctx.blockTs(block, log),
        createTx: log.transactionHash,
        pool: curve,
      }),
      { excluded: [curve, FACTORY, feeShare.toLowerCase()], createBlock: block, trackedFromCreation: block >= ctx.startBlock },
    );
    touched.add(curve);
    // Post-migration pool: orientation inferred from the first swap (pair may be native ETH or WETH).
    v4.add({ key, poolId: poolId.toLowerCase(), token: "auto", quoteDecimals: 18, tokenDecimals: 18 });
    if (uri) {
      void fetchMeta(uri).then((m) => {
        if (m) tokenStore.patch(key, { image: m.image, description: m.description, socials: m.socials });
      });
    }
  }

  function onCurveLog(log: RpcLog, ctx: PollCtx): void {
    const curve = log.address.toLowerCase();
    const info = curves.get(curve);
    if (!info) return;
    const block = num(log.blockNumber);
    const t0 = log.topics[0];
    if (t0 === T_MIGRATED) {
      const poolId = `0x${log.data.slice(2 + 2 * 64, 2 + 3 * 64)}`;
      tokenStore.migrate(info.key, { venue: "uniswap-v4", pool: poolId, at: ctx.blockTs(block, log) });
      return;
    }
    const isBuy = t0 === T_BOUGHT;
    const tokens = fmt(word(log.data, isBuy ? 2 : 0), 18);
    // Buy words: grossQuoteIn 0, netQuoteIn 1, tokensOut 2, fee 3, vaultFee 4, creatorFee 5, refund 6, price 7, vToken 8, vQuote 9
    // Sell words: tokensIn 0, grossQuoteOut 1, netToRecipient 2, fee 3, vaultFee 4, creatorFee 5, price 6, vToken 7, vQuote 8
    const grossIn = word(log.data, 0) - word(log.data, 6);
    const quote = isBuy ? fmt(grossIn > 0n ? grossIn : 0n, 18) : fmt(word(log.data, 1), 18);
    const vToken = word(log.data, isBuy ? 8 : 7);
    const vQuote = word(log.data, isBuy ? 9 : 8);
    tokenStore.addTrade(
      {
        id: `${log.transactionHash}:${num(log.logIndex)}`,
        key: info.key,
        chain: "hood",
        tx: log.transactionHash,
        block,
        ts: ctx.blockTs(block, log),
        side: isBuy ? "buy" : "sell",
        trader: isBuy ? topicAddr(log.topics[2]) : topicAddr(log.topics[1]),
        amountToken: tokens,
        amountNative: quote,
        amountUsd: 0,
        priceUsd: 0,
        mcapUsd: 0,
        tags: [],
      },
      { spotPriceNative: vToken > 0n ? ratio(vQuote, vToken) : undefined },
    );
    touched.add(curve);
  }

  return {
    name: "bags",
    subs: [
      { filters: () => [{ address: FACTORY, topics: [T_CREATED] }], onLog: onCreated },
      {
        filters: () => (curves.size ? [{ address: [...curves.keys()].slice(-500), topics: [[T_BOUGHT, T_SOLD, T_MIGRATED]] }] : null),
        onLog: onCurveLog,
      },
    ],
    async bootstrap(ctx) {
      const start = Math.max(1, ctx.head - BOOTSTRAP_BLOCKS);
      for (let from = start; from < ctx.startBlock; from += 50_000) {
        const to = Math.min(ctx.startBlock - 1, from + 49_999);
        const logs = await ctx.rpc.getLogs(from, to, { address: FACTORY, topics: [T_CREATED] });
        for (const l of logs) {
          try {
            onCreated(l, ctx);
          } catch {
            /* skip */
          }
        }
      }
    },
    async afterBatch(ctx) {
      if (!touched.size) return;
      const list = [...touched].slice(0, 100);
      for (const c of list) touched.delete(c);
      const res = await multicall(ctx.rpc, list.flatMap((c) => [call(c, "realQuoteReserves()"), call(c, "thresholdQuote()"), call(c, "getVirtualReserves()"), call(c, "migrated()")]));
      list.forEach((c, i) => {
        const info = curves.get(c);
        if (!info) return;
        const real = decUint(res[i * 4]);
        const thr = decUint(res[i * 4 + 1]);
        const vT = decUint(res[i * 4 + 2], 0);
        const vQ = decUint(res[i * 4 + 2], 1);
        const migrated = decUint(res[i * 4 + 3]);
        if (migrated === 1n) {
          tokenStore.migrate(info.key, { venue: "uniswap-v4" });
          return;
        }
        tokenStore.updateMarket(info.key, {
          spotPriceNative: vT && vQ && vT > 0n ? ratio(vQ, vT) : undefined,
          bondingPct: real !== undefined && thr && thr > 0n ? Math.min(100, ratio(real, thr) * 100) : undefined,
          liquidityNative: real !== undefined ? fmt(real, 18) : undefined,
        });
      });
    },
  };
}
