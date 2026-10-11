// Flap Portal adapter (same event ABI on HOOD and BSC).
//
// Verified live 2026-09-27 (HOOD portal 0x26605f…EaEb09, 50k blocks; BSC portal 0xe2cE6a…9De0 via publicnode):
//   TokenCreated(uint256 ts,address creator,uint256 nonce,address token,string name,string symbol,string meta)
//     0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603  (186 on HOOD; decoded: "Counterparty"/"CP"/meta=CID)
//   TokenBought(uint256 ts,address token,address buyer,uint256 amount,uint256 eth,uint256 fee,uint256 postPrice)
//     0xa800a2038683844fac66747f771bfdfae862eb28b16bcfa387afa9fbacce8ff7  (210; postPrice = quote/token × 1e18)
//   TokenSold(uint256 ts,address token,address seller,uint256 amount,uint256 eth,uint256 fee,uint256 postPrice)
//     0x03a4693e592f5e75dc7c136acb39b146d2b4966c0e509c34f362dee02b3b861a  (29)
//   FlapTokenProgressChanged(address token,uint256 progress)   progress: 1e18 = 100% (max seen 0.39e18)
//     0x4c35e20d1e9bce377c7d9ec1572d934e46d62961f4da8af5beb8002d5906742d
//   FlapTokenAsymmetricTaxSet(address token,uint256 buyTax,uint256 sellTax)  (values seen: 899/300/1000 → bps)
//     0x46cc246a238d1ca0951a15200994903e2d56cbb0389e63f09d66412a787aa3c0
//   FlapTokenTaxSet(address token,uint256 tax)  0x1546924f4680b1b2e093fd251c437c8781d81a21ed8ad1895e1f2c9b78db0cd0
//   TokenQuoteSet(address token,address quote)  0x3ceb902d3c555c21c3415b6aa839104b18e4825b2f8324011ff979089a507a8c
// Unverified (no occurrence in the sampled ranges; signature from research):
//   LaunchedToDEX(address token,address pool,uint256 amount,uint256 eth)
//     0x6e4f47630b8745b8cacbd44f42a8a33e7eea7cc08ef22fc7630f4f385784ff7d
//
// Metadata: `meta` is an IPFS CID of a JSON {description,image(CID),website,twitter,telegram}; Flap's own pinata
// gateway serves it fast (flap.mypinata.cloud, tested 0.23s vs 3.8s on the public pinata gateway).

import { decodeAbiParameters, type Hex } from "viem";
import type { ChainId } from "@shared/chains";
import { blankToken, tokenStore } from "../../store";
import { fetchMeta } from "../meta";
import { fmt, num, word, wordAddr, type RpcLog } from "./rpc";
import type { Adapter, PollCtx } from "./poller";

const T_CREATED = "0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603";
const T_BOUGHT = "0xa800a2038683844fac66747f771bfdfae862eb28b16bcfa387afa9fbacce8ff7";
const T_SOLD = "0x03a4693e592f5e75dc7c136acb39b146d2b4966c0e509c34f362dee02b3b861a";
const T_PROGRESS = "0x4c35e20d1e9bce377c7d9ec1572d934e46d62961f4da8af5beb8002d5906742d";
const T_ASYM_TAX = "0x46cc246a238d1ca0951a15200994903e2d56cbb0389e63f09d66412a787aa3c0";
const T_TAX = "0x1546924f4680b1b2e093fd251c437c8781d81a21ed8ad1895e1f2c9b78db0cd0";
const T_QUOTE = "0x3ceb902d3c555c21c3415b6aa839104b18e4825b2f8324011ff979089a507a8c";
const T_TO_DEX = "0x6e4f47630b8745b8cacbd44f42a8a33e7eea7cc08ef22fc7630f4f385784ff7d";

const FLAP_GATEWAY = "https://flap.mypinata.cloud/ipfs/";
const ZERO = "0x0000000000000000000000000000000000000000";

export interface FlapOpts {
  chain: ChainId;
  portal: string;
  venue: string;
}

interface Pending {
  buyTax?: number;
  sellTax?: number;
  quote?: string;
  progress?: number;
}

export function flapAdapter(opts: FlapOpts): Adapter {
  const portal = opts.portal.toLowerCase();
  const pending = new Map<string, Pending>(); // settings emitted before TokenCreated (same tx)

  const keyOf = (token: string): string => `${opts.chain}:${token}`;

  function pend(token: string): Pending {
    let p = pending.get(token);
    if (!p) {
      p = {};
      pending.set(token, p);
      if (pending.size > 2000) {
        const first = pending.keys().next().value;
        if (first !== undefined) pending.delete(first);
      }
    }
    return p;
  }

  function onCreated(log: RpcLog, ctx: PollCtx): void {
    const [ts, creator, , token, name, symbol, meta] = decodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      log.data as Hex,
    );
    const addr = token.toLowerCase();
    const key = keyOf(addr);
    const block = num(log.blockNumber);
    const p = pending.get(addr);
    pending.delete(addr);
    const nonNative = !!p?.quote && p.quote !== ZERO;
    const t = blankToken({
      chain: opts.chain,
      address: addr,
      launchpad: "flap",
      name: name.slice(0, 64) || "Unknown",
      symbol: symbol.slice(0, 16) || "???",
      creator: creator.toLowerCase(),
      createdAt: Number(ts) * 1000 || ctx.blockTs(block, log),
      createTx: log.transactionHash,
      pool: portal,
      buyTaxBps: p?.buyTax ?? 0,
      sellTaxBps: p?.sellTax ?? 0,
      bondingPct: p?.progress ?? 0,
      // Non-native quotes on Flap BSC are stables (USD1 / USDT / lisUSD per registry) → "USD" at $1 (approximation).
      quoteSymbol: nonNative ? "USD" : undefined,
    });
    tokenStore.register(t, {
      excluded: [portal],
      createBlock: block,
      trackedFromCreation: block >= ctx.startBlock,
      quoteUsd: nonNative ? 1 : undefined,
    });
    if (meta) {
      void fetchMeta(meta, { preferredGateway: FLAP_GATEWAY }).then((m) => {
        if (!m) return;
        tokenStore.patch(key, { image: m.image, description: m.description, socials: m.socials });
      });
    }
  }

  function onTrade(log: RpcLog, ctx: PollCtx, side: "buy" | "sell"): void {
    const token = wordAddr(log.data, 1);
    const key = keyOf(token);
    if (!tokenStore.has(key)) return; // created before we started (no metadata) → skip; board is creation-driven
    const block = num(log.blockNumber);
    const amount = fmt(word(log.data, 3), 18);
    const eth = fmt(word(log.data, 4), 18);
    const postPrice = fmt(word(log.data, 6), 18);
    tokenStore.addTrade(
      {
        id: `${log.transactionHash}:${num(log.logIndex)}`,
        key,
        chain: opts.chain,
        tx: log.transactionHash,
        block,
        ts: Number(word(log.data, 0)) * 1000 || ctx.blockTs(block, log),
        side,
        trader: wordAddr(log.data, 2),
        amountToken: amount,
        amountNative: eth,
        amountUsd: 0,
        priceUsd: 0,
        mcapUsd: 0,
        tags: [],
      },
      { spotPriceNative: postPrice > 0 ? postPrice : undefined },
    );
  }

  return {
    name: `flap-${opts.chain}`,
    subs: [
      {
        filters: () => [{ address: portal, topics: [[T_CREATED, T_BOUGHT, T_SOLD, T_PROGRESS, T_ASYM_TAX, T_TAX, T_QUOTE, T_TO_DEX]] }],
        onLog: (log, ctx) => {
          const t0 = log.topics[0];
          if (t0 === T_CREATED) return onCreated(log, ctx);
          if (t0 === T_BOUGHT) return onTrade(log, ctx, "buy");
          if (t0 === T_SOLD) return onTrade(log, ctx, "sell");
          const token = wordAddr(log.data, 0);
          const key = keyOf(token);
          const known = tokenStore.has(key);
          if (t0 === T_PROGRESS) {
            const pct = Math.min(100, (Number(word(log.data, 1)) / 1e18) * 100);
            if (known) tokenStore.updateMarket(key, { bondingPct: pct });
            else pend(token).progress = pct;
          } else if (t0 === T_ASYM_TAX) {
            const buy = Number(word(log.data, 1));
            const sell = Number(word(log.data, 2));
            if (known) tokenStore.patch(key, { buyTaxBps: buy, sellTaxBps: sell });
            else Object.assign(pend(token), { buyTax: buy, sellTax: sell });
          } else if (t0 === T_TAX) {
            const tax = Number(word(log.data, 1));
            if (known) tokenStore.patch(key, { buyTaxBps: tax, sellTaxBps: tax });
            else Object.assign(pend(token), { buyTax: tax, sellTax: tax });
          } else if (t0 === T_QUOTE) {
            const quote = wordAddr(log.data, 1);
            if (!known) pend(token).quote = quote;
          } else if (t0 === T_TO_DEX) {
            const pool = wordAddr(log.data, 1);
            if (known) tokenStore.migrate(key, { venue: opts.venue, pool, at: ctx.blockTs(num(log.blockNumber), log) });
          }
        },
      },
    ],
  };
}
