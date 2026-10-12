// Platform constants and the public platform-config contract (GET /api/platform/config).
// Addresses here are public on-chain facts, committed on purpose: a change shows up in git history,
// while a Replit secret can be edited silently. The server refuses to launch when PLATFORM_TREASURY_SOL
// is set to anything else (see server/platform).
import type { ChainId } from "./chains";
import type { LaunchpadId } from "./launchpads";

/** Receives the platform's 30% of creator fees on every Solana launch made through Claudio. */
export const PLATFORM_FEE_WALLET_SOL = "4Eh38JobinLouigdGceUeMLGJR3B4T9s557xJHdW8n9P";

/** The one official token. Mirrored into the `spl_config` table (exactly one row). */
export const CLAUDIO_TOKEN = {
  key: "claudio",
  chain: "sol" as ChainId,
  mint: "2j5SaS7xy776qCBpyPQbZjyQSAtKiFgrwjfErthnW2ZM",
  symbol: "CLAUDIO",
  name: "Claudio",
  decimals: 6,
  tokenProgram: "token-2022",
} as const;

/** Creator / platform split of a launch's creator fees, in bps. Same numbers as FEE_SPLIT in launchpads.ts. */
export const PLATFORM_SPLIT = { creatorBps: 7000, platformBps: 3000 } as const;

export type SwitchState = "open" | "coming_soon" | "hidden";
export type ChainSwitchState = "open" | "view_only" | "coming_soon";

export interface ChainStatusRow {
  chain: ChainId;
  state: ChainSwitchState;
  note?: string | null;
}

export interface LaunchpadStatusRow {
  launchpad: LaunchpadId;
  chain: ChainId;
  /** What the admin set. */
  state: SwitchState;
  /** What actually applies: never more open than the code can do (an unbuilt adapter stays coming_soon). */
  effective: SwitchState;
  allowAgents: boolean;
  note?: string | null;
}

export interface SplConfigRow {
  key: string;
  chain: "solana";
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
}

/** GET /api/platform/config — public, cached ~15 s, also served while the site is in coming-soon mode. */
export interface PlatformConfig {
  comingSoon: boolean;
  network: "mainnet" | "testnet";
  defaultChain: ChainId;
  defaultLaunchpad: LaunchpadId;
  chains: ChainStatusRow[];
  launchpads: LaunchpadStatusRow[];
  token: SplConfigRow;
  feeWalletSol: string;
  split: typeof PLATFORM_SPLIT;
  /** Feature availability (false when the backing secret / database is missing). */
  features: {
    database: boolean;
    agents: boolean;
    thread: boolean;
    hostedAgents: boolean;
    /** Platform switch `cloud_workspace`: the Cloud workspace is open to hosted-agent owners (admins always). */
    cloudWorkspace: boolean;
    collector: boolean;
    adminLogin: boolean;
  };
}

export const DEFAULT_CHAIN: ChainId = "sol";
export const DEFAULT_LAUNCHPAD: LaunchpadId = "pump";

// ─── Admin + collector contracts (server/platform, client/src/features/admin) ─────────────────────────────────

/** One collector pass (server/platform/collector.ts). Lamports are plain numbers (safe below 9e15). */
export interface CollectorRunSummary {
  id: string;
  trigger: "timer" | "admin" | "boot";
  startedAt: string;
  finishedAt: string | null;
  /** Confirmed Claudio launches looked at. */
  coinsChecked: number;
  /** Coins whose creator vault was distributed in this pass. */
  distributed: number;
  paidLamports: number;
  txs: string[];
  errors: string[];
  /** True when nothing was sent (no key, or a read-only pass). */
  dryRun: boolean;
}

export interface CollectorPayoutRow {
  id: string;
  launchId: string | null;
  tokenKey: string;
  tx: string;
  amountLamports: number;
  recipients: { address: string; bps: number; lamports: number }[];
  at: string;
}

/** GET /api/collector/status (public, no secrets) and the collector block of the admin overview. */
export interface CollectorStatus {
  enabled: boolean;
  /** Why it is disabled (e.g. "COLLECTOR_KEY not set"). */
  reason?: string | null;
  /** The bot's public address (pays the transaction fees of distribute_creator_fees_v2). */
  wallet: string | null;
  balanceSol: number | null;
  lowBalance: boolean;
  alertBelowSol: number;
  minSol: number;
  intervalMin: number;
  running: boolean;
  lastRun: CollectorRunSummary | null;
  nextRunAt: string | null;
  totals: { runs: number; payouts: number; paidOutSol: number };
}

export interface AdminAuditEvent {
  id?: string | number;
  actor: string | null;
  action: string;
  target: string | null;
  severity: string;
  detail: Record<string, unknown>;
  ip?: string | null;
  at: string;
}

/** GET /api/admin/overview */
export interface AdminOverview {
  collector: CollectorStatus;
  feeWallet: { address: string; balanceSol: number | null };
  counts: { launches: number; confirmed: number; submitted: number; failed: number; unverified: number; byAgents: number; last24h: number };
  switches: { chainsOpen: number; launchpadsOpen: number };
  config: {
    network: "mainnet" | "testnet";
    database: boolean;
    pumpLut: string | null;
    pinata: boolean;
    collectorKey: boolean;
    splitLayoutAllowed: boolean;
    /** Set when PLATFORM_TREASURY_SOL differs from PLATFORM_FEE_WALLET_SOL (Solana launches are refused). */
    treasuryEnvConflict: string | null;
  };
  /** Human-readable things the operator should fix. */
  warnings: string[];
  recentAudit: AdminAuditEvent[];
}

/** GET /api/admin/chains → { chains: AdminChainRow[] }; PUT body { chain, state, note }. */
export interface AdminChainRow extends ChainStatusRow {
  effective: ChainSwitchState;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

/** GET /api/admin/launchpads → { launchpads: AdminLaunchpadRow[] }; PUT body { launchpad, chain, state, allowAgents, note }. */
export interface AdminLaunchpadRow extends LaunchpadStatusRow {
  /** Adapter status in code (live/beta/planned/blocked). */
  adapter: "live" | "beta" | "planned" | "blocked";
  /** True when the code can launch here (adapter beta/live on this chain). Opening a non-capable pad has no effect. */
  capable: boolean;
  /** Why `effective` is stricter than `state`, if it is. */
  reason?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

/** GET /api/admin/collector → recent runs + payouts. */
export interface AdminCollectorDetail {
  status: CollectorStatus;
  runs: CollectorRunSummary[];
  payouts: CollectorPayoutRow[];
}

// ─── Coin field rules (pump.fun create_v2: name ≤ 32, symbol ≤ 13, uri ≤ 200 — COIN_CREATION.md) ─────────────
export const PUMP_LIMITS = { nameMax: 32, symbolMax: 13, uriMax: 200 } as const;

export type FieldCheck = { ok: true; value: string } | { ok: false; error: string };

const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** Ticker: NFKC, leading "$" dropped, uppercased; only A–Z and 0–9, 1–13 characters. Never truncates. */
export function normalizeTicker(raw: string, max: number = PUMP_LIMITS.symbolMax): FieldCheck {
  const v = (raw ?? "").normalize("NFKC").trim().replace(/^\$+/, "").toUpperCase();
  if (!v) return { ok: false, error: "Add a ticker" };
  if (!/^[A-Z0-9]+$/.test(v)) return { ok: false, error: "Tickers can only use letters A–Z and digits 0–9" };
  if (v.length > max) return { ok: false, error: `Tickers are limited to ${max} characters — yours has ${v.length}` };
  return { ok: true, value: v };
}

/** Coin name: NFKC, trimmed, inner whitespace collapsed, no control characters, ≤ 32 bytes. Never truncates. */
export function normalizeCoinName(raw: string, maxBytes: number = PUMP_LIMITS.nameMax): FieldCheck {
  const v = (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!v) return { ok: false, error: "Give your coin a name" };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) return { ok: false, error: "The name contains control characters" };
  const n = utf8Len(v);
  if (n > maxBytes) {
    return { ok: false, error: `Names are limited to ${maxBytes} bytes (emoji and accents count double or more) — yours is ${n}. Shorten it.` };
  }
  return { ok: true, value: v };
}
