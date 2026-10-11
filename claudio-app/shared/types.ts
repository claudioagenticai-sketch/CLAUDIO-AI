// Normalized, chain-agnostic data model shared by server (indexers) and client (UI).
// Every launchpad adapter normalizes into these shapes so the UI never branches on launchpad.

import type { ChainId } from "./chains";
import type { LaunchpadId } from "./launchpads";
import type { FeeShare, FeeShareTarget, SocialBeneficiary } from "./social";

/** Column a token lives in on the Trenches board. */
export type TokenPhase = "new" | "almost" | "migrated";

export interface Socials {
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  farcaster?: string;
}

/** Everything a Trenches card needs. Numbers are plain JS numbers (USD or human units) for UI speed. */
export interface TokenSnapshot {
  /** `${chain}:${address}` — globally unique key. */
  key: string;
  chain: ChainId;
  address: string;
  launchpad: LaunchpadId;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  socials: Socials;
  creator: string;
  createdAt: number; // ms epoch
  createTx?: string;

  phase: TokenPhase;
  /** 0–100. For instant-pool launchpads this is a synthetic milestone (see LaunchpadDeployment.milestone). */
  bondingPct: number;
  migratedAt?: number;
  /** Pre-migration: bonding-curve contract/account. Post-migration: AMM pool (or v4 PoolId). */
  pool?: string;
  /** Post-migration AMM venue, e.g. "uniswap-v4", "pumpswap", "pancake-v2". */
  venue?: string;
  /** Pair/quote symbol, e.g. ETH, SOL, USDG, NVDA. Stock-paired memes are a first-class filter. */
  quoteSymbol: string;
  stockPaired?: boolean;

  // Market
  priceUsd: number;
  priceNative: number;
  mcapUsd: number;
  liquidityUsd: number;
  volume5mUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buys5m: number;
  sells5m: number;
  txCount: number;
  change5mPct: number;
  change1hPct: number;
  athMcapUsd: number;

  // Tax
  buyTaxBps: number;
  sellTaxBps: number;
  taxEndsAt?: number;

  // Holder analytics (computed by server/analytics)
  holders: number;
  top10Pct: number;
  devHoldPct: number;
  snipersPct: number;
  snipersCount: number;
  insidersPct: number;
  bundlersPct: number;
  bundlersCount: number;
  freshWalletsPct: number;
  kolBuys: number;
  smartBuys: number;

  // Dev reputation (cross-chain, keyed by creator)
  devLaunches: number;
  devMigrations: number;
  devRugs: number;
  devSold: boolean;

  // Flags
  dexPaid: boolean;
  launchedHere: boolean; // launched through our terminal
  feeSplit?: { kind: "native-locked" | "splitter" | "native-mutable" | "splitter-weak"; splitter?: string };
  alerts: TokenAlert[];

  // GMGN enrichment (server/insights). All optional: absent until GMGN answered for this token.
  /** Share of supply held by bot degens / rat traders, 0–100. */
  botPct?: number;
  ratPct?: number;
  /** GMGN's rug ratio of the dev's history, 0–1. */
  rugRatio?: number;
  /** Distinct KOL / smart-money wallets in the coin (GMGN counts; kolBuys / smartBuys are our own feed's). */
  kolCount?: number;
  smartCount?: number;
  /** Dev's position in this coin: holding / sold some / closed (sold everything). */
  devStatus?: "holding" | "sold" | "closed";
  /** Wallet that funded the dev. */
  devFundedBy?: string;
  /** X (Twitter) followers of the coin's account. */
  xFollowers?: number;
  /** DexScreener: boost active (+ the paid boost amount), ad running, trending bar. */
  dexBoost?: boolean;
  dexBoostFee?: number;
  dexAd?: boolean;
  dexTrending?: boolean;
  /** Community takeover. */
  cto?: boolean;
  /** Real launch platform when `launchpad` is a fallback (e.g. "Meteora DBC" for an on-demand lookup). */
  launchpadLabel?: string;
  /** Unix ms of the last GMGN enrichment. */
  gmgnAt?: number;
  /** Unix ms when holder-mix numbers (GMGN) were last applied; until then zeros on the card mean "unknown". */
  analyticsAt?: number;

  updatedAt: number;
}

export type TokenAlertKind =
  | "dev-sold" | "fee-recipient-change-proposed" | "fee-split-reset" | "large-sell"
  | "honeypot-suspect" | "tax-changed" | "migration" | "cto";

export interface TokenAlert {
  kind: TokenAlertKind;
  at: number;
  message: string;
  severity: "info" | "warn" | "danger";
}

export interface Trade {
  id: string; // tx:logIndex / sig:ixIndex
  key: string; // token key
  chain: ChainId;
  tx: string;
  block: number;
  ts: number;
  side: "buy" | "sell";
  trader: string;
  amountToken: number;
  amountNative: number;
  amountUsd: number;
  priceUsd: number;
  mcapUsd: number;
  /** Tags computed by analytics. */
  tags: TraderTag[];
}

export type TraderTag = "dev" | "sniper" | "insider" | "bundler" | "fresh" | "kol" | "smart" | "whale" | "you" | "tracked";

export interface Candle {
  t: number; // bucket start, seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Holder {
  address: string;
  balance: number;
  pct: number;
  tags: TraderTag[];
  boughtUsd: number;
  soldUsd: number;
  pnlUsd: number;
  isPool?: boolean;
}

export interface TokenDetail extends TokenSnapshot {
  holdersList: Holder[];
  recentTrades: Trade[];
  launchpadMeta: {
    graduationQuote?: number;
    curveSupplyShare?: number;
    migratesTo?: string;
    snipeTax?: { startBps: number; windowSec: number };
  };
}

export interface ChainStatus {
  chain: ChainId;
  source: "live" | "simulated" | "offline";
  latencyMs: number;
  lastBlock: number;
  lastEventAt: number;
  gas?: string; // formatted, e.g. "0.08 Gwei" / "0.00005 SOL"
  nativeUsd: number;
}

// ─── WebSocket protocol ─────────────────────────────────────────────

export type ClientMsg =
  | { t: "sub"; topics: Topic[] }
  | { t: "unsub"; topics: Topic[] }
  | { t: "ping"; ts: number };

/** Topics: "board:<chain>", "token:<key>", "trades:<key>", "wallet:<chain>:<addr>", "status" */
export type Topic = string;

export type ServerMsg =
  | { t: "hello"; serverTime: number; version: string }
  | { t: "pong"; ts: number; serverTime: number }
  | { t: "board"; chain: ChainId; tokens: TokenSnapshot[] } // full snapshot on subscribe
  | { t: "token"; token: TokenSnapshot } // upsert
  | { t: "tokens"; tokens: TokenSnapshot[] } // batched upserts (throttled)
  | { t: "remove"; keys: string[] }
  | { t: "trade"; trade: Trade }
  | { t: "trades"; trades: Trade[] }
  | { t: "status"; chains: ChainStatus[] }
  | { t: "alert"; key: string; alert: TokenAlert };

// ─── Launch ─────────────────────────────────────────────────────────

export interface LaunchRequest {
  chain: ChainId;
  launchpad: LaunchpadId;
  name: string;
  symbol: string;
  description?: string;
  imageUri: string; // ipfs:// or https:// after upload
  metadataUri?: string;
  socials: Socials;
  /** Creator's wallet (receives 70%, signs the tx). */
  creator: string;
  /** Dev buy in native units (ETH/SOL/BNB). */
  devBuyNative: number;
  slippageBps: number;
  tax?: { buyBps: number; sellBps: number; durationSec?: number };
  vanitySalt?: string;
  mayhemMode?: boolean; // pump.fun only — also makes fee split CTO-proof
  quoteToken?: string; // default native
  /** Send the creator share to a social account's claimable vault instead of `creator` (who still signs). */
  beneficiary?: SocialBeneficiary;
  /**
   * Split the creator share between the launcher and social accounts (EVM): e.g. [{x, "alice", 3000}] gives @alice
   * 30% of the creator's 70% and the launcher keeps 70% of it. Takes precedence over `beneficiary`.
   */
  feeShares?: FeeShareTarget[];
  /**
   * Launch "with" one of the signed-in owner's hosted agents: the creator share goes to that agent's escrow wallet
   * (Claudio-operated), not to `creator`. See docs/API.md.
   */
  agentSlug?: string;
}

/** Unsigned transaction(s) the client signs with the user's wallet. */
export type PreparedTx =
  | { kind: "evm"; chainId: number; to: string; data: string; value: string; gas?: string; description: string }
  | { kind: "svm"; base64: string; signers: string[]; description: string; partiallySigned: boolean };

export interface LaunchPlan {
  request: LaunchRequest;
  txs: PreparedTx[];
  predicted: { token?: string; curve?: string; splitter?: string; shareSplitter?: string };
  fees: { launchFeeNative: number; devBuyNative: number; estGasNative: number; totalNative: number };
  split: {
    creatorBps: number;
    platformBps: number;
    mechanism: string;
    creator: string;
    platform: string;
    warnings: string[];
    /** Who shares the creator side (set when it is split between the launcher and social accounts). */
    shares?: FeeShare[];
    /** Who receives the creator share: the signing wallet, or a hosted agent's Claudio-run escrow wallet. */
    recipientKind?: "wallet" | "agent";
    /** Set when recipientKind is "agent". */
    agent?: { slug: string; name: string } | null;
  };
  devBuyPreview: { tokensOut: number; supplyPct: number; priceImpactPct: number; snipeTaxPct: number };
  simulation?: { ok: boolean; error?: string; gasUsed?: string };
}
