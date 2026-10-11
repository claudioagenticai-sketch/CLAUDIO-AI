// Pools.trade (Uniswap Labs) on Robinhood Chain — Instant Launch: single-sided plain v4 pool, no migration.
// "Bonding %" is the registry milestone (FDV / $50k), computed by the store.
//
// Verified live 2026-09-27:
//   TokenLaunched topic0 0x3b3d2bafdcae274a232217e1f80ee4305d3af6aa25c8b14b1681bd68d18042a4 is emitted by
//   0x7c48dde3b447381f4d986334679b3afc7f2d35c2 (the launch strategy called via entry 0x0000ffff…19c0), NOT by the
//   entry itself. Layout (tx 0xbd2d5d41…7820): topic1 = PoolId, topic2 = token, topic3 = (unidentified address);
//   data = PoolKey(currency0, currency1, fee, tickSpacing, hooks) — e.g. (ETH, token, 2500, 25, 0x0).
//   keccak256(abi.encode(PoolKey)) == topic1 → confirmed.
//   Token factory 0x000000e200088d55c39a11f609e5f667729ad49b emits topic0
//   0x4ef8284ecf42d4cd19686572ffd87f630858c82398911e776cb831de35eddbf4 whose data decodes as
//   (address token, (string description, string website, string image, string json)) — the event *name* is unknown
//   (no match for TokenCreated/TokenMetadataSet/MetadataSet variants) but the layout was decoded from a live log.
// Creator = tx.from (the entry is called directly by the launcher's wallet).

import { decodeAbiParameters, type Hex } from "viem";
import { blankToken, tokenStore } from "../../../store";
import { resolveUri } from "../../meta";
import { erc20Info, txSenders } from "../calls";
import { num, topicAddr, wordAddr, type RpcLog } from "../rpc";
import type { Adapter, PollCtx } from "../poller";
import type { V4Tracker } from "../v4";

const LAUNCHER = "0x7c48dde3b447381f4d986334679b3afc7f2d35c2";
const TOKEN_FACTORY = "0x000000e200088d55c39a11f609e5f667729ad49b";
const ENTRY = "0x0000ffffbe8efe702c8703ae3477ff5de3d319c0";
const T_LAUNCHED = "0x3b3d2bafdcae274a232217e1f80ee4305d3af6aa25c8b14b1681bd68d18042a4";
const T_META = "0x4ef8284ecf42d4cd19686572ffd87f630858c82398911e776cb831de35eddbf4";
const ZERO = "0x0000000000000000000000000000000000000000";
const BOOTSTRAP_BLOCKS = 100_000;

interface PendingLaunch {
  token: string;
  poolId: string;
  c0: string;
  c1: string;
  block: number;
  ts: number;
  tx: string;
  tracked: boolean;
}

interface Meta {
  description?: string;
  website?: string;
  image?: string;
}

export function poolsAdapter(v4: V4Tracker): Adapter {
  const queue: PendingLaunch[] = [];
  const metas = new Map<string, Meta>();

  function onMeta(log: RpcLog): void {
    try {
      const [token, m] = decodeAbiParameters(
        [{ type: "address" }, { type: "tuple", components: [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }] }],
        log.data as Hex,
      );
      const [description, website, image] = m;
      const addr = token.toLowerCase();
      const meta: Meta = { description: description || undefined, website: website || undefined, image: resolveUri(image) };
      const key = `hood:${addr}`;
      if (tokenStore.has(key)) tokenStore.patch(key, { image: meta.image, description: meta.description, socials: meta.website ? { website: meta.website } : {} });
      else {
        metas.set(addr, meta);
        if (metas.size > 1000) {
          const first = metas.keys().next().value;
          if (first !== undefined) metas.delete(first);
        }
      }
    } catch {
      /* layout mismatch → ignore */
    }
  }

  function onLaunched(log: RpcLog, ctx: PollCtx): void {
    const block = num(log.blockNumber);
    queue.push({
      token: topicAddr(log.topics[2]),
      poolId: (log.topics[1] ?? "").toLowerCase(),
      c0: wordAddr(log.data, 0),
      c1: wordAddr(log.data, 1),
      block,
      ts: ctx.blockTs(block, log),
      tx: log.transactionHash,
      tracked: block >= ctx.startBlock,
    });
  }

  async function flush(ctx: PollCtx): Promise<void> {
    if (!queue.length) return;
    const items = queue.splice(0, queue.length);
    const [infos, senders] = await Promise.all([erc20Info(ctx.rpc, items.map((i) => i.token)), txSenders(ctx.rpc, items.map((i) => i.tx))]);
    for (const it of items) {
      const info = infos.get(it.token);
      const meta = metas.get(it.token);
      metas.delete(it.token);
      const key = `hood:${it.token}`;
      const quote = it.c0 === it.token ? it.c1 : it.c0;
      tokenStore.register(
        blankToken({
          chain: "hood",
          address: it.token,
          launchpad: "pools",
          name: info?.name || "Unknown",
          symbol: info?.symbol || "???",
          creator: senders.get(it.tx) ?? "",
          createdAt: it.ts,
          createTx: it.tx,
          pool: it.poolId,
          venue: "uniswap-v4",
          image: meta?.image,
          description: meta?.description,
          socials: meta?.website ? { website: meta.website } : {},
          quoteSymbol: quote === ZERO ? "ETH" : "?",
        }),
        {
          supply: info?.totalSupply ? Number(info.totalSupply / 10n ** BigInt(info.decimals ?? 18)) : undefined,
          excluded: [LAUNCHER, ENTRY, TOKEN_FACTORY],
          createBlock: it.block,
          trackedFromCreation: it.tracked,
          quoteUsd: quote === ZERO ? undefined : 0,
        },
      );
      v4.add({ key, poolId: it.poolId, token: it.c0 === it.token ? "c0" : "c1", quoteDecimals: 18, tokenDecimals: info?.decimals ?? 18 });
    }
  }

  return {
    name: "pools",
    subs: [
      { filters: () => [{ address: LAUNCHER, topics: [T_LAUNCHED] }], onLog: onLaunched },
      { filters: () => [{ address: TOKEN_FACTORY, topics: [T_META] }], onLog: (log) => onMeta(log) },
    ],
    async bootstrap(ctx) {
      const start = Math.max(1, ctx.head - BOOTSTRAP_BLOCKS);
      for (let from = start; from < ctx.startBlock; from += 50_000) {
        const to = Math.min(ctx.startBlock - 1, from + 49_999);
        const [metaLogs, launchLogs] = await Promise.all([
          ctx.rpc.getLogs(from, to, { address: TOKEN_FACTORY, topics: [T_META] }),
          ctx.rpc.getLogs(from, to, { address: LAUNCHER, topics: [T_LAUNCHED] }),
        ]);
        metaLogs.forEach(onMeta);
        launchLogs.forEach((l) => onLaunched(l, ctx));
      }
      await flush(ctx);
    },
    afterBatch: flush,
  };
}
