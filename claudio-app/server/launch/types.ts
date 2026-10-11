// Launch module internal contracts. Routes talk to adapters only through these shapes.
import type { ChainId } from "@shared/chains";
import type { AdapterStatus, LaunchpadId } from "@shared/launchpads";
import type { FeeShare } from "@shared/social";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";

/**
 * prepared → submitted → confirmed. `failed`: a transaction reverted. `unverified`: the coin exists but its on-chain
 * fee split does not match the planned route (no "launched here" badge, no collector payouts).
 */
export type LaunchStatus = "prepared" | "submitted" | "confirmed" | "failed" | "unverified";

/** A launch prepared/confirmed through Claudio. Never contains secrets (mint keypairs are discarded after signing). */
export interface LaunchRecord {
  id: string;
  chain: ChainId;
  launchpad: LaunchpadId;
  /** EVM addresses are stored lowercase; Solana base58 as-is. */
  creator: string;
  name: string;
  symbol: string;
  imageUri?: string;
  metadataUri?: string;
  request: LaunchRequest;
  token?: string;
  /** Pons bonding curve / pump bonding-curve PDA. */
  curve?: string;
  /** EVM FeeSplitter clone / pump sharing_config PDA. */
  splitter?: string;
  splitKind: string;
  /** Creator share routed to a social account's vault instead of `creator` ("x:44196397"). */
  beneficiaryIdentity?: string;
  beneficiaryVault?: string;
  /**
   * Set when the creator side is split between the launcher and social accounts: every recipient and its bps.
   * The ShareSplitter address is `meta.shareSplitter` (factory/salt in `meta.shareFactory` / `meta.shareSalt`).
   */
  shares?: FeeShare[];
  /** Adapter-private, non-secret data needed later (salt, layout, sharing config…). */
  meta: Record<string, string>;
  /** Agent the launch belongs to (hosted → creator share to its escrow; external → its own wallet). */
  agentId?: string;
  launchedBy?: "human" | "agent";
  /** The fee route the plan wrote on-chain (Solana): confirm verifies the sharing config against it. */
  feeRoute?: FeeRoute;
  txHashes: string[];
  status: LaunchStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Planned creator-fee route. Bps of the creator fees (pump.fun shareholders). */
export interface FeeRoute {
  creator: { address: string; bps: number; kind: "wallet" | "agent"; agentSlug?: string; agentName?: string };
  platform: { address: string; bps: number };
}

/** Mutable context handed to `plan()`; adapters write non-secret bookkeeping into `meta`. */
export interface PlanContext {
  launchId: string;
  meta: Record<string, string>;
  /** Where the creator share goes when it isn't the signing wallet (a SocialVault). Adapters must honour it. */
  feeRecipient?: { address: string; identityKey: string; label: string };
  /**
   * Solana: who receives the creator share instead of the signing wallet (a hosted agent's escrow). Unlike
   * `feeRecipient` (EVM social vaults) adapters that support it write it as the on-chain shareholder.
   */
  creatorShareTo?: { address: string; kind: "agent"; agentSlug?: string; agentName?: string };
}

export interface ConfirmResult {
  status: LaunchStatus;
  token?: string;
  curve?: string;
  splitter?: string;
  error?: string;
}

export interface HarvestResult {
  txs: PreparedTx[];
  notes: string[];
}

export interface FeeReading {
  label: string;
  amount: number;
  symbol: string;
  /** What the creator gets after the 70/30 split, when it applies to this reading. */
  creatorShare?: number;
  note?: string;
}

export interface LaunchAdapter {
  id: LaunchpadId;
  chains: ChainId[];
  status: AdapterStatus;
  /** Short human note shown next to the adapter status in the UI. */
  note?: string;
  /** Honours `ctx.feeRecipient` (a SocialVault or ShareSplitter as the creator-fee recipient). */
  socialFees?: boolean;
  plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan>;
  confirm?(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult>;
  harvest?(launch: LaunchRecord): Promise<HarvestResult>;
  fees?(launch: LaunchRecord): Promise<FeeReading[]>;
}

/** Error with an HTTP status + stable machine code, thrown by adapters and caught by routes. */
export class LaunchError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Public view of a launch (no request internals beyond what is already on-chain). */
export interface PublicLaunch {
  id: string;
  chain: ChainId;
  launchpad: LaunchpadId;
  creator: string;
  name: string;
  symbol: string;
  imageUri?: string;
  token?: string;
  curve?: string;
  splitter?: string;
  splitKind: string;
  txHashes: string[];
  status: LaunchStatus;
  error?: string;
  launchedBy?: "human" | "agent";
  createdAt: number;
  updatedAt: number;
}

export function toPublicLaunch(r: LaunchRecord): PublicLaunch {
  return {
    id: r.id,
    chain: r.chain,
    launchpad: r.launchpad,
    creator: r.creator,
    name: r.name,
    symbol: r.symbol,
    imageUri: r.imageUri,
    token: r.token,
    curve: r.curve,
    splitter: r.splitter,
    splitKind: r.splitKind,
    txHashes: r.txHashes,
    status: r.status,
    error: r.error,
    launchedBy: r.launchedBy ?? "human",
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
