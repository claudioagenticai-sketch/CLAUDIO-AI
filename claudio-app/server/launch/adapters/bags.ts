// Bags adapter (Robinhood Chain) — status: beta.
//
// Verified read-only on 2026-09-28 against https://rpc.mainnet.chain.robinhood.com (re-run: server/launch/flap-bags.check.ts):
//  • BagsFactory proxy 0xe8Cc…Cb37 → UUPS impl 0x7dfa…ef1c, Sourcify exact match (src/BagsFactory.sol,
//    BagsFeeShare.sol, BagsBondingCurve.sol). create 0x2b24d20e and createAndBuy 0x861a5ece are in the impl bytecode.
//  • Real HOOD createAndBuy calls decode with this ABI (e.g. tx 0x1771aa0d…3106, 1.71M gas, claimers [x] / [10000]).
//  • Live config: creationFee 0, graduationThreshold 5 ETH, partnerFeeBps 2500, owner 0xDEf6…9058 (an EOA).
//  • eth_call + estimateGas of our encoding (claimers [undeployed address] / [10000], partner = another address)
//    from a fresh address funded via stateOverride: create → (token, curve), 1.56M gas; createAndBuy 0.001 ETH →
//    1.77M gas. eth_simulateV1 confirms the new fee share lists exactly our claimer.
// Fee semantics (source): every trade pays 2%; half (1% of volume) is wrapped to WETH and credited to the fee share's
// claimers by bps — pre-graduation by the curve, post-graduation by the shared v4 hook. The other half is Bags',
// minus `partnerFeeBps` (25%) for the launch's `partner`, paid from Bags' half, never the creator half.
// We set claimers = [Claudio FeeSplitter clone] / [10000] (FeeSplitter.claimBags pulls and splits 70/30) and
// partner = Claudio's treasury. The creator can't change claimers, but the fee share is owned by the factory owner
// (Bags' EOA), whose setClaimers can rewrite them at any time, and the fee share / curve are beacon proxies Bags can
// upgrade. Hence split kind "splitter-weak".
import { decodeEventLog, encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, deploymentOf } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { tokenStore } from "../../store";
import { BAGS_FACTORY_ABI, BAGS_FEE_SHARE_ABI, SPLITTER_ABI } from "../abis";
import { B0, BPS, fromUnits, pow10, toUnits } from "../env";
import { evmClient, gasPriceWei, simulateEvm, describeEvmError } from "../evm";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";
import { SPLITTER_GAS_FALLBACK, prepareSplitter, splitterCreateData, splitterCreateTx, withMargin } from "./evmSplitter";

const CHAIN = "hood" as const;
const CHAIN_ID = CHAINS.hood.evmChainId ?? 4663;
const dep = deploymentOf("bags", CHAIN)!;
export const BAGS_FACTORY = getAddress(dep.contracts.factory);
const LAUNCH_GAS_FALLBACK = BigInt(2_500_000); // real createAndBuy: ~1.71M
const TX_FEE_BPS = BigInt(200);
// BagsBondingCurve constants (source): vT0 and vQ0 = threshold * 17 / 66.
const INITIAL_VIRTUAL_TOKEN_RESERVES = BigInt("1043787878787878787878787879");
const DEFAULT_THRESHOLD = pow10(18) * BigInt(5);

export interface BagsLaunchInput {
  name: string;
  symbol: string;
  metadataURI: string;
  partner: Address;
  claimer: Address;
  devBuy: boolean;
}

/** Calldata for BagsFactory.create / createAndBuy exactly as the adapter sends it (also used by the check script). */
export function encodeBagsLaunch(i: BagsLaunchInput): Hex {
  return encodeFunctionData({
    abi: BAGS_FACTORY_ABI,
    functionName: i.devBuy ? "createAndBuy" : "create",
    args: [i.name, i.symbol, i.metadataURI, i.partner, [i.claimer], [10_000]],
  });
}

function clip(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return Buffer.byteLength(v, "utf8") <= max ? v : Buffer.from(v, "utf8").subarray(0, max).toString("utf8").replace(/�+$/, "");
}

function previewDevBuy(quoteIn: bigint, threshold: bigint) {
  if (quoteIn <= B0) return { tokensOut: 0, supplyPct: 0, priceImpactPct: 0 };
  const netFactor = BPS - TX_FEE_BPS;
  const grossCap = (() => {
    const needed = (threshold * BPS + netFactor - BigInt(1)) / netFactor;
    return needed < quoteIn ? needed : quoteIn;
  })();
  const net = grossCap - (grossCap * TX_FEE_BPS) / BPS;
  const vQ0 = (threshold * BigInt(17)) / BigInt(66);
  const out = (INITIAL_VIRTUAL_TOKEN_RESERVES * net) / (vQ0 + net);
  const tokensOut = fromUnits(out, 18);
  const spot0 = fromUnits(vQ0, 18) / fromUnits(INITIAL_VIRTUAL_TOKEN_RESERVES, 18);
  const avg = fromUnits(grossCap, 18) / tokensOut;
  return { tokensOut, supplyPct: (tokensOut / 1e9) * 100, priceImpactPct: spot0 > 0 ? Math.max(0, (avg / spot0 - 1) * 100) : 0 };
}

async function feeShareOf(token: Address, meta: Record<string, string>): Promise<Address | undefined> {
  if (meta.feeShare && isAddress(meta.feeShare)) return getAddress(meta.feeShare);
  try {
    const fs = (await evmClient(CHAIN).readContract({ address: BAGS_FACTORY, abi: BAGS_FACTORY_ABI, functionName: "feeShareForToken", args: [token] })) as Address;
    return fs && fs !== zeroAddress ? getAddress(fs) : undefined;
  } catch {
    return undefined;
  }
}

export const bagsAdapter: LaunchAdapter = {
  id: "bags",
  chains: [CHAIN],
  status: "beta",
  socialFees: true,
  note: "BagsFactory create/createAndBuy simulated against the live HOOD factory; claimer = Claudio FeeSplitter.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (req.chain !== CHAIN) throw new LaunchError(501, "adapter_planned", `Bags launches are only available on Robinhood Chain for now`);
    if (!isAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be an EVM address");
    const creator = getAddress(req.creator);
    const feeCreator = ctx.feeRecipient ? getAddress(ctx.feeRecipient.address) : creator;
    ctx.meta.feeCreator = feeCreator;
    const metadataURI = req.metadataUri?.trim();
    if (!metadataURI) throw new LaunchError(400, "metadata_required", "Bags needs a metadata URI — upload metadata first");
    if (req.tax && (req.tax.buyBps > 0 || req.tax.sellBps > 0)) throw new LaunchError(400, "tax_unsupported", "Bags tokens have no transfer tax");

    const c = evmClient(CHAIN);
    const setup = await prepareSplitter(CHAIN, feeCreator, ctx.meta);
    const blockers = [...setup.blockers];
    const warnings = [...LAUNCHPADS.bags.warnings, ...setup.warnings];

    let creationFee: bigint, threshold: bigint;
    try {
      [creationFee, threshold] = await Promise.all([
        c.readContract({ address: BAGS_FACTORY, abi: BAGS_FACTORY_ABI, functionName: "creationFee" }) as Promise<bigint>,
        c.readContract({ address: BAGS_FACTORY, abi: BAGS_FACTORY_ABI, functionName: "graduationThreshold" }).then((v) => v as bigint).catch(() => DEFAULT_THRESHOLD),
      ]);
    } catch (e) {
      throw new LaunchError(503, "rpc_unavailable", `Couldn't read Bags on Robinhood Chain (${describeEvmError(e)}) — try again shortly`);
    }

    const devWei = toUnits(req.devBuyNative, 18);
    const value = creationFee + devWei;
    // Partner = our treasury: Bags pays it 25% of *its own* half of the trade fee (not from the creator half).
    const partner: Address = setup.platform && setup.platform.toLowerCase() !== feeCreator.toLowerCase() ? setup.platform : zeroAddress;
    const claimer = setup.splitter ?? feeCreator; // feeCreator only for the dry-run when the splitter is unavailable
    const data = encodeBagsLaunch({ name: clip(req.name, 64), symbol: clip(req.symbol, 16), metadataURI, partner, claimer, devBuy: devWei > B0 });

    const [simLaunch, simCreate, gasPrice] = await Promise.all([
      simulateEvm(CHAIN, { from: creator, to: BAGS_FACTORY, data, value }),
      setup.factory && setup.splitter
        ? simulateEvm(CHAIN, { from: creator, to: setup.factory, data: splitterCreateData(feeCreator, setup.salt), value: B0 })
        : Promise.resolve(undefined),
      gasPriceWei(CHAIN),
    ]);
    const gLaunch = simLaunch.gas ? withMargin(simLaunch.gas) : LAUNCH_GAS_FALLBACK;
    const gCreate = simCreate?.gas ? withMargin(simCreate.gas) : SPLITTER_GAS_FALLBACK;

    const txs: PreparedTx[] = [];
    if (!blockers.length && setup.factory && setup.splitter) {
      txs.push(
        splitterCreateTx(
          CHAIN,
          setup.factory,
          feeCreator,
          setup.salt,
          gCreate,
          ctx.feeRecipient ? `Deploy the 70/30 FeeSplitter ${setup.splitter.slice(0, 8)}… paying ${ctx.feeRecipient.label}` : `Deploy your 70/30 FeeSplitter ${setup.splitter.slice(0, 8)}…`,
        ),
      );
      txs.push({
        kind: "evm",
        chainId: CHAIN_ID,
        to: BAGS_FACTORY,
        data,
        value: value.toString(),
        gas: gLaunch.toString(),
        description: `Launch ${clip(req.symbol, 16)} on Bags${devWei > B0 ? ` + dev buy ${req.devBuyNative} ETH` : ""}`,
      });
    }
    const errs = [
      ...blockers,
      ...(simCreate && !simCreate.ok ? [`splitter: ${simCreate.error}`] : []),
      ...(simLaunch.ok ? [] : [`launch: ${simLaunch.error}`]),
    ];
    const estGasNative = gasPrice ? fromUnits((gLaunch + (setup.splitter ? gCreate : B0)) * gasPrice, 18) : 0;
    const launchFeeNative = fromUnits(creationFee, 18);

    return {
      request: req,
      txs,
      predicted: { splitter: setup.splitter },
      fees: { launchFeeNative, devBuyNative: req.devBuyNative, estGasNative, totalNative: launchFeeNative + req.devBuyNative + estGasNative },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: setup.splitter
          ? `Bags fee-share claimers = [Claudio FeeSplitter ${setup.splitter}] (100%), split 70/30 on claim`
          : "Bags fee-share claimers = [Claudio FeeSplitter] (not deployed)",
        creator: feeCreator,
        platform: setup.platform ?? "",
        warnings: [
          "The creator half of Bags' 2% fee (1% of volume) is what gets split 70/30.",
          ...(partner !== zeroAddress ? ["Claudio is the Bags partner on this launch (paid from Bags' half, not yours)."] : []),
          ...warnings,
        ],
      },
      devBuyPreview: { ...previewDevBuy(devWei, threshold), snipeTaxPct: 0 },
      simulation: { ok: errs.length === 0, error: errs.length ? errs.join("; ") : undefined, gasUsed: simLaunch.gas?.toString() },
    };
  },

  async confirm(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult> {
    const c = evmClient(CHAIN);
    const receipt = await c.waitForTransactionReceipt({ hash: hashes[hashes.length - 1] as Hex, timeout: 45_000 }).catch(() => null);
    if (!receipt) return { status: "submitted" };
    if (receipt.status !== "success") return { status: "failed", error: "Bags launch reverted" };
    if (receipt.from.toLowerCase() !== launch.creator.toLowerCase()) return { status: "failed", error: "Transaction was not sent by the launch creator" };
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== BAGS_FACTORY.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: BAGS_FACTORY_ABI, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
        if (ev.eventName !== "TokenCreated") continue;
        const token = getAddress(String(ev.args.token));
        const curve = getAddress(String(ev.args.curve));
        const feeShare = getAddress(String(ev.args.feeShare));
        launch.meta.feeShare = feeShare;
        let error: string | undefined;
        try {
          const [addrs] = (await c.readContract({ address: feeShare, abi: BAGS_FEE_SHARE_ABI, functionName: "getClaimers" })) as readonly [readonly Address[], readonly number[]];
          if (launch.splitter && !(addrs.length === 1 && addrs[0].toLowerCase() === launch.splitter.toLowerCase())) error = "Bags fee share claimers don't match the FeeSplitter";
        } catch {
          /* informational only */
        }
        if (!error && hashes.length > 1) {
          const r0 = await c.getTransactionReceipt({ hash: hashes[0] as Hex }).catch(() => null);
          if (r0 && r0.status !== "success") error = "Splitter deployment reverted — fees accrue at the predicted address; deploy it from the Creator dashboard";
        }
        tokenStore.markLaunchedHere(`hood:${token.toLowerCase()}`, { kind: "splitter-weak", splitter: launch.splitter });
        return { status: "confirmed", token, curve, splitter: launch.splitter, error };
      } catch {
        /* other event */
      }
    }
    return { status: "failed", error: "No Bags TokenCreated event in receipt" };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    if (!launch.splitter || !launch.token) throw new LaunchError(409, "not_launched", "Launch not confirmed yet");
    const splitter = getAddress(launch.splitter);
    const feeShare = await feeShareOf(getAddress(launch.token), launch.meta);
    if (!feeShare) throw new LaunchError(503, "fee_share_unknown", "Couldn't find the Bags fee share for this token");
    const txs: PreparedTx[] = [];
    const notes: string[] = [];
    // claim(unwrap=true) sweeps the hook for this pool, pays the splitter in ETH, then splits 70/30. Permissionless.
    const data = encodeFunctionData({ abi: SPLITTER_ABI, functionName: "claimBags", args: [feeShare, true] });
    const sim = await simulateEvm(CHAIN, { from: getAddress(launch.creator), to: splitter, data, value: B0 });
    if (sim.ok) {
      txs.push({ kind: "evm", chainId: CHAIN_ID, to: splitter, data, value: "0", gas: (sim.gas ? withMargin(sim.gas) : BigInt(500_000)).toString(), description: "Claim Bags fees and split 70/30" });
    } else {
      notes.push(`Nothing to claim yet (${sim.error ?? "empty"}).`);
    }
    return { txs, notes };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    if (!launch.splitter || !launch.token) return [];
    const c = evmClient(CHAIN);
    const splitter = getAddress(launch.splitter);
    const out: FeeReading[] = [];
    const feeShare = await feeShareOf(getAddress(launch.token), launch.meta);
    if (feeShare) {
      try {
        const n = fromUnits((await c.readContract({ address: feeShare, abi: BAGS_FEE_SHARE_ABI, functionName: "claimable", args: [splitter] })) as bigint, 18);
        out.push({ label: "Bags fee share (WETH)", amount: n, symbol: "ETH", creatorShare: n * 0.7, note: "Post-graduation hook fees are swept in on claim." });
      } catch {
        /* ignore */
      }
    }
    try {
      const n = fromUnits(await c.getBalance({ address: splitter }), 18);
      if (n > 0) out.push({ label: "Held by splitter", amount: n, symbol: "ETH", creatorShare: n * 0.7 });
    } catch {
      /* ignore */
    }
    return out;
  },
};
