// Pools (pools.xyz, Uniswap liquidity-launcher) adapter (Robinhood Chain) — status: beta.
//
// Verified read-only on 2026-09-28 against https://rpc.mainnet.chain.robinhood.com (scripts: pools.check.ts):
//  • LiquidityLauncher 0x0000FffF…19C0 is an exact Sourcify match (src/LiquidityLauncher.sol). Its dispatcher holds
//    multicall 0xac9650d8, createToken 0xdec14be1, distributeToken 0xb6982b48, distributeWithNative 0x0ef847b6.
//  • Real launches (e.g. 0xe3e7428c…, 0x3e16f13f…) are multicall([createToken(UERC20 factory 0x0000_00e2…, name,
//    symbol, 18, 1e27, launcher, abi.encode((description, website, image, socialsJson))), distributeToken(token,
//    {InstantLaunchStrategy, 1e27, abi.encode(beneficiary)}, salt)]) — plus distributeWithNative(UniversalRouterStrategy,
//    …) for a dev buy (0x4673b601…). Most recent launches use strategy 0x23f8…27f1 (LP fee 0.25%, tick spacing 25,
//    single position [MIN_LAUNCH_TICK −160100, initialTick 198050], ETH = currency0).
//  • The strategy mints the "Fee Beneficiary" (FEEB) ERC-721 (= its beneficiaryVault 0xd35E…36D7) to `beneficiary`;
//    tokenId == the v4 position id. FEEB has no admin: registerBeneficiary reverts TokenAlreadyExists for a live id;
//    claim(id,0,0) reverts NotBeneficiary(id, caller) unless caller == ownerOf(id). The strategy's feeSplitter
//    0xeFF1…aCDf.collectFees(ids) is permissionless (moves position fees into the FEEB vault).
//  • eth_call of our exact multicall (create + distribute, and create + distribute + 0.005 ETH dev buy) from a funded
//    random account succeeded with beneficiary = an address running the Claudio FeeSplitter runtime (so the FEEB
//    safe-mint to the splitter works): gas ≈ 2.64M (no buy) / 2.52M–2.69M (with buy).
//  • eth_call of FeeSplitter.claimPoolsVault(FEEB, id) with the FeeSplitter runtime placed (stateOverride) at the real
//    FEEB owner of a live launch succeeded (gas ≈ 215k) — the splitter can hold and claim the NFT unchanged.
// The FEEB NFT is transferable only by its holder; our splitter has no NFT-transfer function, so the 70/30 split is
// locked for everyone (no platform admin either). NOT verified: FeeSplitterFactory is not deployed on HOOD mainnet yet
// (FEE_SPLITTER_FACTORY_HOOD) — without it the plan comes back with NO transactions.
import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, deploymentOf } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { tokenStore } from "../../store";
import { POOLS_COLLECTOR_ABI, POOLS_LAUNCHER_ABI, POOLS_STRATEGY_ABI, POOLS_VAULT_ABI, SPLITTER_CLAIM_ABI, SPLITTER_FACTORY_ABI } from "../abis";
import { B0, fromUnits, launchEnv, randomHex32, toUnits } from "../env";
import { describeEvmError, evmClient, gasPriceWei, simulateEvm } from "../evm";
import { clankerQuote } from "../math";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";

const CHAIN = "hood" as const;
const CHAIN_ID = CHAINS.hood.evmChainId ?? 4663;
const dep = deploymentOf("pools", CHAIN)!;
const LAUNCHER = getAddress(dep.contracts.entry);
const TOKEN_FACTORY = getAddress(dep.contracts.tokenFactory);
const STRATEGY = getAddress(dep.contracts.strategy);
const UR_STRATEGY = getAddress(dep.contracts.urStrategy);
const UNIVERSAL_ROUTER = getAddress(dep.contracts.universalRouter);
const SUPPLY = BigInt("1000000000000000000000000000"); // 1e9 × 1e18 (strategy TOTAL_SUPPLY)
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOKEN_CREATED_TOPIC = "0x2e2b3f61b70d2d131b2a807371103cc98d51adcaa5e9a8f9c32658ad8426e74e"; // TokenCreated(address indexed)
const LAUNCH_GAS_FALLBACK = BigInt(3_500_000); // real launches used 2.30M–2.46M
const SPLITTER_GAS_FALLBACK = BigInt(350_000);
// Uniswap v4 router actions (v4-periphery Actions.sol) and UniversalRouter command V4_SWAP.
const V4_SWAP = "0x10";
const ACTIONS = "0x060c0e"; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE

const TOKEN_DATA_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "description", type: "string" },
      { name: "website", type: "string" },
      { name: "image", type: "string" },
      { name: "socials", type: "string" },
    ],
  },
] as const;
const SWAP_PARAMS = [
  {
    type: "tuple",
    components: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint128" },
      { name: "amountOutMinimum", type: "uint128" },
      { name: "minHopPriceX36", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
  },
] as const;
const UR_CONFIG_PARAMS = [
  {
    type: "tuple",
    components: [
      { name: "router", type: "address" },
      { name: "recipient", type: "address" },
      { name: "execData", type: "bytes" },
    ],
  },
] as const;

function clip(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return Buffer.byteLength(v, "utf8") <= max ? v : Buffer.from(v, "utf8").subarray(0, max).toString("utf8").replace(/�+$/, "");
}

function withMargin(g: bigint): bigint {
  return (g * BigInt(125)) / BigInt(100);
}

export interface StrategyInfo {
  vault: Address;
  collector: Address;
  lpFee: number;
  tickSpacing: number;
  initialTick: number;
  minTick: number;
  launcher: Address;
}

async function readStrategy(): Promise<StrategyInfo> {
  const c = evmClient(CHAIN);
  const read = (functionName: string) => c.readContract({ address: STRATEGY, abi: POOLS_STRATEGY_ABI, functionName });
  const [vault, collector, lpFee, tickSpacing, initialTick, minTick, launcher] = await Promise.all([
    read("beneficiaryVault"),
    read("feeSplitter"),
    read("LP_FEE"),
    read("TICK_SPACING"),
    read("initialTick"),
    read("MIN_LAUNCH_TICK"),
    read("launcher"),
  ]);
  return {
    vault: getAddress(vault as string),
    collector: getAddress(collector as string),
    lpFee: Number(lpFee),
    tickSpacing: Number(tickSpacing),
    initialTick: Number(initialTick),
    minTick: Number(minTick),
    launcher: getAddress(launcher as string),
  };
}

/** One UniversalRouter V4_SWAP (exact-in, ETH → token) wrapped for the UniversalRouterStrategy, as pools.xyz does. */
function devBuyConfig(token: Address, recipient: Address, amountIn: bigint, s: StrategyInfo): Hex {
  const poolKey = { currency0: zeroAddress, currency1: token, fee: s.lpFee, tickSpacing: s.tickSpacing, hooks: zeroAddress };
  // amountOutMinimum 0: the buy is executed atomically in the launch tx, right after the pool is created — no one can
  // trade in between, so there is nothing to protect against (the output is fully determined by the amount).
  const swap = encodeAbiParameters(SWAP_PARAMS, [{ poolKey, zeroForOne: true, amountIn, amountOutMinimum: B0, minHopPriceX36: B0, hookData: "0x" }]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [zeroAddress, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [token, recipient, B0]);
  const v4Input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [ACTIONS, [swap, settle, take]]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const execData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }, { type: "uint256" }], [V4_SWAP, [v4Input], deadline]);
  return encodeAbiParameters(UR_CONFIG_PARAMS, [{ router: UNIVERSAL_ROUTER, recipient, execData }]);
}

/** LiquidityLauncher.createToken calldata, exactly as pools.xyz encodes it (launcher holds the supply until distribution). */
export function poolsCreateData(req: Pick<LaunchRequest, "name" | "symbol" | "description" | "imageUri" | "socials">): Hex {
  const socials = JSON.stringify({ telegram: clip(req.socials.telegram, 256), v: 1, x: clip(req.socials.twitter, 256) });
  const tokenData = encodeAbiParameters(TOKEN_DATA_PARAMS, [
    { description: clip(req.description, 1000), website: clip(req.socials.website, 256), image: clip(req.imageUri, 512), socials },
  ]);
  return encodeFunctionData({
    abi: POOLS_LAUNCHER_ABI,
    functionName: "createToken",
    args: [TOKEN_FACTORY, clip(req.name, 64), clip(req.symbol, 16), 18, SUPPLY, LAUNCHER, tokenData],
  });
}

/** multicall([createToken, distributeToken → beneficiary gets the FEEB NFT, optional dev buy → recipient]). */
export function poolsLaunchData(createData: Hex, token: Address, beneficiary: Address, recipient: Address, devWei: bigint, s: StrategyInfo): Hex {
  const calls: Hex[] = [
    createData,
    encodeFunctionData({
      abi: POOLS_LAUNCHER_ABI,
      functionName: "distributeToken",
      args: [token, { strategy: STRATEGY, amount: SUPPLY, configData: encodeAbiParameters([{ type: "address" }], [beneficiary]) }, randomHex32()],
    }),
  ];
  if (devWei > B0) {
    calls.push(
      encodeFunctionData({
        abi: POOLS_LAUNCHER_ABI,
        functionName: "distributeWithNative",
        args: [UR_STRATEGY, devBuyConfig(token, recipient, devWei, s), randomHex32(), devWei],
      }),
    );
  }
  return encodeFunctionData({ abi: POOLS_LAUNCHER_ABI, functionName: "multicall", args: [calls] });
}

export { readStrategy as readPoolsStrategy, LAUNCHER as POOLS_LAUNCHER };

function feebIdFrom(logs: readonly { address: string; topics: readonly string[] }[], vault: string, owner: string): bigint | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase() || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 4) continue;
    if (BigInt(log.topics[1]) !== B0) continue; // mint
    if (getAddress(`0x${log.topics[2].slice(26)}`).toLowerCase() !== owner.toLowerCase()) continue;
    return BigInt(log.topics[3]);
  }
  return undefined;
}

export const poolsAdapter: LaunchAdapter = {
  id: "pools",
  chains: [CHAIN],
  status: "beta",
  socialFees: true,
  note: "LiquidityLauncher multicall simulated against the live HOOD launcher; needs the Claudio FeeSplitter factory deployed.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (!isAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be an EVM address");
    const creator = getAddress(req.creator);
    // The splitter pays the 70% to the launcher or a social account's SocialVault; the launcher signs and gets the dev buy.
    const feeCreator = ctx.feeRecipient ? getAddress(ctx.feeRecipient.address) : creator;
    ctx.meta.feeCreator = feeCreator;
    if (req.tax && (req.tax.buyBps || req.tax.sellBps)) throw new LaunchError(400, "tax_unsupported", "Pools tokens have no transfer tax");
    const c = evmClient(CHAIN);
    const blockers: string[] = [];
    const warnings: string[] = [...LAUNCHPADS.pools.warnings];

    const envPlatform = launchEnv.platformTreasuryEvm(CHAIN);
    if (!envPlatform) blockers.push("platform treasury not configured (PLATFORM_TREASURY_EVM)");

    const splitterFactory = launchEnv.splitterFactory(CHAIN);
    const salt = randomHex32();
    ctx.meta.salt = salt;
    let splitter: Address | undefined;
    let splitterPlatform: Address | undefined;
    if (!splitterFactory) {
      blockers.push("fee splitter not deployed — launch blocked to protect the 70/30 split");
    } else {
      ctx.meta.splitterFactory = splitterFactory;
      try {
        const [pred, treasury, bps] = await Promise.all([
          c.readContract({ address: splitterFactory, abi: SPLITTER_FACTORY_ABI, functionName: "predict", args: [feeCreator, salt] }),
          c.readContract({ address: splitterFactory, abi: SPLITTER_FACTORY_ABI, functionName: "platformTreasury" }),
          c.readContract({ address: splitterFactory, abi: SPLITTER_FACTORY_ABI, functionName: "creatorBps" }),
        ]);
        splitter = getAddress(pred as string);
        splitterPlatform = getAddress(treasury as string);
        if (Number(bps) !== FEE_SPLIT.creatorBps) blockers.push(`splitter factory creatorBps is ${String(bps)}, expected ${FEE_SPLIT.creatorBps}`);
        if (envPlatform && splitterPlatform.toLowerCase() !== envPlatform.toLowerCase()) {
          warnings.push(`FeeSplitterFactory pays ${splitterPlatform}, which differs from PLATFORM_TREASURY_EVM.`);
        }
      } catch (e) {
        blockers.push(`fee splitter factory unreadable: ${describeEvmError(e)}`);
      }
    }

    let s: StrategyInfo, gasPrice: bigint | undefined;
    try {
      [s, gasPrice] = await Promise.all([readStrategy(), gasPriceWei(CHAIN)]);
    } catch (e) {
      throw new LaunchError(503, "rpc_unavailable", `Couldn't read Pools on Robinhood Chain (${describeEvmError(e)}) — try again shortly`);
    }
    if (s.launcher.toLowerCase() !== LAUNCHER.toLowerCase()) blockers.push("Pools strategy is not wired to the LiquidityLauncher");
    ctx.meta.strategy = STRATEGY;
    ctx.meta.vault = s.vault;
    ctx.meta.collector = s.collector;

    const symbol = clip(req.symbol, 16);
    const createData = poolsCreateData(req);
    // The UERC20 address depends on name/symbol/metadata and keccak(msg.sender): ask the launcher itself.
    let token: Address | undefined;
    try {
      const r = await c.call({ account: creator, to: LAUNCHER, data: createData });
      if (r.data && r.data.length >= 66) token = getAddress(`0x${r.data.slice(26, 66)}`);
    } catch (e) {
      blockers.push(`createToken simulation failed: ${describeEvmError(e)}`);
    }

    const devWei = toUnits(req.devBuyNative, 18);
    const txs: PreparedTx[] = [];
    let simulation: LaunchPlan["simulation"];
    let gasTotal = LAUNCH_GAS_FALLBACK + SPLITTER_GAS_FALLBACK;
    if (splitter && splitterFactory && token) {
      const launchData = poolsLaunchData(createData, token, splitter, creator, devWei, s);
      const createSplitter = encodeFunctionData({ abi: SPLITTER_FACTORY_ABI, functionName: "create", args: [feeCreator, salt] });
      const [simCreate, simLaunch] = await Promise.all([
        simulateEvm(CHAIN, { from: creator, to: splitterFactory, data: createSplitter, value: B0 }),
        simulateEvm(CHAIN, { from: creator, to: LAUNCHER, data: launchData, value: devWei }),
      ]);
      const gCreate = simCreate.gas ? withMargin(simCreate.gas) : SPLITTER_GAS_FALLBACK;
      const gLaunch = simLaunch.gas ? withMargin(simLaunch.gas) : LAUNCH_GAS_FALLBACK;
      gasTotal = gCreate + gLaunch;
      if (!blockers.length) {
        // Splitter first so the FEEB NFT is safe-minted to a contract whose terms are already fixed.
        txs.push({
          kind: "evm",
          chainId: CHAIN_ID,
          to: splitterFactory,
          data: createSplitter,
          value: "0",
          gas: gCreate.toString(),
          description: ctx.feeRecipient
            ? `Deploy the 70/30 FeeSplitter ${splitter.slice(0, 8)}… paying ${ctx.feeRecipient.label}`
            : `Deploy your 70/30 FeeSplitter ${splitter.slice(0, 8)}…`,
        });
        txs.push({
          kind: "evm",
          chainId: CHAIN_ID,
          to: LAUNCHER,
          data: launchData,
          value: devWei.toString(),
          gas: gLaunch.toString(),
          description: `Launch ${symbol} on Pools${devWei > B0 ? ` + dev buy ${req.devBuyNative} ETH` : ""}`,
        });
      }
      const errs = [...blockers, ...(simCreate.ok ? [] : [`splitter: ${simCreate.error}`]), ...(simLaunch.ok ? [] : [`launch: ${simLaunch.error}`])];
      simulation = { ok: errs.length === 0, error: errs.length ? errs.join("; ") : undefined, gasUsed: simLaunch.gas?.toString() };
    } else {
      simulation = { ok: false, error: blockers.join("; ") || "token address prediction failed" };
    }

    const estGasNative = gasPrice ? fromUnits(gasTotal * gasPrice, 18) : 0;
    // ETH is currency0, so flip ticks into clankerQuote's "token is the priced asset" orientation.
    const q = clankerQuote(req.devBuyNative, s.lpFee / 100, -s.initialTick, -s.minTick, 1e9);
    return {
      request: req,
      txs,
      predicted: { token, splitter },
      fees: { launchFeeNative: 0, devBuyNative: req.devBuyNative, estGasNative, totalNative: req.devBuyNative + estGasNative },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: splitter
          ? `Pools fee beneficiary (FEEB NFT) = Claudio FeeSplitter ${splitter} (immutable 70/30, can never transfer the NFT)`
          : "Pools fee beneficiary (FEEB NFT) = Claudio FeeSplitter (not deployed)",
        creator: feeCreator,
        platform: splitterPlatform ?? envPlatform ?? "",
        warnings: [...warnings, "Pools keeps most of the 0.25% LP fee; the beneficiary share is split 70/30.", "Fees are claimed as ETH + token from the FEEB vault on Harvest."],
      },
      devBuyPreview: { tokensOut: q.tokensOut, supplyPct: q.supplyPct, priceImpactPct: q.priceImpactPct, snipeTaxPct: 0 },
      simulation,
    };
  },

  async confirm(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult> {
    const c = evmClient(CHAIN);
    const hash = hashes[hashes.length - 1] as Hex;
    const receipt = await c.waitForTransactionReceipt({ hash, timeout: 45_000 }).catch(() => null);
    if (!receipt) return { status: "submitted" };
    if (receipt.status !== "success") return { status: "failed", error: "Launch transaction reverted" };
    if (receipt.from.toLowerCase() !== launch.creator.toLowerCase()) return { status: "failed", error: "Transaction was not sent by the launch creator" };
    const created = receipt.logs.find((l) => l.address.toLowerCase() === LAUNCHER.toLowerCase() && l.topics[0] === TOKEN_CREATED_TOPIC && l.topics[1]);
    if (!created) return { status: "failed", error: "No TokenCreated event in receipt" };
    const token = getAddress(`0x${created.topics[1]!.slice(26)}`);
    const splitter = launch.splitter;
    let error: string | undefined;
    if (splitter && launch.meta.vault) {
      const id = feebIdFrom(receipt.logs, launch.meta.vault, splitter);
      if (id !== undefined) launch.meta.feebId = id.toString();
      else error = "FEEB NFT was not minted to the splitter — check the launch transaction";
    }
    if (hashes.length > 1) {
      try {
        const r0 = await c.getTransactionReceipt({ hash: hashes[0] as Hex });
        if (r0.status !== "success") error = "Splitter deployment reverted — deploy it from the Creator dashboard before harvesting";
      } catch {
        /* pending */
      }
    }
    tokenStore.markLaunchedHere(`hood:${token.toLowerCase()}`, { kind: "splitter", splitter });
    return { status: "confirmed", token, splitter, error };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    if (!launch.splitter || !launch.token) throw new LaunchError(409, "not_launched", "Launch not confirmed yet");
    const id = launch.meta.feebId ? BigInt(launch.meta.feebId) : undefined;
    const vault = launch.meta.vault && isAddress(launch.meta.vault) ? getAddress(launch.meta.vault) : undefined;
    const collector = launch.meta.collector && isAddress(launch.meta.collector) ? getAddress(launch.meta.collector) : undefined;
    if (id === undefined || !vault) throw new LaunchError(409, "feeb_unknown", "FEEB token id unknown for this launch");
    const splitter = getAddress(launch.splitter);
    const creator = getAddress(launch.creator);
    const feeCreator = launch.meta.feeCreator && isAddress(launch.meta.feeCreator) ? getAddress(launch.meta.feeCreator) : creator;
    const c = evmClient(CHAIN);
    const txs: PreparedTx[] = [];
    const notes: string[] = [];
    const factory = launch.meta.splitterFactory && isAddress(launch.meta.splitterFactory) ? getAddress(launch.meta.splitterFactory) : undefined;
    const salt = launch.meta.salt as Hex | undefined;
    if (factory && salt) {
      const deployed = (await c.readContract({ address: factory, abi: SPLITTER_FACTORY_ABI, functionName: "isDeployed", args: [feeCreator, salt] })) as boolean;
      if (!deployed) {
        txs.push({
          kind: "evm",
          chainId: CHAIN_ID,
          to: factory,
          data: encodeFunctionData({ abi: SPLITTER_FACTORY_ABI, functionName: "create", args: [feeCreator, salt] }),
          value: "0",
          gas: SPLITTER_GAS_FALLBACK.toString(),
          description: "Deploy your FeeSplitter (it already owns the FEEB NFT)",
        });
        notes.push("Splitter was not deployed yet — deploying it first.");
      }
    }
    if (collector) {
      const data = encodeFunctionData({ abi: POOLS_COLLECTOR_ABI, functionName: "collectFees", args: [[id]] });
      const sim = await simulateEvm(CHAIN, { from: creator, to: collector, data, value: B0 });
      if (sim.ok) {
        txs.push({ kind: "evm", chainId: CHAIN_ID, to: collector, data, value: "0", gas: withMargin(sim.gas ?? BigInt(400_000)).toString(), description: "Collect LP fees into the FEEB vault" });
      } else {
        notes.push(`Fee collection skipped: ${sim.error ?? "nothing to collect"}`);
      }
    }
    txs.push({
      kind: "evm",
      chainId: CHAIN_ID,
      to: splitter,
      data: encodeFunctionData({ abi: SPLITTER_CLAIM_ABI, functionName: "claimPoolsVault", args: [vault, id] }),
      value: "0",
      gas: "400000",
      description: "Claim from the FEEB vault and split 70/30",
    });
    return { txs, notes };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    if (!launch.splitter) return [];
    const c = evmClient(CHAIN);
    const splitter = getAddress(launch.splitter);
    const out: FeeReading[] = [];
    const vault = launch.meta.vault && isAddress(launch.meta.vault) ? getAddress(launch.meta.vault) : undefined;
    if (vault && launch.meta.feebId) {
      try {
        const [eth, tok] = (await c.readContract({ address: vault, abi: POOLS_VAULT_ABI, functionName: "amounts", args: [BigInt(launch.meta.feebId)] })) as readonly [bigint, bigint];
        const e = fromUnits(eth, 18);
        const t = fromUnits(tok, 18);
        out.push({ label: "FEEB vault (ETH)", amount: e, symbol: "ETH", creatorShare: e * 0.7, note: "Uncollected LP fees are added on harvest." });
        if (t > 0) out.push({ label: "FEEB vault (token)", amount: t, symbol: launch.symbol, creatorShare: t * 0.7 });
      } catch {
        /* ignore */
      }
    }
    try {
      const bal = await c.getBalance({ address: splitter });
      const n = fromUnits(bal, 18);
      if (n > 0) out.push({ label: "Held by splitter", amount: n, symbol: "ETH", creatorShare: n * 0.7 });
    } catch {
      /* ignore */
    }
    return out;
  },
};
