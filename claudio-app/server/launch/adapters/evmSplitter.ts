// Shared "single fee recipient = Claudio FeeSplitter clone" plumbing for EVM adapters (Flap, Bags).
// Same checks as pons.ts: the clone is predicted through FeeSplitterFactory for the fee creator (launcher or the
// social vault / share-splitter from ctx.feeRecipient) and the factory must pay FEE_SPLIT.creatorBps.
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import type { ChainId } from "@shared/chains";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT } from "@shared/launchpads";
import type { PreparedTx } from "@shared/types";
import { SPLITTER_FACTORY_ABI } from "../abis";
import { launchEnv, randomHex32 } from "../env";
import { describeEvmError, evmClient } from "../evm";

export const SPLITTER_GAS_FALLBACK = BigInt(350_000);

export function withMargin(g: bigint): bigint {
  return (g * BigInt(125)) / BigInt(100);
}

export interface SplitterSetup {
  factory?: Address;
  salt: Hex;
  /** Predicted clone address (undefined when the factory is missing/unreadable). */
  splitter?: Address;
  /** Treasury the factory writes into every clone. */
  platform?: Address;
  blockers: string[];
  warnings: string[];
}

/** Predicts the FeeSplitter clone for `feeCreator` and validates the factory terms. Never throws. */
export async function prepareSplitter(chain: ChainId, feeCreator: Address, meta: Record<string, string>): Promise<SplitterSetup> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const envPlatform = launchEnv.platformTreasuryEvm(chain);
  if (!envPlatform) blockers.push("platform treasury not configured (PLATFORM_TREASURY_EVM)");
  const factory = launchEnv.splitterFactory(chain);
  const salt = randomHex32();
  meta.salt = salt;
  if (!factory) {
    blockers.push("fee splitter not deployed — launch blocked to protect the 70/30 split");
    return { salt, platform: envPlatform, blockers, warnings };
  }
  meta.splitterFactory = factory;
  const c = evmClient(chain);
  try {
    const [pred, treasury, bps] = await Promise.all([
      c.readContract({ address: factory, abi: SPLITTER_FACTORY_ABI, functionName: "predict", args: [feeCreator, salt] }),
      c.readContract({ address: factory, abi: SPLITTER_FACTORY_ABI, functionName: "platformTreasury" }),
      c.readContract({ address: factory, abi: SPLITTER_FACTORY_ABI, functionName: "creatorBps" }),
    ]);
    const platform = getAddress(treasury as string);
    if (Number(bps) !== FEE_SPLIT.creatorBps) blockers.push(`splitter factory creatorBps is ${String(bps)}, expected ${FEE_SPLIT.creatorBps}`);
    if (envPlatform && platform.toLowerCase() !== envPlatform.toLowerCase()) {
      warnings.push(`FeeSplitterFactory pays ${platform}, which differs from PLATFORM_TREASURY_EVM.`);
    }
    return { factory, salt, splitter: getAddress(pred as string), platform, blockers, warnings };
  } catch (e) {
    blockers.push(`fee splitter factory unreadable: ${describeEvmError(e)}`);
    return { factory, salt, platform: envPlatform, blockers, warnings };
  }
}

export function splitterCreateData(feeCreator: Address, salt: Hex): Hex {
  return encodeFunctionData({ abi: SPLITTER_FACTORY_ABI, functionName: "create", args: [feeCreator, salt] });
}

export function splitterCreateTx(chain: ChainId, factory: Address, feeCreator: Address, salt: Hex, gas: bigint, description: string): PreparedTx {
  return {
    kind: "evm",
    chainId: CHAINS[chain].evmChainId ?? 0,
    to: factory,
    data: splitterCreateData(feeCreator, salt),
    value: "0",
    gas: gas.toString(),
    description,
  };
}
