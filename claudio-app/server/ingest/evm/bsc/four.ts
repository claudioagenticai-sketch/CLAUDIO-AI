// Four.meme on BSC — TokenManager2 0x5c952063c7fc8610FFDB798152D69F0B9550762b (all event args non-indexed).
//
// Verified live 2026-09-27 via bsc-rpc.publicnode.com (bsc-dataseed.bnbchain.org rejects eth_getLogs: -32005):
//   TokenCreate(address creator,address token,uint256 requestId,string name,string symbol,uint256 totalSupply,uint256 launchTime,uint256 launchFee)
//     0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20  (4 in 100 blocks; totalSupply 1e27 raw)
//   TokenPurchase(address token,address account,uint256 price,uint256 amount,uint256 cost,uint256 fee,uint256 offers,uint256 funds)
//     0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942  (price = quote/token × 1e18; funds = quote raised)
// From the same signature list, hash computed but not observed in the sample window:
//   TokenSale(… same args …)                0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19
//   LiquidityAdded(address base,uint256 offers,address quote,uint256 funds)  0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0
// Assumptions: quote = BNB (Four also supports USDT/USD1/bStocks quotes — those tokens would be mispriced;
// the event does not carry the quote). Bonding % = funds / 18 BNB (registry graduationQuote; docs say 24).
// Images/socials live behind Four's private API → not fetched (name/symbol only).

import { decodeAbiParameters, type Hex } from "viem";
import { deploymentOf } from "@shared/launchpads";
import { blankToken, tokenStore } from "../../../store";
import { fmt, num, word, wordAddr, type RpcLog } from "../rpc";
import type { Adapter, PollCtx } from "../poller";

const MANAGER = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
const T_CREATE = "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20";
const T_PURCHASE = "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942";
const T_SALE = "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19";
const T_LIQUIDITY = "0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0";

export function fourAdapter(): Adapter {
  const grad = deploymentOf("four", "bsc")?.graduationQuote ?? 18;

  function onCreate(log: RpcLog, ctx: PollCtx): void {
    const [creator, token, , name, symbol, totalSupply, launchTime] = decodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      log.data as Hex,
    );
    const block = num(log.blockNumber);
    const supply = fmt(totalSupply, 18);
    tokenStore.register(
      blankToken({
        chain: "bsc",
        address: token,
        launchpad: "four",
        name: name.slice(0, 64) || "Unknown",
        symbol: symbol.slice(0, 16) || "???",
        creator: creator.toLowerCase(),
        createdAt: Number(launchTime) > 0 ? Number(launchTime) * 1000 : ctx.blockTs(block, log),
        createTx: log.transactionHash,
        pool: MANAGER,
      }),
      { supply: supply > 0 ? supply : undefined, excluded: [MANAGER], createBlock: block, trackedFromCreation: block >= ctx.startBlock },
    );
  }

  function onTrade(log: RpcLog, ctx: PollCtx, side: "buy" | "sell"): void {
    const token = wordAddr(log.data, 0);
    const key = `bsc:${token}`;
    if (!tokenStore.has(key)) return;
    const block = num(log.blockNumber);
    const price = fmt(word(log.data, 2), 18);
    const funds = fmt(word(log.data, 7), 18);
    tokenStore.addTrade(
      {
        id: `${log.transactionHash}:${num(log.logIndex)}`,
        key,
        chain: "bsc",
        tx: log.transactionHash,
        block,
        ts: ctx.blockTs(block, log),
        side,
        trader: wordAddr(log.data, 1),
        amountToken: fmt(word(log.data, 3), 18),
        amountNative: fmt(word(log.data, 4), 18),
        amountUsd: 0,
        priceUsd: 0,
        mcapUsd: 0,
        tags: [],
      },
      {
        spotPriceNative: price > 0 ? price : undefined,
        bondingPct: grad > 0 ? Math.min(100, (funds / grad) * 100) : undefined,
        liquidityNative: funds,
      },
    );
  }

  return {
    name: "four",
    subs: [
      {
        filters: () => [{ address: MANAGER, topics: [[T_CREATE, T_PURCHASE, T_SALE, T_LIQUIDITY]] }],
        onLog: (log, ctx) => {
          const t0 = log.topics[0];
          if (t0 === T_CREATE) onCreate(log, ctx);
          else if (t0 === T_PURCHASE) onTrade(log, ctx, "buy");
          else if (t0 === T_SALE) onTrade(log, ctx, "sell");
          else if (t0 === T_LIQUIDITY) {
            const key = `bsc:${wordAddr(log.data, 0)}`;
            if (tokenStore.has(key)) tokenStore.migrate(key, { venue: "pancakeswap", at: ctx.blockTs(num(log.blockNumber), log) });
          }
        },
      },
    ],
  };
}
