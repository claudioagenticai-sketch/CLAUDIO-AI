// Flap adapter (Robinhood Chain) — status: beta.
//
// Verified read-only on 2026-09-28 against https://rpc.mainnet.chain.robinhood.com (re-run: server/launch/flap-bags.check.ts):
//  • Portal proxy 0x2660…Eb09 → impl 0xf920…bd99, Sourcify exact match (src/Portal.sol, src/interfaces/IPortal.sol).
//    newTokenV6(NewTokenV6Params) selector 0x8cb5772c is in the impl bytecode; the struct layout is the verified one.
//  • Real HOOD launches use exactly this path: in a ~17 h window 113 direct newTokenV6 calls, all TOKEN_TAXED_V3
//    (tokenVersion 6), V2 migrator, FOUR_FIFTHS threshold, native quote, e.g. tx 0x8b5466a2…7397 (4.88M gas).
//  • Token address = CREATE2(Portal, salt, EIP-1167 clone of FlapTaxTokenV3 0x7777…3333); it must end in 7777
//    (VanityAddressRequirementNotMet otherwise). Reproduced for two real launches before relying on it.
//  • eth_call + estimateGas of our encoding from a fresh address funded by stateOverride (beneficiary = an undeployed
//    address, mktBps 10000, 3% tax) returned exactly the mined token address: 4.78M gas without dev buy, 5.26M with
//    0.001 ETH. Asymmetric 1%/5%, 0%/3% and 10% taxes also succeed. A non-tax token (TOKEN_V2_PERMIT via V6) reverts
//    with FeatureDisabled on HOOD, so this adapter only launches tax tokens.
//  • Fee flow (traced with debug_traceTransaction on rpc.ordofi.network): bonding-curve tax is wrapped into the
//    token's TaxProcessor; its dispatch unwraps and pushes the market share as native ETH to `marketAddress` with a
//    plain call forwarding all gas (tx 0x32a38a4b…9374). The FeeSplitter clone accepts that ETH in its fast path.
//  • Beneficiary = marketAddress is chosen freely at launch. Only Flap's DEFAULT_ADMIN_ROLE (setTokenBeneficiary) and
//    admin/TAX_MANAGER/MANAGE roles (updateTaxTokenAddresses) can rewire it later — the creator cannot, and our
//    FeeSplitter has no function that could. Hence split kind "splitter-weak".
// Metadata: `meta` is a bare IPFS CID of Flap's JSON ({description, image: <cid>, website, twitter, telegram, …}),
// e.g. bafkreidfqn7w…l5oe on real launches. We pin that JSON ourselves (Pinata via storeJson); funcs.flap.sh is not
// required — third-party launch bots do the same.
// NOT verified: that Flap's own UI indexes metadata pinned outside funcs.flap.sh (the chain does not care).
import { decodeEventLog, encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { keccak_256 } from "@noble/hashes/sha3";
import { randomBytes } from "crypto";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, deploymentOf } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { tokenStore } from "../../store";
import { FLAP_CURVE_MODULE_ABI, FLAP_PORTAL_ABI, FLAP_TAX_ABI, SPLITTER_ABI } from "../abis";
import { B0, BPS, fromUnits, launchEnv, pow10, toUnits } from "../env";
import { evmClient, gasPriceWei, simulateEvm } from "../evm";
import { storeJson } from "../uploads";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";
import { SPLITTER_GAS_FALLBACK, prepareSplitter, splitterCreateData, splitterCreateTx, withMargin } from "./evmSplitter";

const CHAIN = "hood" as const;
const CHAIN_ID = CHAINS.hood.evmChainId ?? 4663;
const dep = deploymentOf("flap", CHAIN)!;
export const FLAP_PORTAL = getAddress(dep.contracts.portal);
export const FLAP_TAX_V3_IMPL = getAddress(dep.contracts.taxV3Impl);
const CURVE_MODULE = getAddress("0x9a6c0b5d32f83f1498646d7c404b846d18bdb0bf");
const LAUNCH_GAS_FALLBACK = BigInt(6_500_000); // real launches: 4.87–5.01M
const TOTAL_SUPPLY = pow10(27); // 1e9 tokens, 18 decimals
const WAD = pow10(18);

// Enum values from IPortal.sol.
const DEX_THRESH_FOUR_FIFTHS = 1;
const MIGRATOR_V2 = 1;
const TOKEN_TAXED_V3 = 6;
const MIN_TAX_BPS = 100; // any non-zero rate must be ≥ 1%
const MAX_TAX_BPS = 1000;
const DEFAULT_TAX_DURATION = BigInt(3_153_600_000); // 100 years — what real HOOD launches use
const ANTI_FARMER_DURATION = BigInt(31_536_000); // 1 year — what real HOOD launches use (only affects dividends)

/** initcode hash of the EIP-1167 clone the Portal deploys for tax tokens. */
function cloneInitHash(impl: Address): Uint8Array {
  const hex = `3d602d80600a3d3981f3363d3d373d3d3d363d73${impl.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
  return keccak_256(Buffer.from(hex, "hex"));
}

/** Mines a CREATE2 salt so the token address ends in 0x7777 (≈65k keccaks on average). */
export function mineFlapSalt(maxTries = 2_000_000): { salt: Hex; token: Address } {
  const buf = Buffer.alloc(85);
  buf[0] = 0xff;
  Buffer.from(FLAP_PORTAL.slice(2), "hex").copy(buf, 1);
  Buffer.from(cloneInitHash(FLAP_TAX_V3_IMPL)).copy(buf, 53);
  randomBytes(32).copy(buf, 21);
  for (let i = 0; i < maxTries; i++) {
    // Increment the low 4 bytes of the salt as a counter (the high 28 bytes stay random).
    buf.writeUInt32BE(i, 49);
    const h = keccak_256(buf);
    if (h[30] === 0x77 && h[31] === 0x77) {
      return {
        salt: `0x${buf.subarray(21, 53).toString("hex")}`,
        token: getAddress(`0x${Buffer.from(h.subarray(12)).toString("hex")}`),
      };
    }
  }
  throw new LaunchError(503, "salt_mining_failed", "Couldn't mine a Flap vanity salt — try again");
}

export interface FlapLaunchInput {
  name: string;
  symbol: string;
  meta: string;
  salt: Hex;
  quoteAmt: bigint;
  beneficiary: Address;
  buyTaxBps: number;
  sellTaxBps: number;
  taxDuration: bigint;
}

/** Calldata for Portal.newTokenV6 exactly as the adapter sends it (also used by the check script). */
export function encodeFlapLaunch(i: FlapLaunchInput): Hex {
  return encodeFunctionData({
    abi: FLAP_PORTAL_ABI,
    functionName: "newTokenV6",
    args: [
      {
        name: i.name,
        symbol: i.symbol,
        meta: i.meta,
        dexThresh: DEX_THRESH_FOUR_FIFTHS,
        salt: i.salt,
        migratorType: MIGRATOR_V2,
        quoteToken: zeroAddress,
        quoteAmt: i.quoteAmt,
        beneficiary: i.beneficiary,
        permitData: "0x",
        extensionID: `0x${"00".repeat(32)}`,
        extensionData: "0x",
        dexId: 0,
        lpFeeProfile: 0,
        buyTaxRate: i.buyTaxBps,
        sellTaxRate: i.sellTaxBps,
        taxDuration: i.taxDuration,
        antiFarmerDuration: ANTI_FARMER_DURATION,
        // 100% of the tax to the beneficiary (our FeeSplitter); no burn / dividend / LP buckets.
        mktBps: 10_000,
        deflationBps: 0,
        dividendBps: 0,
        lpBps: 0,
        minimumShareBalance: B0,
        dividendToken: zeroAddress,
        // Integrator commission left off: without the (unverified) launcher source we can't prove it isn't carved
        // out of the creator's market share.
        commissionReceiver: zeroAddress,
        tokenVersion: TOKEN_TAXED_V3,
      },
    ],
  });
}

function clip(s: string | undefined, max: number): string {
  const v = (s ?? "").trim();
  return Buffer.byteLength(v, "utf8") <= max ? v : Buffer.from(v, "utf8").subarray(0, max).toString("utf8").replace(/�+$/, "");
}

function bareCid(uri: string): string {
  const m = /^ipfs:\/\/(?:ipfs\/)?(.+)$/.exec(uri.trim()) ?? /\/ipfs\/([^/?#]+)/.exec(uri.trim());
  return m ? m[1] : uri.trim();
}

function taxBps(v: number | undefined): number {
  const n = Math.max(0, Math.floor(v ?? 0));
  if (n === 0) return 0;
  return Math.min(MAX_TAX_BPS, Math.max(MIN_TAX_BPS, n));
}

/** Dev-buy preview on a fresh curve: supply = 1e9 + h − k/(r + reserve), reserve = quote − Flap fee − buy tax. */
async function previewDevBuy(quoteIn: bigint, buyTaxBps: number) {
  const empty = { tokensOut: 0, supplyPct: 0, priceImpactPct: 0 };
  if (quoteIn <= B0) return empty;
  try {
    const c = evmClient(CHAIN);
    const [cfg, fee] = await Promise.all([
      c.readContract({ address: FLAP_PORTAL, abi: FLAP_PORTAL_ABI, functionName: "getQuoteTokenConfiguration", args: [zeroAddress] }) as Promise<{ defaultCurve: number }>,
      c.readContract({ address: FLAP_PORTAL, abi: FLAP_PORTAL_ABI, functionName: "getFeeRate" }) as Promise<readonly [bigint, bigint]>,
    ]);
    const curve = (await c.readContract({ address: CURVE_MODULE, abi: FLAP_CURVE_MODULE_ABI, functionName: "curveByType", args: [cfg.defaultCurve] })) as { r: bigint; h: bigint; k: bigint };
    const reserve = (quoteIn * (BPS - fee[0] - BigInt(buyTaxBps))) / BPS;
    const denom = curve.r + reserve;
    const supply = TOTAL_SUPPLY + curve.h - (curve.k * WAD + denom - BigInt(1)) / denom;
    if (supply <= B0) return empty;
    const tokensOut = fromUnits(supply, 18);
    const d0 = TOTAL_SUPPLY + curve.h;
    const spot0 = fromUnits((curve.k * WAD) / ((d0 * d0) / WAD), 18); // ETH per token at launch
    const avg = fromUnits(quoteIn, 18) / tokensOut;
    return { tokensOut, supplyPct: (tokensOut / 1e9) * 100, priceImpactPct: spot0 > 0 ? Math.max(0, (avg / spot0 - 1) * 100) : 0 };
  } catch {
    return empty;
  }
}

export const flapAdapter: LaunchAdapter = {
  id: "flap",
  chains: [CHAIN],
  status: "beta",
  socialFees: true,
  note: "newTokenV6 (Tax V3) simulated against the live HOOD Portal; beneficiary = Claudio FeeSplitter.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (req.chain !== CHAIN) throw new LaunchError(501, "adapter_planned", `Flap launches are only available on Robinhood Chain for now`);
    if (!isAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be an EVM address");
    const creator = getAddress(req.creator);
    const feeCreator = ctx.feeRecipient ? getAddress(ctx.feeRecipient.address) : creator;
    ctx.meta.feeCreator = feeCreator;

    const buyTax = taxBps(req.tax?.buyBps);
    const sellTax = taxBps(req.tax?.sellBps);
    if (!buyTax && !sellTax) {
      throw new LaunchError(
        400,
        "tax_required",
        "Flap on Robinhood Chain only launches tax tokens (non-tax launches are disabled on-chain), and the tax is the only creator income — set a buy and/or sell tax of 1–10%",
      );
    }
    const warnings: string[] = [...LAUNCHPADS.flap.warnings.filter((w) => !w.includes("BSC"))];
    if (req.tax && (Math.floor(req.tax.buyBps) !== buyTax || Math.floor(req.tax.sellBps) !== sellTax)) {
      warnings.push(`Tax adjusted to Flap's limits (1–10% per side): buy ${buyTax / 100}%, sell ${sellTax / 100}%.`);
    }
    const taxDuration = req.tax?.durationSec && req.tax.durationSec > 0 ? BigInt(Math.floor(req.tax.durationSec)) : DEFAULT_TAX_DURATION;

    const setup = await prepareSplitter(CHAIN, feeCreator, ctx.meta);
    const blockers = [...setup.blockers];
    warnings.push(...setup.warnings);

    // Metadata in Flap's format, pinned by us; `meta` on-chain is the bare CID.
    const metaJson = {
      name: clip(req.name, 64),
      symbol: clip(req.symbol, 16),
      description: clip(req.description, 2048),
      image: bareCid(req.imageUri),
      website: clip(req.socials.website, 256),
      twitter: clip(req.socials.twitter, 256),
      telegram: clip(req.socials.telegram, 256),
      buy: "",
      sell: "",
      creator: creator,
    };
    // `meta` is immutable on-chain and Flap resolves it as a CID: never launch with a local/dev URL.
    let meta = bareCid(req.metadataUri ?? req.imageUri); // dry-run placeholder only
    if (!launchEnv.pinataJwt()) {
      blockers.push("Flap metadata must be pinned to IPFS (set PINATA_JWT)");
    } else {
      try {
        const stored = await storeJson(metaJson, launchEnv.publicBaseUrl() ?? "");
        if (stored.cid) meta = stored.cid;
        else blockers.push("Flap metadata upload returned no IPFS CID");
      } catch (e) {
        throw new LaunchError(502, "metadata_upload_failed", `Couldn't pin Flap metadata: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    ctx.meta.flapMeta = meta;

    const { salt: launchSalt, token } = mineFlapSalt();
    ctx.meta.flapSalt = launchSalt;
    const quoteIn = toUnits(req.devBuyNative, 18);
    // When the splitter can't be predicted we still dry-run the launch (beneficiary = fee creator) to surface
    // on-chain errors, but return no transactions.
    const beneficiary = setup.splitter ?? feeCreator;
    const launchData = encodeFlapLaunch({
      name: clip(req.name, 64),
      symbol: clip(req.symbol, 16),
      meta,
      salt: launchSalt,
      quoteAmt: quoteIn,
      beneficiary,
      buyTaxBps: buyTax,
      sellTaxBps: sellTax,
      taxDuration,
    });

    const [simLaunch, simCreate, gasPrice, preview] = await Promise.all([
      simulateEvm(CHAIN, { from: creator, to: FLAP_PORTAL, data: launchData, value: quoteIn }),
      setup.factory && setup.splitter
        ? simulateEvm(CHAIN, { from: creator, to: setup.factory, data: splitterCreateData(feeCreator, setup.salt), value: B0 })
        : Promise.resolve(undefined),
      gasPriceWei(CHAIN),
      previewDevBuy(quoteIn, buyTax),
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
        to: FLAP_PORTAL,
        data: launchData,
        value: quoteIn.toString(),
        gas: gLaunch.toString(),
        description: `Launch ${clip(req.symbol, 16)} on Flap (tax ${buyTax / 100}%/${sellTax / 100}%)${quoteIn > B0 ? ` + dev buy ${req.devBuyNative} ETH` : ""}`,
      });
    }
    const errs = [
      ...blockers,
      ...(simCreate && !simCreate.ok ? [`splitter: ${simCreate.error}`] : []),
      ...(simLaunch.ok ? [] : [`launch: ${simLaunch.error}`]),
    ];
    const estGasNative = gasPrice ? fromUnits((gLaunch + (setup.splitter ? gCreate : B0)) * gasPrice, 18) : 0;

    return {
      request: req,
      txs,
      predicted: { token, splitter: setup.splitter },
      fees: { launchFeeNative: 0, devBuyNative: req.devBuyNative, estGasNative, totalNative: req.devBuyNative + estGasNative },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: setup.splitter
          ? `Flap tax beneficiary (marketAddress, 100% of the market bucket) = Claudio FeeSplitter ${setup.splitter} (70/30, no setter)`
          : "Flap tax beneficiary = Claudio FeeSplitter (not deployed)",
        creator: feeCreator,
        platform: setup.platform ?? "",
        warnings: [
          "Flap keeps its protocol cut of the tax and a 1% trade fee; the 70/30 applies to what reaches the beneficiary.",
          "Flap admins (DEFAULT_ADMIN / TAX_MANAGER / MANAGE roles) can reassign a token's beneficiary.",
          `The tax also applies to your dev buy and lasts ${taxDuration === DEFAULT_TAX_DURATION ? "for the token's lifetime" : `${taxDuration.toString()} s`}.`,
          ...warnings,
        ],
      },
      devBuyPreview: { ...preview, snipeTaxPct: 0 },
      simulation: { ok: errs.length === 0, error: errs.length ? errs.join("; ") : undefined, gasUsed: simLaunch.gas?.toString() },
    };
  },

  async confirm(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult> {
    const c = evmClient(CHAIN);
    const receipt = await c.waitForTransactionReceipt({ hash: hashes[hashes.length - 1] as Hex, timeout: 45_000 }).catch(() => null);
    if (!receipt) return { status: "submitted" };
    if (receipt.status !== "success") return { status: "failed", error: "Flap launch reverted" };
    if (receipt.from.toLowerCase() !== launch.creator.toLowerCase()) return { status: "failed", error: "Transaction was not sent by the launch creator" };
    let token: string | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== FLAP_PORTAL.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: FLAP_PORTAL_ABI, data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
        if (ev.eventName === "TokenCreated" && String(ev.args.creator).toLowerCase() === launch.creator.toLowerCase()) {
          token = getAddress(String(ev.args.token));
          break;
        }
      } catch {
        /* other Portal event */
      }
    }
    if (!token) return { status: "failed", error: "No Flap TokenCreated event in receipt" };
    let error: string | undefined;
    try {
      const tp = (await c.readContract({ address: token as Address, abi: FLAP_TAX_ABI, functionName: "taxProcessor" })) as Address;
      launch.meta.taxProcessor = tp;
      const market = (await c.readContract({ address: tp, abi: FLAP_TAX_ABI, functionName: "marketAddress" })) as Address;
      if (launch.splitter && market.toLowerCase() !== launch.splitter.toLowerCase()) error = `Tax beneficiary is ${market}, not the FeeSplitter`;
    } catch {
      /* informational only */
    }
    if (!error && hashes.length > 1) {
      const r0 = await c.getTransactionReceipt({ hash: hashes[0] as Hex }).catch(() => null);
      if (r0 && r0.status !== "success") error = "Splitter deployment reverted — fees accrue at the predicted address; deploy it from the Creator dashboard";
    }
    tokenStore.markLaunchedHere(`hood:${token.toLowerCase()}`, { kind: "splitter-weak", splitter: launch.splitter });
    return { status: "confirmed", token, splitter: launch.splitter, error };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    if (!launch.splitter || !launch.token) throw new LaunchError(409, "not_launched", "Launch not confirmed yet");
    const splitter = getAddress(launch.splitter);
    const creator = getAddress(launch.creator);
    const txs: PreparedTx[] = [];
    const notes: string[] = [];
    const data = encodeFunctionData({ abi: SPLITTER_ABI, functionName: "distribute", args: [zeroAddress] });
    const sim = await simulateEvm(CHAIN, { from: creator, to: splitter, data, value: B0 });
    if (sim.ok) {
      txs.push({ kind: "evm", chainId: CHAIN_ID, to: splitter, data, value: "0", gas: (sim.gas ? withMargin(sim.gas) : BigInt(200_000)).toString(), description: "Split the ETH tax held by your FeeSplitter 70/30" });
    } else {
      notes.push(`Nothing to split yet (${sim.error ?? "empty"}).`);
    }
    notes.push("Flap's TaxProcessor pushes the tax to the splitter in ETH when it dispatches (on trades / by Flap's keeper).");
    return { txs, notes };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    if (!launch.splitter) return [];
    const c = evmClient(CHAIN);
    const out: FeeReading[] = [];
    try {
      const n = fromUnits(await c.getBalance({ address: getAddress(launch.splitter) }), 18);
      out.push({ label: "Held by splitter", amount: n, symbol: "ETH", creatorShare: n * 0.7 });
    } catch {
      /* ignore */
    }
    const tp = launch.meta.taxProcessor && isAddress(launch.meta.taxProcessor) ? getAddress(launch.meta.taxProcessor) : undefined;
    if (tp) {
      try {
        const n = fromUnits((await c.readContract({ address: tp, abi: FLAP_TAX_ABI, functionName: "marketQuoteBalance" })) as bigint, 18);
        if (n > 0) out.push({ label: "Pending in Flap TaxProcessor", amount: n, symbol: "ETH", creatorShare: n * 0.7, note: "Pushed to the splitter on the next dispatch." });
      } catch {
        /* ignore */
      }
    }
    return out;
  },
};
