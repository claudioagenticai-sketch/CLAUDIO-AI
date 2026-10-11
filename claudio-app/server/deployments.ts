// Where Claudio's own contracts live on each chain. An env override wins; otherwise the address comes from a
// <chainId>.json deployment record in CLAUDIO_DEPLOYMENTS_DIR.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAddress, isAddress, type Address } from "viem";
import { CHAINS, type ChainId } from "@shared/chains";
import { netEnv } from "./network";

export const DEPLOYABLE = ["FeeSplitter", "FeeSplitterFactory", "SocialVault", "SocialVaultFactory", "ShareSplitter", "ShareSplitterFactory"] as const;
export type Deployable = (typeof DEPLOYABLE)[number];

export interface DeploymentFile {
  chainId: number;
  network: string;
  deployer: string;
  deployedAt: string;
  sourceHash: string;
  method: "create2" | "create";
  config: { owner: string; platformTreasury: string; attestor: string; guardian: string; bindDelay: number; creatorBps: number };
  contracts: Partial<Record<Deployable, string>>;
  txs: Partial<Record<Deployable, string>>;
  smoke?: { at: string; ok: boolean; txs: string[]; notes: string[] };
}

/** Env override names, e.g. FEE_SPLITTER_FACTORY_HOOD (FEE_SPLITTER_FACTORY_HOOD_TESTNET on testnet). */
const ENV_PREFIX: Partial<Record<Deployable, string>> = {
  FeeSplitterFactory: "FEE_SPLITTER_FACTORY",
  SocialVaultFactory: "SOCIAL_VAULT_FACTORY",
  ShareSplitterFactory: "SHARE_SPLITTER_FACTORY",
};

export const DEPLOYMENTS_DIR = (process.env.CLAUDIO_DEPLOYMENTS_DIR)?.trim() || join(process.cwd(), "deployments");

const cache = new Map<number, { at: number; file: DeploymentFile | null }>();

export function deploymentPath(chainId: number): string {
  return join(DEPLOYMENTS_DIR, `${chainId}.json`);
}

export function readDeployment(chainId: number): DeploymentFile | null {
  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.at < 60_000) return hit.file;
  let file: DeploymentFile | null = null;
  try {
    const p = deploymentPath(chainId);
    if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8")) as DeploymentFile;
  } catch {
    file = null;
  }
  cache.set(chainId, { at: Date.now(), file });
  return file;
}

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v.toLowerCase()) ? getAddress(v.toLowerCase()) : undefined;
}

/** Address of one of our contracts on `chain` (env override first, then the committed deployment file). */
export function deployedAddress(chain: ChainId, name: Deployable): Address | undefined {
  const prefix = ENV_PREFIX[name];
  const fromEnv = prefix ? addr(netEnv(`${prefix}_${chain.toUpperCase()}`)) : undefined;
  if (fromEnv) return fromEnv;
  const id = CHAINS[chain].evmChainId;
  return id ? addr(readDeployment(id)?.contracts[name]) : undefined;
}

/** Platform treasury the deployed FeeSplitterFactory was configured with (fallback for PLATFORM_TREASURY_EVM). */
export function deployedTreasury(chain: ChainId): Address | undefined {
  const id = CHAINS[chain].evmChainId;
  return id ? addr(readDeployment(id)?.config.platformTreasury) : undefined;
}
