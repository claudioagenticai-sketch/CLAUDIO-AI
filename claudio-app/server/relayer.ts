// Gas relayer: a server hot wallet (RELAYER_KEY) that submits a small allowlist of PERMISSIONLESS, harmless
// transactions so users don't need gas: social claims (bind), vault sweeps, and fee harvests.
//
// Safety rules (every one enforced here, not by callers):
//  • Only allowlisted (target kind, function selector) pairs. Targets are verified on-chain to be OUR contracts.
//  • Every tx is simulated first; reverting txs are never sent.
//  • Per-tx gas cap and a per-chain daily spend budget (RELAYER_DAILY_BUDGET, native units, default 0.02).
//  • The relayer never holds user funds: every allowed call pays out to addresses fixed on-chain.
import {
  createWalletClient,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { CHAINS, type ChainId } from "@shared/chains";
import { evmTransport } from "./rpc";
import { evmClient, viemChainFor } from "./trade/evm";
import { describeEvmError } from "./launch/evm";
import { launchEnv } from "./launch/env";
import { socialFactory } from "./social/attest";
import { CLANKER_FEE_LOCKER, CLANKER_LOCKER } from "./launch/adapters/clanker";
import { netSecret } from "./network";

const MAX_GAS = BigInt(2_000_000);
const B0 = BigInt(0);

const ALLOWED = [
  { kind: "socialFactory", sig: "bind(bytes32,address,uint256,bytes,address[])" },
  { kind: "socialVault", sig: "finalize()" },
  { kind: "socialVault", sig: "sweepMany(address[])" },
  { kind: "splitterFactory", sig: "create(address,bytes32)" },
  { kind: "splitter", sig: "sweepPonsCurve(address)" },
  { kind: "splitter", sig: "harvestPonsEscrow(address,address[])" },
  { kind: "splitter", sig: "distributeMany(address[])" },
  { kind: "shareFactory", sig: "create(address[],uint16[],bytes32)" },
  { kind: "shareSplitter", sig: "distributeMany(address[])" },
  { kind: "clankerLocker", sig: "collectRewards(address)" },
  { kind: "clankerFeeLocker", sig: "claim(address,address)" },
] as const;
type TargetKind = (typeof ALLOWED)[number]["kind"];
const SELECTORS = new Map<string, TargetKind[]>();
for (const a of ALLOWED) {
  const sel = toFunctionSelector(`function ${a.sig}`);
  SELECTORS.set(sel, [...(SELECTORS.get(sel) ?? []), a.kind]);
}

const VIEW_ABI = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "isSplitter", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
] as const;

let account: PrivateKeyAccount | null | undefined;
function relayerAccount(): PrivateKeyAccount | null {
  if (account !== undefined) return account;
  const raw = netSecret("RELAYER_KEY");
  account = raw ? privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex) : null;
  return account;
}

export function relayerAddress(): Address | null {
  return relayerAccount()?.address ?? null;
}

export class RelayError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ─── Daily budget (in memory; resets at UTC midnight or restart) ────────────────────────────────

const spent = new Map<ChainId, { day: string; wei: bigint }>();
function budgetWei(chain: ChainId): bigint {
  const v = process.env[`RELAYER_DAILY_BUDGET_${chain.toUpperCase()}`] ?? process.env.RELAYER_DAILY_BUDGET ?? "0.02";
  return parseUnits(v, CHAINS[chain].nativeDecimals);
}
function spentToday(chain: ChainId): bigint {
  const day = new Date().toISOString().slice(0, 10);
  const s = spent.get(chain);
  return s && s.day === day ? s.wei : B0;
}
function addSpent(chain: ChainId, wei: bigint) {
  const day = new Date().toISOString().slice(0, 10);
  spent.set(chain, { day, wei: spentToday(chain) + wei });
}

// ─── Target verification ────────────────────────────────────────────────────────────────────────

async function isKind(chain: ChainId, to: Address, kind: TargetKind): Promise<boolean> {
  const c = evmClient(chain);
  switch (kind) {
    case "socialFactory":
      return socialFactory(chain) === to;
    case "socialVault": {
      const f = socialFactory(chain);
      if (!f) return false;
      const owner = await c.readContract({ address: to, abi: VIEW_ABI, functionName: "factory" }).catch(() => null);
      return !!owner && getAddress(owner) === f;
    }
    case "splitterFactory":
      return launchEnv.splitterFactory(chain) === to;
    case "splitter": {
      const f = launchEnv.splitterFactory(chain);
      if (!f) return false;
      return (await c.readContract({ address: f, abi: VIEW_ABI, functionName: "isSplitter", args: [to] }).catch(() => false)) === true;
    }
    case "shareFactory":
      return launchEnv.shareFactory(chain) === to;
    case "shareSplitter": {
      const f = launchEnv.shareFactory(chain);
      if (!f) return false;
      return (await c.readContract({ address: f, abi: VIEW_ABI, functionName: "isSplitter", args: [to] }).catch(() => false)) === true;
    }
    case "clankerLocker":
      return chain === "hood" && to === CLANKER_LOCKER;
    case "clankerFeeLocker":
      return chain === "hood" && to === CLANKER_FEE_LOCKER;
  }
}

export interface RelayResult {
  hash: Hex;
  gasUsed: string;
  costNative: string;
  status: "success" | "reverted";
}

export function relayerEnabled(chain: ChainId): boolean {
  return !!relayerAccount() && CHAINS[chain].kind === "evm" && CHAINS[chain].enabled;
}

/** Validates, simulates and sends one allowlisted call from the relayer wallet, then waits for the receipt. */
export async function relay(chain: ChainId, tx: { to: string; data: string }, label: string): Promise<RelayResult> {
  const acct = relayerAccount();
  if (!acct) throw new RelayError(501, "relayer_unconfigured", "Gasless transactions aren't enabled on this server");
  if (!relayerEnabled(chain)) throw new RelayError(501, "relayer_chain", `Gasless transactions aren't available on ${CHAINS[chain].name}`);
  if (!isAddress(tx.to) || !/^0x[0-9a-fA-F]{8,}$/.test(tx.data)) throw new RelayError(400, "bad_tx", "Malformed transaction");
  const to = getAddress(tx.to);
  const data = tx.data as Hex;

  const kinds = SELECTORS.get(data.slice(0, 10).toLowerCase());
  if (!kinds) throw new RelayError(403, "not_allowed", "That call can't be relayed");
  let allowed = false;
  for (const k of kinds) if (await isKind(chain, to, k)) allowed = true;
  if (!allowed) throw new RelayError(403, "not_allowed", "Target isn't a Claudio contract for that call");

  const c = evmClient(chain);
  let gas: bigint;
  try {
    await c.call({ account: acct.address, to, data });
    gas = await c.estimateGas({ account: acct.address, to, data });
  } catch (e) {
    throw new RelayError(422, "would_revert", describeEvmError(e));
  }
  if (gas > MAX_GAS) throw new RelayError(422, "too_much_gas", "Transaction needs more gas than the relayer allows");
  gas = (gas * BigInt(12)) / BigInt(10);

  const gasPrice = await c.getGasPrice();
  const maxCost = gas * gasPrice;
  if (spentToday(chain) + maxCost > budgetWei(chain)) {
    throw new RelayError(503, "relayer_budget", "Today's gasless budget is used up — sign it from your wallet instead");
  }
  const bal = await c.getBalance({ address: acct.address });
  if (bal < maxCost) throw new RelayError(503, "relayer_empty", "The gas relayer is out of funds — sign it from your wallet instead");

  const wallet = createWalletClient({ account: acct, chain: viemChainFor(chain), transport: evmTransport(chain) });
  const hash = await wallet.sendTransaction({ to, data, gas, value: B0 });
  const r = await c.waitForTransactionReceipt({ hash, timeout: 90_000 });
  const cost = r.gasUsed * r.effectiveGasPrice;
  addSpent(chain, cost);
  console.log(`[relayer] ${chain} ${label} ${hash} ${r.status} gas ${r.gasUsed} (${formatUnits(cost, 18)} ${CHAINS[chain].nativeSymbol})`);
  return { hash, gasUsed: r.gasUsed.toString(), costNative: formatUnits(cost, CHAINS[chain].nativeDecimals), status: r.status };
}

/** Status for /api/relayer (balances are public on-chain anyway). */
export async function relayerStatus() {
  const acct = relayerAccount();
  if (!acct) return { enabled: false as const };
  const chains = await Promise.all(
    (Object.keys(CHAINS) as ChainId[])
      .filter((c) => relayerEnabled(c))
      .map(async (c) => {
        const bal = await evmClient(c).getBalance({ address: acct.address }).catch(() => null);
        return {
          chain: c,
          balance: bal === null ? null : formatUnits(bal, CHAINS[c].nativeDecimals),
          spentToday: formatUnits(spentToday(c), CHAINS[c].nativeDecimals),
          budget: formatUnits(budgetWei(c), CHAINS[c].nativeDecimals),
        };
      }),
  );
  return { enabled: true as const, address: acct.address, chains };
}
