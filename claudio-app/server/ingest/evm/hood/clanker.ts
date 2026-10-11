// Clanker v4 on Robinhood Chain — instant single-sided Uniswap v4 pool (no curve; "bonding %" = milestone).
//
// Factory 0xD3f2cC1731b7Fd17f28798835C2E02f0a1839A94 (ABI from Sourcify, chain 4663).
// TokenCreated(address msgSender,address indexed tokenAddress,address indexed tokenAdmin,string tokenImage,
//   string tokenName,string tokenSymbol,string tokenMetadata,string tokenContext,int24 startingTick,address poolHook,
//   bytes32 poolId,address pairedToken,address locker,address mevModule,uint256 extensionsSupply,address[] extensions)
//   topic0 0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67 — verified live
//   (low activity: ~1–2 creations per 100k blocks). Trades come from the shared V4Tracker by poolId.

import { decodeAbiParameters, type Hex } from "viem";
import { blankToken, tokenStore } from "../../../store";
import { parseMeta, resolveUri } from "../../meta";
import { num, topicAddr, type RpcLog } from "../rpc";
import type { Adapter, PollCtx } from "../poller";
import type { V4Tracker } from "../v4";

const FACTORY = "0xd3f2cc1731b7fd17f28798835c2e02f0a1839a94";
const LP_LOCKER = "0x290f735f63824bb5836cde24a35f5103a5b5bc99";
const T_CREATED = "0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const BOOTSTRAP_BLOCKS = 100_000;

export function clankerAdapter(v4: V4Tracker): Adapter {
  function onCreated(log: RpcLog, ctx: PollCtx): void {
    const token = topicAddr(log.topics[1]);
    const admin = topicAddr(log.topics[2]);
    const d = decodeAbiParameters(
      [
        { type: "address" }, // msgSender
        { type: "string" }, // tokenImage
        { type: "string" }, // tokenName
        { type: "string" }, // tokenSymbol
        { type: "string" }, // tokenMetadata (JSON)
        { type: "string" }, // tokenContext (JSON)
        { type: "int24" }, // startingTick
        { type: "address" }, // poolHook
        { type: "bytes32" }, // poolId
        { type: "address" }, // pairedToken
        { type: "address" }, // locker
        { type: "address" }, // mevModule
        { type: "uint256" }, // extensionsSupply
        { type: "address[]" }, // extensions
      ],
      log.data as Hex,
    );
    const [msgSender, image, name, symbol, metadata, , startingTick, poolHook, poolId, pairedToken, locker] = d;
    let meta: ReturnType<typeof parseMeta> | undefined;
    try {
      meta = metadata ? parseMeta(JSON.parse(metadata) as unknown) : undefined;
    } catch {
      meta = undefined;
    }
    const block = num(log.blockNumber);
    const paired = pairedToken.toLowerCase();
    const tokenIsC0 = BigInt(token) < BigInt(paired);
    // price(c1 per c0) = 1.0001^tick. A memecoin is always < 1 quote unit at launch → pick the orientation below 1.
    let p = Math.pow(1.0001, Number(startingTick));
    if (!Number.isFinite(p) || p <= 0) p = 0;
    else if (p > 1) p = 1 / p;
    const key = `hood:${token}`;
    tokenStore.register(
      blankToken({
        chain: "hood",
        address: token,
        launchpad: "clanker",
        name: name.slice(0, 64) || "Unknown",
        symbol: symbol.slice(0, 16) || "???",
        creator: admin || msgSender.toLowerCase(),
        createdAt: ctx.blockTs(block, log),
        createTx: log.transactionHash,
        image: resolveUri(image),
        description: meta?.description,
        socials: meta?.socials ?? {},
        pool: poolId.toLowerCase(),
        venue: "uniswap-v4",
        quoteSymbol: paired === WETH ? "ETH" : "?",
        priceNative: p,
      }),
      {
        excluded: [FACTORY, LP_LOCKER, locker.toLowerCase(), poolHook.toLowerCase()],
        createBlock: block,
        trackedFromCreation: block >= ctx.startBlock,
        // Non-WETH pairs: unknown USD price → USD fields stay 0 rather than guessed.
        quoteUsd: paired === WETH ? undefined : 0,
      },
    );
    v4.add({ key, poolId: poolId.toLowerCase(), token: tokenIsC0 ? "c0" : "c1", quoteDecimals: 18, tokenDecimals: 18 });
  }

  return {
    name: "clanker",
    subs: [{ filters: () => [{ address: FACTORY, topics: [T_CREATED] }], onLog: onCreated }],
    async bootstrap(ctx) {
      for (let from = Math.max(1, ctx.head - BOOTSTRAP_BLOCKS); from < ctx.startBlock; from += 50_000) {
        const to = Math.min(ctx.startBlock - 1, from + 49_999);
        const logs = await ctx.rpc.getLogs(from, to, { address: FACTORY, topics: [T_CREATED] });
        for (const l of logs) {
          try {
            onCreated(l, ctx);
          } catch {
            /* skip malformed */
          }
        }
      }
    },
  };
}
