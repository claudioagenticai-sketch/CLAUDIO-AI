// Pons V2 (Robinhood Chain) — bonding curve → Uniswap v4 + MemeHook.
//
// Verified live on HOOD (cast keccak + cast logs, 2026-09-27, blocks ~74.0M):
//   Factory 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
//   TokenLaunched(address indexed token,address indexed curve,address indexed deployer,address pairToken,uint256 launchConfigId,uint256 graduationThreshold)
//     0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607   (36 logs / 5k blocks)
//   PoolGraduated(address indexed token,uint256 positionId,uint256 tokenAmount,uint256 pairTokenAmount)
//     0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259   (8 logs / 50k blocks)
//   CreatorFeeRecipientChangeProposed(address indexed token,address indexed currentRecipient,address indexed proposedRecipient,uint256 effectiveAt,uint256 expiresAt)
//     0x7f119e44c84a715429bee60d30ad2e14afdef6c60bb1a7eaa01290ecf6d1b2e5   (hash matches research; 0 logs in last 50k blocks)
//   Per-curve (queried by topic only, mapped curve → token):
//   CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)
//     0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455   (662 logs / 2k blocks)
//   CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)
//     0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df   (663 logs / 2k blocks)
//   CurveCompleted(address recipient,uint256 quoteOut,uint256 tokenOut)
//     0xf8d37a90738ae063b8b8058b66f5880cf3cf7ab0c5d4fa78219696591dfbfb67
//
// Token getters (PonsV2LauncherToken): name, symbol, logo, description, socials() → 5 strings, deployer, curve.
// Curve getters: getReserves() → (quote, token), realQuoteReserve(), token(), factory().
// Graduated pool: PoolKey(ETH=0x0, token, fee 0, tickSpacing 200, hooks MemeHook) — poolId derivation verified.

import type { ChainId } from "@shared/chains";
import { blankToken, tokenStore } from "../../../store";
import { fetchMeta, resolveUri } from "../../meta";
import { errMsg, ilog } from "../../log";
import { call, decAddr, decStr, decStrings, decUint, erc20Info } from "../calls";
import { fmt, multicall, num, ratio, topicAddr, word, type McCall, type RpcLog } from "../rpc";
import type { Adapter, PollCtx } from "../poller";
import { v4PoolId, type V4Tracker } from "../v4";
import { requestUrgentHarvest } from "../../../keeper";

const CHAIN: ChainId = "hood";
const FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const MEME_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
const LOCKER = "0x267444d099b10fb5ed7c3cc7b7c767adca574952";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ZERO = "0x0000000000000000000000000000000000000000";

const T_LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const T_GRADUATED = "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259";
const T_FEE_PROPOSED = "0x7f119e44c84a715429bee60d30ad2e14afdef6c60bb1a7eaa01290ecf6d1b2e5";
const T_BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455";
const T_SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df";
const T_COMPLETED = "0xf8d37a90738ae063b8b8058b66f5880cf3cf7ab0c5d4fa78219696591dfbfb67";

const BOOTSTRAP_BLOCKS = 20_000; // ~35 min of HOOD blocks (~100ms measured); heavier windows trip the public RPC's weighted 429
// Public-RPC budget: HOOD's endpoint applies a weighted rate limit (429 + Retry-After up to 60s) → discovery and
// reserve refreshes are paced; trades themselves never wait on these calls.
const DISCOVER_BATCH = 20;
const DISCOVER_EVERY_MS = 4000;
const REFRESH_EVERY_MS = 2500;
const REFRESH_CAP = 80;
const STOCK_HINT = /^(NVDA|AAPL|TSLA|HOOD|MSFT|AMZN|GOOGL?|META|COIN|MSTR|SPY|QQQ|AMD|NFLX|PLTR)/i;

interface CurveInfo {
  key: string;
  token: string;
  curve: string;
  threshold: bigint;
  quoteDecimals: number;
  pairToken: string;
}

interface LaunchRec {
  token: string;
  curve: string;
  deployer: string;
  pairToken: string;
  threshold: bigint;
  block: number;
  ts: number;
  tx: string;
  tracked: boolean;
  graduated?: boolean;
  graduatedAt?: number;
}

interface PairInfo {
  symbol: string;
  decimals: number;
  quoteUsd?: number;
  stock: boolean;
}

export function ponsAdapter(v4: V4Tracker): Adapter {
  const curves = new Map<string, CurveInfo>();
  const tokenToCurve = new Map<string, string>();
  const pairCache = new Map<string, PairInfo>();
  const touched = new Set<string>();
  const unknownCurves = new Map<string, RpcLog[]>(); // curve → stashed trade logs awaiting discovery
  const rejectedCurves = new Set<string>();
  const graduateQueue: { token: string; block: number; ts: number }[] = [];
  const loadQueue: LaunchRec[] = [];
  let lastDiscoveryAt = 0;
  let lastRefreshAt = 0;

  async function pairInfo(ctx: PollCtx, pair: string): Promise<PairInfo> {
    if (pair === ZERO) return { symbol: "ETH", decimals: 18, stock: false };
    const c = pairCache.get(pair);
    if (c) return c;
    const info = (await erc20Info(ctx.rpc, [pair])).get(pair);
    const symbol = info?.symbol ?? "?";
    const p: PairInfo = {
      symbol,
      decimals: info?.decimals ?? 18,
      // USDG is a USD stablecoin. Stock tokens have no price source here → USD fields stay 0 (honest, not guessed).
      quoteUsd: pair === USDG || /^USD/i.test(symbol) ? 1 : 0,
      stock: pair !== USDG && STOCK_HINT.test(symbol),
    };
    pairCache.set(pair, p);
    return p;
  }

  /** Read token metadata + curve state for launches and register them in the store. */
  async function loadLaunches(ctx: PollCtx, recs: LaunchRec[]): Promise<void> {
    for (let i = 0; i < recs.length; i += 25) {
      const part = recs.slice(i, i + 25);
      const calls: McCall[] = [];
      for (const r of part) {
        calls.push(
          call(r.token, "name()"),
          call(r.token, "symbol()"),
          call(r.token, "logo()"),
          call(r.token, "description()"),
          call(r.token, "socials()"),
          call(r.curve, "getReserves()"),
          call(r.curve, "realQuoteReserve()"),
        );
      }
      const res = await multicall(ctx.rpc, calls);
      for (let k = 0; k < part.length; k++) {
        const r = part[k];
        const o = k * 7;
        const name = decStr(res[o], 64) ?? "Unknown";
        const symbol = decStr(res[o + 1], 16) ?? "???";
        const logo = decStr(res[o + 2], 512);
        const description = decStr(res[o + 3], 2048);
        const soc = decStrings(res[o + 4], 5) ?? [];
        const qR = decUint(res[o + 5], 0);
        const tR = decUint(res[o + 5], 1);
        const real = decUint(res[o + 6]);
        const pair = await pairInfo(ctx, r.pairToken);
        const key = `${CHAIN}:${r.token}`;
        const priceNative = qR && tR && tR > 0n ? ratio(qR, tR) * 10 ** (18 - pair.decimals) : 0;
        const bondingPct = real !== undefined && r.threshold > 0n ? ratio(real, r.threshold) * 100 : 0;
        curves.set(r.curve, { key, token: r.token, curve: r.curve, threshold: r.threshold, quoteDecimals: pair.decimals, pairToken: r.pairToken });
        tokenToCurve.set(r.token, r.curve);

        const token = blankToken({
          chain: CHAIN,
          address: r.token,
          launchpad: "pons",
          name,
          symbol,
          creator: r.deployer,
          createdAt: r.ts,
          createTx: r.tx,
          pool: r.curve,
          image: resolveUri(logo),
          description,
          socials: {
            ...(soc[0] ? { twitter: soc[0] } : {}),
            ...(soc[1] ? { telegram: soc[1] } : {}),
            ...(soc[2] ? { discord: soc[2] } : {}),
            ...(soc[3] ? { website: soc[3] } : {}),
            ...(soc[4] ? { farcaster: soc[4] } : {}),
          },
          quoteSymbol: pair.symbol,
          stockPaired: pair.stock,
          priceNative,
          bondingPct,
        });
        if (r.graduated) {
          token.phase = "migrated";
          token.venue = "uniswap-v4";
          token.migratedAt = r.graduatedAt;
        }
        tokenStore.register(token, {
          excluded: [r.curve, FACTORY, LOCKER, MEME_HOOK],
          quoteUsd: pair.quoteUsd === undefined ? undefined : r.pairToken === ZERO ? undefined : pair.quoteUsd,
          createBlock: r.block,
          trackedFromCreation: r.tracked,
        });
        if (real !== undefined) tokenStore.updateMarket(key, { liquidityNative: fmt(real, pair.decimals) });
        if (r.graduated) registerPool(r.token, r.pairToken, pair.decimals);
        // Logo may be an ipfs:// JSON in some launches → cheap check: only fetch if not an image-like URL.
        if (logo && /\.json$/i.test(logo)) {
          void fetchMeta(logo).then((m) => {
            if (m?.image) tokenStore.patch(key, { image: m.image });
          });
        }
      }
    }
  }

  function registerPool(token: string, pairToken: string, pairDecimals: number): void {
    const [c0, c1] = pairToken === ZERO || BigInt(pairToken) < BigInt(token) ? [pairToken, token] : [token, pairToken];
    const poolId = v4PoolId(c0, c1, 0, 200, MEME_HOOK);
    v4.add({ key: `${CHAIN}:${token}`, poolId, token: c0 === token ? "c0" : "c1", quoteDecimals: pairDecimals, tokenDecimals: 18 });
  }

  function parseLaunch(log: RpcLog, ctx: PollCtx): LaunchRec {
    const block = num(log.blockNumber);
    return {
      token: topicAddr(log.topics[1]),
      curve: topicAddr(log.topics[2]),
      deployer: topicAddr(log.topics[3]),
      pairToken: `0x${log.data.slice(26, 66)}`.toLowerCase(),
      threshold: word(log.data, 2),
      block,
      ts: ctx.blockTs(block, log),
      tx: log.transactionHash,
      tracked: block >= ctx.startBlock,
    };
  }

  function onTrade(log: RpcLog, ctx: PollCtx, info: CurveInfo): void {
    const isBuy = log.topics[0] === T_BUY;
    const block = num(log.blockNumber);
    const a = word(log.data, 0);
    const b = word(log.data, 1);
    const fee = word(log.data, 2);
    const tax = word(log.data, 3);
    const qd = info.quoteDecimals;
    // Buy: quoteIn (gross, fee+tax+snipe tax taken from it), tokensOut. Sell: tokensIn, quoteOut (net).
    const tokens = fmt(isBuy ? b : a, 18);
    const quote = fmt(isBuy ? a : b, qd);
    const netQuote = isBuy ? fmt(a - fee - tax > 0n ? a - fee - tax : 0n, qd) : fmt(b + fee + tax, qd);
    const trader = isBuy ? topicAddr(log.topics[2]) : topicAddr(log.topics[1]); // recipient of tokens / seller
    tokenStore.addTrade(
      {
        id: `${log.transactionHash}:${num(log.logIndex)}`,
        key: info.key,
        chain: CHAIN,
        tx: log.transactionHash,
        block,
        ts: ctx.blockTs(block, log),
        side: isBuy ? "buy" : "sell",
        trader,
        amountToken: tokens,
        amountNative: quote,
        amountUsd: 0,
        priceUsd: 0,
        mcapUsd: 0,
        tags: [],
      },
      // Price net of fee/tax (the 99% snipe tax would otherwise print a fake 100× candle).
      { execPriceNative: tokens > 0 ? netQuote / tokens : undefined },
    );
    touched.add(info.curve);
  }

  async function discoverCurves(ctx: PollCtx): Promise<void> {
    if (!unknownCurves.size || Date.now() - lastDiscoveryAt < DISCOVER_EVERY_MS) return;
    lastDiscoveryAt = Date.now();
    // Most active unknown curves first (more stashed trades).
    const list = [...unknownCurves.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, DISCOVER_BATCH).map(([c]) => c);
    const res = await multicall(ctx.rpc, list.flatMap((c) => [call(c, "token()"), call(c, "factory()"), call(c, "deployer()"), call(c, "graduationThreshold()"), call(c, "pairToken()")]));
    const tokens: string[] = [];
    const recs: LaunchRec[] = [];
    list.forEach((c, i) => {
      const token = decAddr(res[i * 5]);
      const factory = decAddr(res[i * 5 + 1]);
      if (!token || factory !== FACTORY) {
        rejectedCurves.add(c); // CurveBuy from another launchpad/fork using the same event
        unknownCurves.delete(c);
        return;
      }
      tokens.push(token);
      recs.push({
        token,
        curve: c,
        // deployer() on the curve is the current creator-fee recipient; good enough for attribution when the launch predates us.
        deployer: decAddr(res[i * 5 + 2]) ?? "",
        pairToken: decAddr(res[i * 5 + 4]) ?? ZERO,
        threshold: decUint(res[i * 5 + 3]) ?? 4_200_000_000_000_000_000n,
        block: 0,
        ts: 0,
        tx: "",
        tracked: false,
      });
    });
    if (!recs.length) return;
    // Creator = token.deployer() (immutable). Exact creation time is unknown: bootstrap already loaded every launch
    // in the last BOOTSTRAP_BLOCKS, so these predate that window → use the window start as an "at least this old" bound.
    const creators = await multicall(ctx.rpc, tokens.map((t) => call(t, "deployer()")));
    const olderThan = ctx.blockTs(Math.max(1, ctx.startBlock - BOOTSTRAP_BLOCKS));
    recs.forEach((r, i) => {
      r.deployer = decAddr(creators[i]) ?? r.deployer;
      r.ts = olderThan;
    });
    await loadLaunches(ctx, recs);
    for (const r of recs) {
      const logs = unknownCurves.get(r.curve) ?? [];
      unknownCurves.delete(r.curve);
      const info = curves.get(r.curve);
      if (info) for (const l of logs) onTrade(l, ctx, info);
    }
    if (recs.length) ilog("pons", `discovered ${recs.length} active pre-existing curves`);
  }

  async function refreshCurves(ctx: PollCtx): Promise<void> {
    if (!touched.size || Date.now() - lastRefreshAt < REFRESH_EVERY_MS) return;
    lastRefreshAt = Date.now();
    const list = [...touched].slice(0, REFRESH_CAP);
    for (const c of list) touched.delete(c);
    const res = await multicall(ctx.rpc, list.flatMap((c) => [call(c, "getReserves()"), call(c, "realQuoteReserve()")]));
    list.forEach((c, i) => {
      const info = curves.get(c);
      if (!info) return;
      const qR = decUint(res[i * 2], 0);
      const tR = decUint(res[i * 2], 1);
      const real = decUint(res[i * 2 + 1]);
      const t = tokenStore.get(info.key);
      if (!t) return;
      tokenStore.updateMarket(info.key, {
        spotPriceNative: qR && tR && tR > 0n ? ratio(qR, tR) * 10 ** (18 - info.quoteDecimals) : undefined,
        bondingPct: t.phase === "migrated" ? undefined : real !== undefined && info.threshold > 0n ? Math.min(100, ratio(real, info.threshold) * 100) : undefined,
        liquidityNative: t.phase === "migrated" || real === undefined ? undefined : fmt(real, info.quoteDecimals),
      });
    });
  }

  return {
    name: "pons",
    subs: [
      {
        filters: () => [{ address: FACTORY, topics: [[T_LAUNCHED, T_GRADUATED, T_FEE_PROPOSED]] }],
        onLog: (log, ctx) => {
          const t0 = log.topics[0];
          if (t0 === T_LAUNCHED) {
            const rec = parseLaunch(log, ctx);
            loadQueue.push(rec);
          } else if (t0 === T_GRADUATED) {
            const token = topicAddr(log.topics[1]);
            const block = num(log.blockNumber);
            graduateQueue.push({ token, block, ts: ctx.blockTs(block, log) });
          } else if (t0 === T_FEE_PROPOSED) {
            const token = topicAddr(log.topics[1]);
            const proposed = topicAddr(log.topics[3]);
            const effectiveAt = Number(word(log.data, 0)) * 1000;
            const key = `${CHAIN}:${token}`;
            const t = tokenStore.get(key);
            if (!t) return;
            // Secure fees already earned before a redirect can take effect.
            if (t.launchedHere) requestUrgentHarvest(CHAIN, token);
            tokenStore.alert(key, {
              kind: "fee-recipient-change-proposed",
              at: ctx.blockTs(num(log.blockNumber), log),
              severity: t.launchedHere ? "danger" : "warn",
              message: `Pons owner proposed moving creator fees to ${proposed.slice(0, 6)}…${proposed.slice(-4)} (effective ${new Date(effectiveAt).toISOString().slice(0, 16).replace("T", " ")} UTC)`,
            });
          }
        },
      },
      {
        filters: () => [{ topics: [[T_BUY, T_SELL, T_COMPLETED]] }],
        onLog: (log, ctx) => {
          const curve = log.address.toLowerCase();
          if (rejectedCurves.has(curve)) return;
          const info = curves.get(curve);
          if (!info) {
            // Unknown curve (launched before we started, or in this same batch — loadQueue) → stash & discover.
            if (log.topics[0] === T_COMPLETED) return;
            let stash = unknownCurves.get(curve);
            if (!stash) {
              if (unknownCurves.size > 500) return;
              stash = [];
              unknownCurves.set(curve, stash);
            }
            if (stash.length < 100) stash.push(log);
            return;
          }
          if (log.topics[0] === T_COMPLETED) {
            tokenStore.updateMarket(info.key, { bondingPct: 100 });
            return;
          }
          onTrade(log, ctx, info);
        },
      },
    ],

    async bootstrap(ctx) {
      const from = Math.max(1, ctx.head - BOOTSTRAP_BLOCKS);
      const [launched, graduated] = await Promise.all([
        ctx.rpc.getLogs(from, ctx.head, { address: FACTORY, topics: [T_LAUNCHED] }),
        ctx.rpc.getLogs(from, ctx.head, { address: FACTORY, topics: [T_GRADUATED] }),
      ]);
      const recs = launched.map((l) => parseLaunch(l, ctx)).filter((r) => r.block < ctx.startBlock); // live poll replays the rest
      const gradAt = new Map(graduated.map((l) => [topicAddr(l.topics[1]), ctx.blockTs(num(l.blockNumber), l)] as const));
      const gradSet = new Set(gradAt.keys());
      for (const r of recs) {
        if (!gradSet.has(r.token)) continue;
        r.graduated = true;
        r.graduatedAt = gradAt.get(r.token);
      }
      await loadLaunches(ctx, recs);
      // Graduations of tokens launched before the bootstrap window → register as migrated.
      const known = new Set(recs.map((r) => r.token));
      const older = [...gradSet].filter((t) => !known.has(t));
      if (older.length) {
        const res = await multicall(ctx.rpc, older.flatMap((t) => [call(t, "curve()"), call(t, "deployer()")]));
        const olderRecs: LaunchRec[] = [];
        older.forEach((t, i) => {
          const curve = decAddr(res[i * 2]);
          if (!curve) return;
          const gl = graduated.find((l) => topicAddr(l.topics[1]) === t);
          const block = gl ? num(gl.blockNumber) : 0;
          // Launched before the window: creation time unknown → use the graduation time as a lower bound.
          const at = gl ? ctx.blockTs(block, gl) : Date.now();
          olderRecs.push({ token: t, curve, deployer: decAddr(res[i * 2 + 1]) ?? "", pairToken: ZERO, threshold: 4_200_000_000_000_000_000n, block: 0, ts: at, tx: "", tracked: false, graduated: true, graduatedAt: at });
        });
        await loadLaunches(ctx, olderRecs);
      }
      ilog("pons", `bootstrap: ${recs.length} launches, ${gradSet.size} graduations in last ${BOOTSTRAP_BLOCKS} blocks`);
    },

    async afterBatch(ctx) {
      try {
        if (loadQueue.length) {
          const recs = loadQueue.splice(0, loadQueue.length);
          await loadLaunches(ctx, recs);
          // Trades from the same batch that hit before the curve was known were stashed → replay.
          for (const r of recs) {
            const logs = unknownCurves.get(r.curve);
            if (!logs) continue;
            unknownCurves.delete(r.curve);
            const info = curves.get(r.curve);
            if (info) for (const l of logs) onTrade(l, ctx, info);
          }
        }
        while (graduateQueue.length) {
          const g = graduateQueue.shift();
          if (!g) break;
          const key = `${CHAIN}:${g.token}`;
          const curve = tokenToCurve.get(g.token);
          const t = tokenStore.get(key);
          if (!t) continue;
          const info = curve ? curves.get(curve) : undefined;
          const pairToken = info?.pairToken ?? ZERO;
          const pairDec = info?.quoteDecimals ?? 18;
          const [c0, c1] = pairToken === ZERO || BigInt(pairToken) < BigInt(g.token) ? [pairToken, g.token] : [g.token, pairToken];
          const poolId = v4PoolId(c0, c1, 0, 200, MEME_HOOK);
          tokenStore.migrate(key, { venue: "uniswap-v4", pool: poolId, at: g.ts });
          registerPool(g.token, pairToken, pairDec);
          if (curve) touched.delete(curve);
        }
        await discoverCurves(ctx);
        await refreshCurves(ctx);
      } catch (e) {
        ilog("pons", `afterBatch: ${errMsg(e)}`);
      }
    },
  };
}
