// Clanker v4 adapter (Robinhood Chain) — status: beta.
//
// Verified on-chain 2026-09-27:
//  • deployToken(DeploymentConfig) selector 0xdf40224a; struct layout from the live factory's Sourcify ABI and
//    github clanker-devco/v4-contracts IClanker.sol; three real HOOD deploys decoded with the same layout.
//  • The live HOOD deploys use locker 0xE4910b09…4A09 (ClankerLpLockerFeeConversion v1.1). The SDK's locker
//    0x290F735F…Bc99 returns enabledLockers(locker, HookStaticFeeV2) == FALSE on HOOD, so we use 0xE491….
//  • MEV module 0xEA1F…299e (descending sniper fee: 666777 → 41673 over 15 s, parabolic), dev-buy extension
//    0xa27b…ff5a, HookStaticFeeV2 0x48B8…e8cc, WETH 0x0Bd7…AD73, FeeLocker 0x88db…d70c.
//  • `cast call` of exactly this encoding (rewards [creator 7000, platform 3000], 1% static fee, 0.001 ETH dev
//    buy) from a funded account succeeded and returned a token address; estimateGas ≈ 4.39M.
// Rewards: bps have no setter; each slot's admin only controls its own slot — creator admins theirs, the platform
// admins its 30% slot. The locker owner can withdraw stray ERC20/ETH held by the locker itself (not LP/fees).
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, deploymentOf } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { BRAND } from "@shared/brand";
import { tokenStore } from "../../store";
import { CLANKER_FACTORY_ABI, CLANKER_FEE_LOCKER_ABI, CLANKER_LOCKER_ABI } from "../abis";
import { B0, fromUnits, launchEnv, randomHex32, toUnits } from "../env";
import { evmClient, gasPriceWei, simulateEvm } from "../evm";
import { clankerQuote } from "../math";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";

const CHAIN = "hood" as const;
const CHAIN_ID = CHAINS.hood.evmChainId ?? 4663;
const dep = deploymentOf("clanker", CHAIN)!;
const FACTORY = getAddress(dep.contracts.factory);
const HOOK_STATIC_V2 = getAddress("0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc");
export const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const CLANKER_LOCKER = getAddress("0xE4910b09709423aFafD995dD76D8A81CF9134A09");
const LOCKER = CLANKER_LOCKER;
const MEV_MODULE = getAddress("0xEA1Fe197dF140e5d88fC6B49f2d21Ea05092299e");
const DEV_BUY_EXT = getAddress("0xa27b1986e5c7e5371Cb6507f87918fBD0302fF5a");
export const CLANKER_FEE_LOCKER = getAddress("0x88db2340bE5991B2b5Fca2Baee39B5CE048Cd70c");

const FEE_LOCKER = CLANKER_FEE_LOCKER;

const TICK_START = -230400;
const TICK_UPPER = -120000;
const TICK_SPACING = 200;
const STATIC_FEE_UNI_BPS = 10_000; // 1% each side (uniBps: 1_000_000 = 100%) — clanker SDK "StaticBasic"
const SNIPER = { startingFee: 666_777, endingFee: 41_673, secondsToDecay: BigInt(15) };
const FEE_IN_PAIRED = 1; // FeeIn { Both, Paired, Clanker } → receive rewards in WETH
const GAS_FALLBACK = BigInt(5_500_000);

const POOL_INIT_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "extension", type: "address" },
      { name: "extensionData", type: "bytes" },
      { name: "feeData", type: "bytes" },
    ],
  },
] as const;
const STATIC_FEE_PARAMS = [{ type: "uint24" }, { type: "uint24" }] as const;
const LOCKER_DATA_PARAMS = [{ type: "tuple", components: [{ name: "feePreference", type: "uint8[]" }] }] as const;
const MEV_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "startingFee", type: "uint24" },
      { name: "endingFee", type: "uint24" },
      { name: "secondsToDecay", type: "uint256" },
    ],
  },
] as const;
const DEV_BUY_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
  { type: "uint128" },
  { type: "address" },
] as const;

function clip(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return v.length <= max ? v : v.slice(0, max);
}

export const clankerAdapter: LaunchAdapter = {
  id: "clanker",
  chains: [CHAIN],
  status: "beta",
  socialFees: true,
  note: "deployToken encoding simulated successfully against the live HOOD factory.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (!isAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be an EVM address");
    const creator = getAddress(req.creator);
    // The 70% reward slot goes to the launcher or a social account's SocialVault. A vault admins its own slot and
    // has no function that could reassign it, so the slot is locked to the vault.
    const feeCreator = ctx.feeRecipient ? getAddress(ctx.feeRecipient.address) : creator;
    ctx.meta.feeCreator = feeCreator;
    const blockers: string[] = [];
    const platform = launchEnv.platformTreasuryEvm(CHAIN);
    if (!platform) blockers.push("platform treasury not configured (PLATFORM_TREASURY_EVM)");
    if (platform && platform.toLowerCase() === creator.toLowerCase()) blockers.push("creator wallet cannot be the platform treasury");

    const salt = randomHex32();
    ctx.meta.salt = salt;
    const devWei = toUnits(req.devBuyNative, 18);

    const poolData = encodeAbiParameters(POOL_INIT_PARAMS, [
      {
        extension: zeroAddress,
        extensionData: "0x",
        feeData: encodeAbiParameters(STATIC_FEE_PARAMS, [STATIC_FEE_UNI_BPS, STATIC_FEE_UNI_BPS]),
      },
    ]);
    const lockerData = encodeAbiParameters(LOCKER_DATA_PARAMS, [{ feePreference: [FEE_IN_PAIRED, FEE_IN_PAIRED] }]);
    const mevData = encodeAbiParameters(MEV_PARAMS, [SNIPER]);
    const extensionConfigs =
      devWei > B0
        ? [
            {
              extension: DEV_BUY_EXT,
              msgValue: devWei,
              extensionBps: 0,
              extensionData: encodeAbiParameters(DEV_BUY_PARAMS, [
                { currency0: zeroAddress, currency1: zeroAddress, fee: 0, tickSpacing: 0, hooks: zeroAddress }, // paired = WETH: no pre-swap
                B0, // pairedTokenAmountOutMinimum (unused when paired = WETH)
                creator,
              ]),
            },
          ]
        : [];

    const socials: { platform: string; url: string }[] = [
      { platform: "x", url: clip(req.socials.twitter, 256) },
      { platform: "telegram", url: clip(req.socials.telegram, 256) },
      { platform: "website", url: clip(req.socials.website, 256) },
    ];
    const rewardPlatform: Address = platform ?? creator; // only used for preview/simulation when blocked
    const config = {
      tokenConfig: {
        tokenAdmin: creator,
        name: clip(req.name, 64),
        symbol: clip(req.symbol, 16),
        salt,
        image: clip(req.imageUri, 512),
        metadata: JSON.stringify({ description: clip(req.description, 1000), socialMediaUrls: socials, auditUrls: [] }),
        context: JSON.stringify({ interface: BRAND.name, platform: "", messageId: "", id: "" }),
        originatingChainId: BigInt(CHAIN_ID),
      },
      poolConfig: {
        hook: HOOK_STATIC_V2,
        pairedToken: WETH,
        tickIfToken0IsClanker: TICK_START,
        tickSpacing: TICK_SPACING,
        poolData,
      },
      lockerConfig: {
        locker: LOCKER,
        rewardAdmins: [feeCreator, rewardPlatform],
        rewardRecipients: [feeCreator, rewardPlatform],
        rewardBps: [FEE_SPLIT.creatorBps, FEE_SPLIT.platformBps],
        tickLower: [TICK_START],
        tickUpper: [TICK_UPPER],
        positionBps: [10_000],
        lockerData,
      },
      mevModuleConfig: { mevModule: MEV_MODULE, mevModuleData: mevData },
      extensionConfigs,
    };
    const data = encodeFunctionData({ abi: CLANKER_FACTORY_ABI, functionName: "deployToken", args: [config] });

    const [sim, gasPrice] = await Promise.all([
      simulateEvm(CHAIN, { from: creator, to: FACTORY, data, value: devWei }),
      gasPriceWei(CHAIN),
    ]);
    const gas = sim.gas ? (sim.gas * BigInt(125)) / BigInt(100) : GAS_FALLBACK;
    const txs: PreparedTx[] = blockers.length
      ? []
      : [
          {
            kind: "evm",
            chainId: CHAIN_ID,
            to: FACTORY,
            data,
            value: devWei.toString(),
            gas: gas.toString(),
            description: `Deploy ${config.tokenConfig.symbol} on Clanker${devWei > B0 ? ` + dev buy ${req.devBuyNative} ETH` : ""}`,
          },
        ];
    const errs = [...blockers, ...(sim.ok ? [] : [sim.error ?? "simulation failed"])];
    const q = clankerQuote(req.devBuyNative, STATIC_FEE_UNI_BPS / 100, TICK_START, TICK_UPPER);
    const estGasNative = gasPrice ? fromUnits(gas * gasPrice, 18) : 0;

    return {
      request: req,
      txs,
      predicted: {},
      fees: { launchFeeNative: 0, devBuyNative: req.devBuyNative, estGasNative, totalNative: req.devBuyNative + estGasNative },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: `Clanker rewards.recipients [creator ${FEE_SPLIT.creatorBps}, Claudio ${FEE_SPLIT.platformBps}] — bps immutable, each slot admin controls only its own address`,
        creator: feeCreator,
        platform: platform ?? "",
        warnings: [
          ...LAUNCHPADS.clanker.warnings,
          "Clanker's hook keeps a protocol share of LP fees before rewards are split.",
          "Rewards are paid in WETH to the Clanker FeeLocker; Harvest claims them.",
        ],
      },
      devBuyPreview: { tokensOut: q.tokensOut, supplyPct: q.supplyPct, priceImpactPct: q.priceImpactPct, snipeTaxPct: 0 },
      simulation: { ok: errs.length === 0, error: errs.length ? errs.join("; ") : undefined, gasUsed: sim.gas?.toString() },
    };
  },

  async confirm(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult> {
    const c = evmClient(CHAIN);
    const hash = hashes[hashes.length - 1] as Hex;
    const receipt = await c.waitForTransactionReceipt({ hash, timeout: 45_000 }).catch(() => null);
    if (!receipt) return { status: "submitted" };
    if (receipt.status !== "success") return { status: "failed", error: "deployToken reverted" };
    if (receipt.from.toLowerCase() !== launch.creator.toLowerCase()) return { status: "failed", error: "Transaction was not sent by the launch creator" };
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: CLANKER_FACTORY_ABI, data: log.data, topics: log.topics }) as unknown as {
          eventName: string;
          args: Record<string, unknown>;
        };
        if (ev.eventName === "TokenCreated") {
          const token = getAddress(String(ev.args.tokenAddress));
          tokenStore.markLaunchedHere(`hood:${token.toLowerCase()}`, { kind: "native-locked" });
          return { status: "confirmed", token };
        }
      } catch {
        /* other event */
      }
    }
    return { status: "failed", error: "No TokenCreated event in receipt" };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    if (!launch.token) throw new LaunchError(409, "not_launched", "Launch not confirmed yet");
    const token = getAddress(launch.token);
    const creator = getAddress(launch.creator);
    const feeOwner = launch.meta.feeCreator && isAddress(launch.meta.feeCreator) ? getAddress(launch.meta.feeCreator) : creator;
    const c = evmClient(CHAIN);
    const txs: PreparedTx[] = [];
    const notes: string[] = [];
    const collect = encodeFunctionData({ abi: CLANKER_LOCKER_ABI, functionName: "collectRewards", args: [token] });
    const sim = await simulateEvm(CHAIN, { from: creator, to: LOCKER, data: collect, value: B0 });
    if (sim.ok) {
      txs.push({ kind: "evm", chainId: CHAIN_ID, to: LOCKER, data: collect, value: "0", gas: (sim.gas ? (sim.gas * BigInt(13)) / BigInt(10) : BigInt(900_000)).toString(), description: "Collect LP fees → FeeLocker (70/30)" });
    } else {
      notes.push(`Collect skipped: ${sim.error ?? "nothing to collect"}`);
    }
    for (const t of [WETH, token]) {
      const avail = (await c
        .readContract({ address: FEE_LOCKER, abi: CLANKER_FEE_LOCKER_ABI, functionName: "availableFees", args: [feeOwner, t] })
        .catch(() => B0)) as bigint;
      if (avail > B0) {
        txs.push({
          kind: "evm",
          chainId: CHAIN_ID,
          to: FEE_LOCKER,
          data: encodeFunctionData({ abi: CLANKER_FEE_LOCKER_ABI, functionName: "claim", args: [feeOwner, t] }),
          value: "0",
          gas: "200000",
          description: `Claim ${fromUnits(avail, 18).toPrecision(4)} ${t === WETH ? "WETH" : launch.symbol}`,
        });
      }
    }
    if (!txs.some((t) => t.description.startsWith("Claim"))) notes.push("Nothing claimable in the FeeLocker yet — run Harvest again after collecting.");
    return { txs, notes };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    if (!launch.token) return [];
    const c = evmClient(CHAIN);
    const creator = getAddress(launch.creator);
    const feeOwner = launch.meta.feeCreator && isAddress(launch.meta.feeCreator) ? getAddress(launch.meta.feeCreator) : creator;
    const out: FeeReading[] = [];
    for (const [t, sym] of [[WETH, "WETH"], [getAddress(launch.token), launch.symbol]] as [Address, string][]) {
      try {
        const v = (await c.readContract({ address: FEE_LOCKER, abi: CLANKER_FEE_LOCKER_ABI, functionName: "availableFees", args: [feeOwner, t] })) as bigint;
        const n = fromUnits(v, 18);
        out.push({ label: `FeeLocker (${sym})`, amount: n, symbol: sym, creatorShare: n, note: "Your 70% slot only; uncollected LP fees are added on harvest." });
      } catch {
        /* ignore */
      }
    }
    return out;
  },
};
