// Dyor V3 (dyorv3.org) adapter (Robinhood Chain) — status: beta.
//
// Verified read-only on 2026-09-28 against https://rpc.mainnet.chain.robinhood.com (scripts: dyor.check.ts):
//  • LaunchFactory proxy 0x80B4…2BF4 → implementation 0xce47…38Fe (EIP-1967 slot), an exact Sourcify match
//    (contracts/LaunchFactory.sol). launch(string,string,string,address,uint256) = 0xdeb026ec is in its dispatcher.
//  • launch(name ≤60 B, symbol ≤20 B, metadataURI, feeRecipient, minTokensOut) is permissionless; msg.value =
//    effectiveLaunchFee(sender) (0.0005 ETH live) + initial buy. `feeRecipient` is any address (0 → msg.sender) and is
//    stored in LaunchLocker.locks(positionId). ⚠️ The initial buy is swapped TO `feeRecipient` — with our splitter as
//    recipient the dev-buy tokens would be split 70/30, so this adapter launches without a dev buy.
//  • LaunchLocker proxy 0xA8fB…5871 → impl 0xbc61…02fb (not on Sourcify). Its 23 dispatcher selectors are exactly the
//    verified LaunchLocker.sol ABI shipped with the factory source: NO fee-recipient setter. harvestToken(token) is
//    permissionless: collects the V3 position, burns the token side and pays 20% of the WETH side as ETH to
//    feeRecipient (70% Dyor devs, 10% treasury). Owner EOA 0xd6e2…4f2E can upgrade factory + locker (splitter-weak).
//  • eth_call of our encoding launch("Claudio Test","FLTST",uri, <FeeSplitter-code address>, 0) with value = launch fee
//    from a funded random account succeeded (gas ≈ 6.42M; returns token, pool, positionId).
//  • eth_call harvestToken on three live launches with the Claudio FeeSplitter runtime placed at their feeRecipient
//    (stateOverride) succeeded and paid out (e.g. #408: 48.65e12 wei collected → 20% to the splitter).
//  • The REST API (/api/v1/launch/prepare) takes the same feeRecipient but was down (HTTP 402 DB quota / health 503)
//    during verification, so we encode the call ourselves — no API key needed.
// NOT verified: FeeSplitterFactory is not deployed on HOOD mainnet yet (FEE_SPLITTER_FACTORY_HOOD) — without it the
// plan comes back with NO transactions.
import { decodeEventLog, encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, deploymentOf } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { tokenStore } from "../../store";
import { DYOR_FACTORY_ABI, DYOR_LOCKER_ABI, SPLITTER_CLAIM_ABI, SPLITTER_FACTORY_ABI } from "../abis";
import { B0, fromUnits, launchEnv, randomHex32 } from "../env";
import { describeEvmError, evmClient, gasPriceWei, simulateEvm } from "../evm";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";

const CHAIN = "hood" as const;
const CHAIN_ID = CHAINS.hood.evmChainId ?? 4663;
const dep = deploymentOf("dyor", CHAIN)!;
const FACTORY = getAddress(dep.contracts.factory);
const LOCKER = getAddress(dep.contracts.locker);
const LAUNCH_GAS_FALLBACK = BigInt(8_000_000); // eth_call estimate 6.42M
const SPLITTER_GAS_FALLBACK = BigInt(350_000);
const CREATOR_SHARE_OF_ETH_FEES = 0.2; // LaunchLocker CREATOR_BPS = 2000

function clip(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return Buffer.byteLength(v, "utf8") <= max ? v : Buffer.from(v, "utf8").subarray(0, max).toString("utf8").replace(/�+$/, "");
}

function withMargin(g: bigint): bigint {
  return (g * BigInt(125)) / BigInt(100);
}

/** LaunchFactory.launch calldata with no initial buy (minTokensOut 0). */
export function dyorLaunchData(name: string, symbol: string, metadataURI: string, feeRecipient: Address): Hex {
  return encodeFunctionData({ abi: DYOR_FACTORY_ABI, functionName: "launch", args: [clip(name, 60), clip(symbol, 20), clip(metadataURI, 512), feeRecipient, B0] });
}

export { FACTORY as DYOR_FACTORY, LOCKER as DYOR_LOCKER };

export const dyorAdapter: LaunchAdapter = {
  id: "dyor",
  chains: [CHAIN],
  status: "beta",
  socialFees: true,
  note: "LaunchFactory.launch simulated against the live HOOD factory; no dev buy; needs the Claudio FeeSplitter factory deployed.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (!isAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be an EVM address");
    const creator = getAddress(req.creator);
    const feeCreator = ctx.feeRecipient ? getAddress(ctx.feeRecipient.address) : creator;
    ctx.meta.feeCreator = feeCreator;
    if (req.devBuyNative > 0) {
      throw new LaunchError(
        400,
        "dev_buy_unsupported",
        "Dyor sends the launch buy to the fee recipient (the 70/30 splitter), so Claudio launches Dyor coins without a dev buy — set it to 0 and buy after launch",
      );
    }
    if (req.tax && (req.tax.buyBps || req.tax.sellBps)) throw new LaunchError(400, "tax_unsupported", "Dyor tokens have no transfer tax");
    const name = clip(req.name, 60);
    const symbol = clip(req.symbol, 20);
    if (!name || !symbol) throw new LaunchError(400, "bad_input", "Name and symbol are required");
    const metadataURI = clip(req.metadataUri || req.imageUri, 512);
    const c = evmClient(CHAIN);
    const blockers: string[] = [];
    const warnings: string[] = [...LAUNCHPADS.dyor.warnings];
    if (!req.metadataUri) warnings.push("No metadata JSON uploaded — the image URI is used as the token URI.");

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

    let launchFee: bigint, gasPrice: bigint | undefined;
    try {
      [launchFee, gasPrice] = await Promise.all([
        c.readContract({ address: FACTORY, abi: DYOR_FACTORY_ABI, functionName: "effectiveLaunchFee", args: [creator] }) as Promise<bigint>,
        gasPriceWei(CHAIN),
      ]);
    } catch (e) {
      throw new LaunchError(503, "rpc_unavailable", `Couldn't read Dyor on Robinhood Chain (${describeEvmError(e)}) — try again shortly`);
    }

    const txs: PreparedTx[] = [];
    let simulation: LaunchPlan["simulation"];
    let gasTotal = LAUNCH_GAS_FALLBACK + SPLITTER_GAS_FALLBACK;
    if (splitter && splitterFactory) {
      const launchData = dyorLaunchData(name, symbol, metadataURI, splitter);
      const createSplitter = encodeFunctionData({ abi: SPLITTER_FACTORY_ABI, functionName: "create", args: [feeCreator, salt] });
      const [simCreate, simLaunch] = await Promise.all([
        simulateEvm(CHAIN, { from: creator, to: splitterFactory, data: createSplitter, value: B0 }),
        simulateEvm(CHAIN, { from: creator, to: FACTORY, data: launchData, value: launchFee }),
      ]);
      const gCreate = simCreate.gas ? withMargin(simCreate.gas) : SPLITTER_GAS_FALLBACK;
      const gLaunch = simLaunch.gas ? withMargin(simLaunch.gas) : LAUNCH_GAS_FALLBACK;
      gasTotal = gCreate + gLaunch;
      if (!blockers.length) {
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
          to: FACTORY,
          data: launchData,
          value: launchFee.toString(),
          gas: gLaunch.toString(),
          description: `Launch ${symbol} on Dyor`,
        });
      }
      const errs = [...blockers, ...(simCreate.ok ? [] : [`splitter: ${simCreate.error}`]), ...(simLaunch.ok ? [] : [`launch: ${simLaunch.error}`])];
      simulation = { ok: errs.length === 0, error: errs.length ? errs.join("; ") : undefined, gasUsed: simLaunch.gas?.toString() };
    } else {
      simulation = { ok: false, error: blockers.join("; ") };
    }

    const estGasNative = gasPrice ? fromUnits(gasTotal * gasPrice, 18) : 0;
    const launchFeeNative = fromUnits(launchFee, 18);
    return {
      request: req,
      txs,
      predicted: { splitter },
      fees: { launchFeeNative, devBuyNative: 0, estGasNative, totalNative: launchFeeNative + estGasNative },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: splitter
          ? `Dyor feeRecipient = Claudio FeeSplitter ${splitter} (immutable 70/30; no setter in LaunchLocker)`
          : "Dyor feeRecipient = Claudio FeeSplitter (not deployed)",
        creator: feeCreator,
        platform: splitterPlatform ?? envPlatform ?? "",
        warnings: [
          "Dyor pays the fee recipient 20% of the ETH side of the 1% LP fee (token side is burned); the 70/30 applies to that 20%.",
          "Dyor's owner EOA can upgrade the factory and locker and so redirect fees.",
          ...warnings,
        ],
      },
      devBuyPreview: { tokensOut: 0, supplyPct: 0, priceImpactPct: 0, snipeTaxPct: 0 },
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
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: DYOR_FACTORY_ABI, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
        if (ev.eventName !== "TokenLaunched") continue;
        const token = getAddress(String(ev.args.token));
        const feeRecipient = getAddress(String(ev.args.feeRecipient));
        launch.meta.pool = getAddress(String(ev.args.pool));
        launch.meta.positionId = String(ev.args.positionId);
        let error: string | undefined;
        if (launch.splitter && feeRecipient.toLowerCase() !== launch.splitter.toLowerCase()) error = `feeRecipient is ${feeRecipient}, not the splitter`;
        if (hashes.length > 1) {
          try {
            const r0 = await c.getTransactionReceipt({ hash: hashes[0] as Hex });
            if (r0.status !== "success") error = "Splitter deployment reverted — fees accrue at the predicted address; deploy it from the Creator dashboard";
          } catch {
            /* pending */
          }
        }
        tokenStore.markLaunchedHere(`hood:${token.toLowerCase()}`, { kind: "splitter-weak", splitter: launch.splitter });
        return { status: "confirmed", token, splitter: launch.splitter, error };
      } catch {
        /* other event */
      }
    }
    return { status: "failed", error: "No TokenLaunched event in receipt" };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    if (!launch.splitter || !launch.token) throw new LaunchError(409, "not_launched", "Launch not confirmed yet");
    const splitter = getAddress(launch.splitter);
    const creator = getAddress(launch.creator);
    const feeCreator = launch.meta.feeCreator && isAddress(launch.meta.feeCreator) ? getAddress(launch.meta.feeCreator) : creator;
    const token = getAddress(launch.token);
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
          description: "Deploy your FeeSplitter (fees already paid to it are kept)",
        });
        notes.push("Splitter was not deployed yet — deploying it first.");
      }
    }
    const harvestData = encodeFunctionData({ abi: DYOR_LOCKER_ABI, functionName: "harvestToken", args: [token] });
    const sim = await simulateEvm(CHAIN, { from: creator, to: LOCKER, data: harvestData, value: B0 });
    if (sim.ok) {
      txs.push({ kind: "evm", chainId: CHAIN_ID, to: LOCKER, data: harvestData, value: "0", gas: withMargin(sim.gas ?? BigInt(500_000)).toString(), description: "Harvest Dyor LP fees (20% of the ETH side → splitter)" });
    } else {
      notes.push(`Dyor harvest skipped: ${sim.error ?? "nothing to harvest"}`);
    }
    txs.push({
      kind: "evm",
      chainId: CHAIN_ID,
      to: splitter,
      data: encodeFunctionData({ abi: SPLITTER_CLAIM_ABI, functionName: "distribute", args: [zeroAddress] }),
      value: "0",
      gas: "250000",
      description: "Split the splitter's ETH 70/30",
    });
    return { txs, notes };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    if (!launch.splitter) return [];
    const c = evmClient(CHAIN);
    const splitter = getAddress(launch.splitter);
    const out: FeeReading[] = [];
    if (launch.token) {
      try {
        // harvestToken returns (totalEth, tokensBurned); eth_call shows what a harvest would collect right now.
        const r = await c.call({ to: LOCKER, data: encodeFunctionData({ abi: DYOR_LOCKER_ABI, functionName: "harvestToken", args: [getAddress(launch.token)] }) });
        if (r.data && r.data.length >= 66) {
          const n = fromUnits(BigInt(r.data.slice(0, 66)), 18) * CREATOR_SHARE_OF_ETH_FEES;
          out.push({ label: "Unharvested LP fees (your 20%)", amount: n, symbol: "ETH", creatorShare: n * 0.7, note: "Paid to the splitter on harvest." });
        }
      } catch {
        /* nothing to collect */
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
