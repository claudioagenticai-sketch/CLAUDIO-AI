// Ingest entrypoint: native prices, Solana (PumpPortal), HOOD + BSC log pollers with launchpad adapters,
// and the simulator for chains without a working live source. Adapter errors are contained — never fatal.
//
// Env:
//   PUMPPORTAL_API_KEY   enables the paid per-token trade feed on Solana
//   HOOD_RPC_URL / HOOD_WS_URL / HOOD_POLL_MS   private RPC (recommended), newHeads trigger, poll interval
//   BSC_RPC_URL  / BSC_WS_URL  / BSC_POLL_MS
//   SIMULATOR=auto|on|off   (default auto)
//   INGEST=off              disable live feeds (simulator still follows SIMULATOR)
//   IPFS_GATEWAY            metadata/image gateway (default https://ipfs.filebase.io/ipfs/)

import { startFeaturedTokens } from "./featured";
import { startPrices } from "./prices";
import { startPumpPortal } from "./sol/pumpportal";
import { EvmPoller } from "./evm/poller";
import { HOOD_POOL_MANAGER, V4Tracker } from "./evm/v4";
import { ponsAdapter } from "./evm/hood/pons";
import { hoodFlapAdapter } from "./evm/hood/flap";
import { clankerAdapter } from "./evm/hood/clanker";
import { bagsAdapter } from "./evm/hood/bags";
import { poolsAdapter } from "./evm/hood/pools";
import { trenchAdapter } from "./evm/hood/trench";
import { fourAdapter } from "./evm/bsc/four";
import { bscFlapAdapter } from "./evm/bsc/flap";
import { startSimulator, simulatorMode } from "./simulator";
import { setSource } from "../store/status";
import { hasCustomRpc, rpcUrls, wsUrls } from "../rpc";
import { errMsg, ilog } from "./log";
import { IS_TESTNET } from "../network";

let started = false;

function safe(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    ilog("ingest", `${name} failed to start: ${errMsg(e)}`);
  }
}

function envInt(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function startIngest(): void {
  if (started) return;
  started = true;

  if (process.listenerCount("unhandledRejection") === 0) {
    // An always-on indexer must not die on a stray rejected promise from a flaky RPC/feed.
    process.on("unhandledRejection", (reason: unknown) => ilog("ingest", `unhandled rejection: ${errMsg(reason)}`));
  }

  safe("prices", startPrices);

  // Live feeds index MAINNET launchpads, which don't exist on testnet: off there unless INGEST=on.
  const ingestEnv = (process.env.INGEST ?? "").toLowerCase();
  const liveOff = ingestEnv === "off" || (IS_TESTNET && ingestEnv !== "on");
  // The official $CLAUDIO token is always on the board (its page, Home and the cast depend on it), even with live feeds
  // off; its stats come from DexScreener, not from our indexers. Mainnet token → not on testnet.
  if (!IS_TESTNET) safe("featured", startFeaturedTokens);

  if (liveOff) {
    ilog("ingest", IS_TESTNET ? "testnet → live mainnet feeds disabled (INGEST=on to force)" : "INGEST=off → live feeds disabled");
  } else {
    // ── Solana: PumpPortal (single connection) ──
    safe("pumpportal", startPumpPortal);

    // ── Robinhood Chain ──
    safe("hood", () => {
      const custom = hasCustomRpc("hood");
      const poller = new EvmPoller({
        chain: "hood",
        rpcUrls: rpcUrls("hood"),
        wsUrl: wsUrls("hood")[0],
        // Public RPC is rate-limited (429 "limit will reset in 60 seconds") → poll gently unless a private RPC is set.
        intervalMs: envInt("HOOD_POLL_MS", custom ? 400 : 1500),
        maxRange: 2000,
        backfillBlocks: 3000, // ~5 min of trades at ~100ms blocks
        minRequestGapMs: custom ? 0 : 150,
      });
      const v4 = new V4Tracker(HOOD_POOL_MANAGER);
      poller
        .use(ponsAdapter(v4))
        .use(hoodFlapAdapter())
        .use(clankerAdapter(v4))
        .use(bagsAdapter(v4))
        .use(poolsAdapter(v4))
        .use(trenchAdapter())
        .use(v4) // last: pools registered by other adapters in this batch are picked up next tick
        .start();
      // Dyor (factory 0x80b4…2bf4): TokenLaunched signature unverified → not indexed yet.
    });

    // ── BSC ──
    safe("bsc", () => {
      // bsc-dataseed.bnbchain.org rejects eth_getLogs (-32005 "limit exceeded"); publicnode / 1rpc accept small ranges.
      const poller = new EvmPoller({
        chain: "bsc",
        rpcUrls: rpcUrls("bsc"),
        wsUrl: wsUrls("bsc")[0],
        intervalMs: envInt("BSC_POLL_MS", 3000),
        maxRange: 50,
        backfillBlocks: 120,
        confirmations: 1,
      });
      poller.use(fourAdapter()).use(bscFlapAdapter()).start();
      // Genius (Pons V2 fork on BSC): same event family; not wired yet — needs its own factory/hook addresses verified.
    });
  }

  if (liveOff) {
    for (const c of ["hood", "sol", "bsc"] as const) setSource(c, "ingest", false, "INGEST=off");
  }
  safe("simulator", () => startSimulator(simulatorMode()));
  ilog("ingest", `started (simulator: ${simulatorMode()})`);
}
