// Splitting a launch's CREATOR fees between the launcher and social accounts (ShareSplitter).
//
//   launchpad ─► FeeSplitter 70/30 (Pons) or Clanker's 70% reward slot ─► ShareSplitter ─► launcher + SocialVault(s)
//
// The ShareSplitter address is predicted before the launch (its CREATE2 salt commits to the recipients and bps), put
// in the launchpad's creator slot, and created by the first transaction of the launch bundle. Harvests then call
// `distributeMany`, and claimed vaults are swept to their owners.
import { encodeFunctionData, getAddress, isAddress, type Abi, type Address, type Hex } from "viem";
import { CHAINS } from "@shared/chains";
import type { FeeShare } from "@shared/social";
import type { PreparedTx } from "@shared/types";
import { B0, launchEnv, randomHex32 } from "./env";
import { evmClient, simulateEvm } from "./evm";
import { WETH as HOOD_WETH } from "./adapters/clanker";
import type { LaunchRecord } from "./types";

export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const BPS = 10_000;
const CREATE_GAS_FALLBACK = BigInt(600_000);

export const SHARE_FACTORY_ABI = [
  {
    type: "function",
    name: "predict",
    stateMutability: "view",
    inputs: [{ type: "address[]" }, { type: "uint16[]" }, { type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [{ type: "address[]" }, { type: "uint16[]" }, { type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  { type: "function", name: "isSplitter", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const satisfies Abi;

export const SHARE_SPLITTER_ABI = [
  { type: "function", name: "distributeMany", stateMutability: "nonpayable", inputs: [{ type: "address[]" }], outputs: [] },
  { type: "function", name: "distributable", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "recipients",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }, { type: "uint16[]" }],
  },
] as const satisfies Abi;

export interface ShareSetup {
  factory: Address;
  splitter: Address;
  salt: Hex;
  accounts: Address[];
  bps: number[];
  tx: PreparedTx;
  /** "launcher 50% · @alice 30% · @bob 20%" */
  label: string;
}

export function pct(bps: number): string {
  const v = bps / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
}

export function shareLabel(shares: FeeShare[]): string {
  return shares
    .map((s) => `${s.kind === "launcher" ? "launcher" : s.handle ? `@${s.handle}` : s.identityKey} ${pct(s.bps)}`)
    .join(" · ");
}

/** Predicts the ShareSplitter for `shares` and builds the transaction that creates it. */
export async function prepareShareSplitter(chain: LaunchRecord["chain"], from: Address, shares: FeeShare[]): Promise<ShareSetup> {
  const factory = launchEnv.shareFactory(chain);
  if (!factory) throw new Error(`Fee sharing isn't deployed on ${CHAINS[chain].name} yet (ShareSplitterFactory)`);
  const accounts = shares.map((s) => getAddress(s.address));
  const bps = shares.map((s) => s.bps);
  const salt = randomHex32();
  const c = evmClient(chain);
  const splitter = getAddress(
    (await c.readContract({ address: factory, abi: SHARE_FACTORY_ABI, functionName: "predict", args: [accounts, bps, salt] })) as string,
  );
  const data = encodeFunctionData({ abi: SHARE_FACTORY_ABI, functionName: "create", args: [accounts, bps, salt] });
  const sim = await simulateEvm(chain, { from, to: factory, data, value: B0 });
  if (!sim.ok) throw new Error(`fee-share splitter simulation failed: ${sim.error ?? "unknown error"}`);
  const label = shareLabel(shares);
  return {
    factory,
    splitter,
    salt,
    accounts,
    bps,
    label,
    tx: {
      kind: "evm",
      chainId: CHAINS[chain].evmChainId!,
      to: factory,
      data,
      value: "0",
      gas: (sim.gas ? (sim.gas * BigInt(13)) / BigInt(10) : CREATE_GAS_FALLBACK).toString(),
      description: `Create the fee-share splitter (${label})`,
    },
  };
}

/** Recipients stored on a launch that splits its creator side (see routes/launch.ts). */
export function launchShares(launch: LaunchRecord): FeeShare[] {
  return launch.shares ?? [];
}

export function shareSplitterOf(launch: LaunchRecord): Address | undefined {
  const v = launch.meta.shareSplitter;
  return v && isAddress(v) ? getAddress(v) : undefined;
}

/** Assets a launch's fees arrive in: native, the launched token, and WETH where the launchpad pays WETH. */
export function feeAssets(launch: LaunchRecord): Address[] {
  const out: Address[] = [ZERO];
  if (launch.token && isAddress(launch.token)) out.push(getAddress(launch.token));
  if (launch.chain === "hood" && launch.launchpad === "clanker") out.push(HOOD_WETH);
  return out;
}

/**
 * Transactions that (re)create the ShareSplitter if needed and split whatever it holds. Appended after a harvest,
 * whose FeeSplitter / FeeLocker payout lands in the ShareSplitter. Permissionless; no-op amounts are fine.
 */
export async function shareHarvestTxs(launch: LaunchRecord): Promise<PreparedTx[]> {
  const splitter = shareSplitterOf(launch);
  if (!splitter) return [];
  const chainId = CHAINS[launch.chain].evmChainId!;
  const txs: PreparedTx[] = [];
  const code = await evmClient(launch.chain).getCode({ address: splitter }).catch(() => undefined);
  if (!code || code === "0x") {
    const factory = launch.meta.shareFactory && isAddress(launch.meta.shareFactory) ? getAddress(launch.meta.shareFactory) : undefined;
    const shares = launchShares(launch);
    if (factory && launch.meta.shareSalt && shares.length) {
      txs.push({
        kind: "evm",
        chainId,
        to: factory,
        data: encodeFunctionData({
          abi: SHARE_FACTORY_ABI,
          functionName: "create",
          args: [shares.map((s) => getAddress(s.address)), shares.map((s) => s.bps), launch.meta.shareSalt as Hex],
        }),
        value: "0",
        gas: CREATE_GAS_FALLBACK.toString(),
        description: "Deploy the fee-share splitter (fees already sent there are kept)",
      });
    }
  }
  txs.push({
    kind: "evm",
    chainId,
    to: splitter,
    data: encodeFunctionData({ abi: SHARE_SPLITTER_ABI, functionName: "distributeMany", args: [feeAssets(launch)] }),
    value: "0",
    gas: "700000",
    description: `Split the creator share (${shareLabel(launchShares(launch))})`,
  });
  return txs;
}

/** SocialVaults that receive part of this launch's fees (single-beneficiary launches included). */
export function launchVaults(launch: LaunchRecord): Address[] {
  const out = new Set<string>();
  for (const s of launchShares(launch)) if (s.kind === "social" && isAddress(s.address)) out.add(getAddress(s.address));
  if (launch.beneficiaryVault && isAddress(launch.beneficiaryVault)) out.add(getAddress(launch.beneficiaryVault));
  return Array.from(out) as Address[];
}
