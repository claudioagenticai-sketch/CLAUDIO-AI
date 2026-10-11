// Pons V2 adapter (Robinhood Chain) — status: beta.
//
// Verified on-chain 2026-09-27 (cast against https://rpc.mainnet.chain.robinhood.com):
//  • LaunchAndBuy 0xe33E…2948 `launchAndBuy((string,string,string,string,(string,string,string,string,string),
//    address,uint16,bool,bytes32,bytes32),uint256,address,uint256,uint256,address,address[])` → selector 0xf85f8e41,
//    present in deployed bytecode; struct layout matches Sourcify source; a real launch (tx 0xdfb71fd1…) decodes
//    with it; `cast call` of our encoding with a funded account returned (token, curve, tokensOut) and tokensOut
//    matched ponsQuote() exactly (0.01 ETH → 5,858,334.81 tokens).
//  • Factory reads: launchFee 0.0005 ETH, previewLaunchEconomics(0, 0x0) = 0xa9fc…1ca7, canLaunch = true.
//  • msg.value == launchFee + quoteIn; quoteIn > 0; creatorFeeRecipient != 0; recipient auto snipe-exempt.
//  • Curve.sweepFees may be called by the curve's `deployer` == creatorFeeRecipient (our splitter).
// NOT verified: FeeSplitterFactory is not deployed yet (FEE_SPLITTER_FACTORY_HOOD). Without it the plan is
// returned for review but with NO transactions — launching without the splitter would break the 70/30 rule.
import { decodeEventLog, encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, deploymentOf } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { tokenStore } from "../../store";
import { PONS_ESCROW_ABI, PONS_FACTORY_ABI, PONS_LAUNCH_AND_BUY_ABI, SPLITTER_ABI, SPLITTER_FACTORY_ABI } from "../abis";
import { B0, BPS, fromUnits, launchEnv, randomHex32, toUnits } from "../env";
import { describeEvmError, evmClient, gasPriceWei, simulateEvm } from "../evm";
import { PONS_DEFAULT_CONFIG, ponsQuote, type PonsConfig } from "../math";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";

const CHAIN = "hood" as const;
const CHAIN_ID = CHAINS.hood.evmChainId ?? 4663;
const dep = deploymentOf("pons", CHAIN)!;
const FACTORY = getAddress(dep.contracts.factory);
const ROUTER = getAddress(dep.contracts.launchAndBuy);
const ESCROW = getAddress(dep.contracts.feeEscrow);
export const PONS_MIN_DEV_BUY = 0.0001;
const LAUNCH_GAS_FALLBACK = BigInt(5_000_000); // a real launchAndBuy used 3.80M gas
const SPLITTER_GAS_FALLBACK = BigInt(350_000);

function clip(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return Buffer.byteLength(v, "utf8") <= max ? v : Buffer.from(v, "utf8").subarray(0, max).toString("utf8").replace(/�+$/, "");
}

function withMargin(g: bigint): bigint {
  return (g * BigInt(125)) / BigInt(100);
}

async function readConfig(): Promise<PonsConfig> {
  try {
    const cfg = (await evmClient(CHAIN).readContract({
      address: FACTORY,
      abi: PONS_FACTORY_ABI,
      functionName: "getLaunchConfig",
      args: [B0],
    })) as { supply: bigint; curveFeeBps: bigint; phantomQuote: bigint; graduationThreshold: bigint; enabled: boolean };
    if (cfg && cfg.supply > B0 && cfg.phantomQuote > B0) {
      return { supply: cfg.supply, curveFeeBps: cfg.curveFeeBps, phantomQuote: cfg.phantomQuote, graduationThreshold: cfg.graduationThreshold };
    }
  } catch {
    /* constants below */
  }
  return PONS_DEFAULT_CONFIG;
}

const CURVE_FEE_VIEWS = [
  { type: "function", name: "phantomQuote", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "trackedQuote", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }] },
] as const;

export const ponsAdapter: LaunchAdapter = {
  id: "pons",
  chains: [CHAIN],
  status: "beta",
  socialFees: true,
  note: "LaunchAndBuy encoding verified against the live router; needs the Claudio FeeSplitter factory deployed.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (!isAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be an EVM address");
    const creator = getAddress(req.creator);
    // Who the splitter pays the 70% to: the launcher, or a social account's SocialVault. The launcher still signs,
    // pays and receives the dev-buy tokens either way.
    const feeCreator = ctx.feeRecipient ? getAddress(ctx.feeRecipient.address) : creator;
    ctx.meta.feeCreator = feeCreator;
    if (!(req.devBuyNative >= PONS_MIN_DEV_BUY)) {
      throw new LaunchError(400, "dev_buy_required", `Pons launches through LaunchAndBuy need a dev buy ≥ ${PONS_MIN_DEV_BUY} ETH`);
    }
    const c = evmClient(CHAIN);
    const blockers: string[] = [];
    const warnings: string[] = [...LAUNCHPADS.pons.warnings];

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

    let cfg: PonsConfig, launchFee: bigint, economics: Hex, canLaunch: boolean, gasPrice: bigint | undefined;
    try {
      [cfg, launchFee, economics, canLaunch, gasPrice] = await Promise.all([
        readConfig(),
        c.readContract({ address: FACTORY, abi: PONS_FACTORY_ABI, functionName: "launchFee" }) as Promise<bigint>,
        c.readContract({ address: FACTORY, abi: PONS_FACTORY_ABI, functionName: "previewLaunchEconomics", args: [B0, zeroAddress] }) as Promise<Hex>,
        c.readContract({ address: FACTORY, abi: PONS_FACTORY_ABI, functionName: "canLaunch", args: [creator] }) as Promise<boolean>,
        gasPriceWei(CHAIN),
      ]);
    } catch (e) {
      throw new LaunchError(503, "rpc_unavailable", `Couldn't read Pons on Robinhood Chain (${describeEvmError(e)}) — try again shortly`);
    }
    if (!canLaunch) blockers.push("Pons public launch is closed for this wallet (canLaunch = false)");

    const buyTax = Math.max(0, Math.floor(req.tax?.buyBps ?? 0));
    const sellTax = Math.max(0, Math.floor(req.tax?.sellBps ?? 0));
    const creatorTaxBps = Math.min(1000, Math.max(buyTax, sellTax));
    if (buyTax !== sellTax && (buyTax || sellTax)) warnings.push(`Pons tax is symmetric — using ${creatorTaxBps / 100}% for both buys and sells.`);
    if (creatorTaxBps) warnings.push(`Creator tax ${creatorTaxBps / 100}% is immutable after launch and also applies to your dev buy.`);

    const quoteIn = toUnits(req.devBuyNative, 18);
    const q = ponsQuote(quoteIn, creatorTaxBps, cfg);
    const slip = BigInt(Math.max(0, Math.min(5000, Math.floor(req.slippageBps))));
    const minTokensOut = (q.tokensOut * (BPS - slip)) / BPS;
    if (q.clamped) warnings.push("Dev buy exceeds the curve's sellable supply; the excess ETH is refunded.");

    const params = {
      name: clip(req.name, 64),
      symbol: clip(req.symbol, 16),
      logo: clip(req.imageUri, 512),
      description: clip(req.description, 2048),
      socials: {
        twitter: clip(req.socials.twitter, 256),
        telegram: clip(req.socials.telegram, 256),
        discord: clip(req.socials.discord, 256),
        website: clip(req.socials.website, 256),
        farcaster: clip(req.socials.farcaster, 256),
      },
      creatorFeeRecipient: splitter ?? zeroAddress,
      creatorTaxBps,
      buybackEnabled: false, // buyback would route 50% of the creator bucket (and 30% of its vest) to Pons
      expectedEconomics: economics,
      salt,
    };
    const value = launchFee + quoteIn;

    const txs: PreparedTx[] = [];
    let simulation: LaunchPlan["simulation"];
    let gasTotal = B0;
    if (splitter && splitterFactory) {
      const launchData = encodeFunctionData({
        abi: PONS_LAUNCH_AND_BUY_ABI,
        functionName: "launchAndBuy",
        args: [params, B0, zeroAddress, quoteIn, minTokensOut, creator, []],
      });
      const createData = encodeFunctionData({ abi: SPLITTER_FACTORY_ABI, functionName: "create", args: [feeCreator, salt] });
      const [simCreate, simLaunch] = await Promise.all([
        simulateEvm(CHAIN, { from: creator, to: splitterFactory, data: createData, value: B0 }),
        simulateEvm(CHAIN, { from: creator, to: ROUTER, data: launchData, value }),
      ]);
      const gCreate = simCreate.gas ? withMargin(simCreate.gas) : SPLITTER_GAS_FALLBACK;
      const gLaunch = simLaunch.gas ? withMargin(simLaunch.gas) : LAUNCH_GAS_FALLBACK;
      gasTotal = gCreate + gLaunch;
      if (!blockers.length) {
        // Splitter first: its terms (creator, platform, 70/30) are fixed before any fee can accrue.
        txs.push({
          kind: "evm",
          chainId: CHAIN_ID,
          to: splitterFactory,
          data: createData,
          value: "0",
          gas: gCreate.toString(),
          description: ctx.feeRecipient
            ? `Deploy the 70/30 FeeSplitter ${splitter.slice(0, 8)}… paying ${ctx.feeRecipient.label}`
            : `Deploy your 70/30 FeeSplitter ${splitter.slice(0, 8)}…`,
        });
        txs.push({
          kind: "evm",
          chainId: CHAIN_ID,
          to: ROUTER,
          data: launchData,
          value: value.toString(),
          gas: gLaunch.toString(),
          description: `Launch ${params.symbol} on Pons + dev buy ${req.devBuyNative} ETH`,
        });
      }
      const errs = [
        ...blockers,
        ...(simCreate.ok ? [] : [`splitter: ${simCreate.error}`]),
        ...(simLaunch.ok ? [] : [`launch: ${simLaunch.error}`]),
      ];
      simulation = { ok: errs.length === 0, error: errs.length ? errs.join("; ") : undefined, gasUsed: simLaunch.gas?.toString() };
    } else {
      gasTotal = LAUNCH_GAS_FALLBACK + SPLITTER_GAS_FALLBACK;
      simulation = { ok: false, error: blockers.join("; ") };
    }

    const estGasNative = gasPrice ? fromUnits(gasTotal * gasPrice, 18) : 0;
    const launchFeeNative = fromUnits(launchFee, 18);
    const platformShown = splitterPlatform ?? envPlatform ?? "";

    return {
      request: req,
      txs,
      predicted: { splitter },
      fees: {
        launchFeeNative,
        devBuyNative: req.devBuyNative,
        estGasNative,
        totalNative: launchFeeNative + req.devBuyNative + estGasNative,
      },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: splitter
          ? `Pons creatorFeeRecipient = Claudio FeeSplitter ${splitter} (immutable 70/30, never transfers the role)`
          : "Pons creatorFeeRecipient = Claudio FeeSplitter (not deployed)",
        creator: feeCreator,
        platform: platformShown,
        warnings: [
          "Pons keeps its own 30% protocol cut first; the 70/30 applies to the creator bucket (you net 0.49% of volume).",
          ...warnings,
        ],
      },
      devBuyPreview: {
        tokensOut: fromUnits(q.tokensOut, 18),
        supplyPct: q.supplyPct,
        priceImpactPct: q.priceImpactPct,
        snipeTaxPct: 0, // LaunchAndBuy exempts the dev-buy recipient
      },
      simulation,
    };
  },

  async confirm(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult> {
    const c = evmClient(CHAIN);
    const launchHash = hashes[hashes.length - 1] as Hex;
    const receipt = await c.waitForTransactionReceipt({ hash: launchHash, timeout: 45_000 }).catch(() => null);
    if (!receipt) return { status: "submitted" };
    if (receipt.status !== "success") return { status: "failed", error: "Launch transaction reverted" };
    if (receipt.from.toLowerCase() !== launch.creator.toLowerCase()) {
      return { status: "failed", error: "Transaction was not sent by the launch creator" };
    }
    let token: string | undefined;
    let curve: string | undefined;
    for (const log of receipt.logs) {
      const addr = log.address.toLowerCase();
      if (addr !== FACTORY.toLowerCase() && addr !== ROUTER.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({
          abi: addr === ROUTER.toLowerCase() ? PONS_LAUNCH_AND_BUY_ABI : PONS_FACTORY_ABI,
          data: log.data,
          topics: log.topics,
        }) as unknown as { eventName: string; args: Record<string, unknown> };
        if (ev.eventName === "TokenLaunched" || ev.eventName === "Launched") {
          token = getAddress(String(ev.args.token));
          curve = getAddress(String(ev.args.curve));
          break;
        }
      } catch {
        /* not ours */
      }
    }
    if (!token) return { status: "failed", error: "No TokenLaunched event in receipt" };
    const splitter = launch.splitter;
    tokenStore.markLaunchedHere(`hood:${token.toLowerCase()}`, { kind: "splitter-weak", splitter });
    let error: string | undefined;
    if (hashes.length > 1) {
      try {
        const r0 = await c.getTransactionReceipt({ hash: hashes[0] as Hex });
        if (r0.status !== "success") error = "Splitter deployment reverted — fees accrue at the predicted address; deploy it from the Creator dashboard";
      } catch {
        /* pending */
      }
    }
    return { status: "confirmed", token, curve, splitter, error };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    if (!launch.splitter || !launch.token) throw new LaunchError(409, "not_launched", "Launch not confirmed yet");
    const splitter = getAddress(launch.splitter);
    const creator = getAddress(launch.creator);
    // The splitter was created for the fee recipient (launcher or SocialVault), not necessarily the launcher.
    const feeCreator = launch.meta.feeCreator && isAddress(launch.meta.feeCreator) ? getAddress(launch.meta.feeCreator) : creator;
    const token = getAddress(launch.token);
    const notes: string[] = [];
    const txs: PreparedTx[] = [];
    const c = evmClient(CHAIN);
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
          description: "Deploy your FeeSplitter (fees already accrued there are kept)",
        });
        notes.push("Splitter was not deployed yet — deploying it first.");
      }
    }
    if (launch.curve) {
      const data = encodeFunctionData({ abi: SPLITTER_ABI, functionName: "sweepPonsCurve", args: [getAddress(launch.curve)] });
      const sim = await simulateEvm(CHAIN, { from: creator, to: splitter, data, value: B0 });
      if (sim.ok || txs.length) {
        txs.push({ kind: "evm", chainId: CHAIN_ID, to: splitter, data, value: "0", gas: (sim.gas ? withMargin(sim.gas) : BigInt(400_000)).toString(), description: "Sweep bonding-curve fees into the escrow" });
      } else {
        notes.push(`Curve sweep skipped: ${sim.error ?? "nothing to sweep"} (graduated coins accrue in the hook).`);
      }
    }
    const harvestData = encodeFunctionData({ abi: SPLITTER_ABI, functionName: "harvestPonsEscrow", args: [ESCROW, [token]] });
    txs.push({
      kind: "evm",
      chainId: CHAIN_ID,
      to: splitter,
      data: harvestData,
      value: "0",
      gas: "600000",
      description: "Claim from Pons escrow and split 70/30",
    });
    notes.push("Post-graduation hook fees need sweepPonsPool (creator or platform) — not automated yet.");
    return { txs, notes };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    if (!launch.splitter) return [];
    const c = evmClient(CHAIN);
    const splitter = getAddress(launch.splitter);
    const out: FeeReading[] = [];
    try {
      const eth = (await c.readContract({ address: ESCROW, abi: PONS_ESCROW_ABI, functionName: "balanceOf", args: [splitter] })) as bigint;
      const n = fromUnits(eth, 18);
      out.push({ label: "Pons escrow (ETH)", amount: n, symbol: "ETH", creatorShare: n * 0.7, note: "Unswept curve fees are added on harvest." });
    } catch {
      /* ignore */
    }
    if (launch.curve) {
      // Fees not yet swept off the bonding curve: phantom + trackedQuote − quoteReserve (= pendingFees + creatorTax).
      // Pons keeps 30% of the curve fee; the creator bucket (our splitter) gets the other 70%.
      try {
        const curve = getAddress(launch.curve);
        const [phantom, tracked, reserves] = await Promise.all([
          c.readContract({ address: curve, abi: CURVE_FEE_VIEWS, functionName: "phantomQuote" }),
          c.readContract({ address: curve, abi: CURVE_FEE_VIEWS, functionName: "trackedQuote" }),
          c.readContract({ address: curve, abi: CURVE_FEE_VIEWS, functionName: "getReserves" }),
        ]);
        const pending = phantom + tracked - reserves[0];
        if (pending > B0) {
          const n = fromUnits((pending * BigInt(7)) / BigInt(10), 18);
          out.push({ label: "Unswept curve fees (est.)", amount: n, symbol: "ETH", creatorShare: n * 0.7, note: "Moved to the escrow on harvest." });
        }
      } catch {
        /* graduated curves no longer hold fees */
      }
    }
    try {
      const bal = await c.getBalance({ address: splitter });
      const n = fromUnits(bal, 18);
      if (n > 0) out.push({ label: "Held by splitter", amount: n, symbol: "ETH", creatorShare: n * 0.7 });
    } catch {
      /* ignore */
    }
    if (launch.token) {
      try {
        const t = (await c.readContract({
          address: ESCROW,
          abi: PONS_ESCROW_ABI,
          functionName: "balanceOfToken",
          args: [splitter, getAddress(launch.token)],
        })) as bigint;
        const n = fromUnits(t, 18);
        if (n > 0) out.push({ label: "Pons escrow (token)", amount: n, symbol: launch.symbol, creatorShare: n * 0.7 });
      } catch {
        /* ignore */
      }
    }
    return out;
  },
};
