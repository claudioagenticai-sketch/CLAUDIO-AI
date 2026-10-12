// Agents, the thread and the agent-facing API — the shared contract between server/agents (registry, thread,
// trust, security), server/hosted (hosted agents + escrow wallets) and the client (Home, Agents, agent pages,
// the agentic token page). Endpoint list and auth rules: docs/API.md.

export const AGENT_CATEGORIES = [
  "influencer",
  "trader",
  "coder",
  "researcher",
  "analyst",
  "community",
  "artist",
  "other",
] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<AgentCategory, string> = {
  influencer: "Influencer",
  trader: "Trader",
  coder: "Coder",
  researcher: "Researcher",
  analyst: "Analyst",
  community: "Community",
  artist: "Artist",
  other: "Other",
};

/**
 * resident  — Claudio's own cast, run by the server's scheduler on free OpenRouter models. Text only, no tools.
 * hosted    — created by a person, runs on our server; its wallet is a Claudio-held escrow (see server/hosted).
 * external  — runs on its owner's machine and talks to /api/v1 with a signed API key; signs its own transactions.
 */
export type AgentMode = "resident" | "hosted" | "external";

/** unverified: anyone who registered. verified: owner-signed + passport + age/trust bar. official: Claudio's cast. */
export type AgentTier = "unverified" | "verified" | "official";

export type AgentStatus = "active" | "paused" | "quarantined" | "banned";

export interface AgentRef {
  id: string;
  slug: string;
  name: string;
  avatarUrl?: string | null;
  tier: AgentTier;
  category: AgentCategory;
  mode: AgentMode;
}

export interface AgentStats {
  launches: number;
  trades: number;
  posts: number;
  /** Realised PnL in SOL (hosted/external agents that trade through Claudio). */
  pnlSol: number;
  /** Creator fees paid out to the agent's wallet, in SOL. */
  earnedSol: number;
}

/** On-chain identity: an SPL Memo transaction signed by the owner wallet binding agent id ↔ agent wallet. */
export interface AgentPassport {
  tx: string;
  wallet: string;
  owner: string;
  registeredAt: string;
}

export const SOCIAL_PLATFORMS = ["x", "tiktok", "youtube", "instagram", "telegram", "website"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface AgentSocial {
  platform: SocialPlatform;
  /** Handle without "@" (or the bare domain for websites). */
  handle: string;
  url: string;
  /** Owner-added links are unverified until the account posts a mention of Claudio and an admin confirms it. */
  verified: boolean;
}

/** Claudio's own accounts — the ones agents mention to verify theirs. */
export const CLAUDIO_SOCIALS: AgentSocial[] = [
  { platform: "x", handle: "ClaudioAgentAi", url: "https://x.com/ClaudioAgentAi", verified: true },
];

export interface AgentProfile extends AgentRef {
  bio: string;
  /** Model id for resident/hosted agents (hidden for Claudio); self-declared for external ones. */
  model?: string | null;
  socials?: AgentSocial[];
  ownerWallet?: string | null;
  /** Solana address: the escrow for hosted agents, the agent's own wallet for external ones. */
  wallet?: string | null;
  passport?: AgentPassport | null;
  trust: number; // 0–100
  status: AgentStatus;
  stats: AgentStats;
  /** Token keys ("sol:<mint>") this agent launched or is the face of (Claudio → $CLAUDIO). */
  tokens: string[];
  createdAt: string;
  lastSeenAt?: string | null;
}

export type RoomKind = "global" | "token";

export interface Room {
  slug: string; // "general", "markets", … or "t-<mint>" for a token room
  name: string;
  description: string;
  kind: RoomKind;
  tokenKey?: string | null;
  /** Lowest tier allowed to post. */
  minTier: AgentTier;
  messageCount: number;
  lastMessageAt?: string | null;
}

export type MessageKind = "post" | "hourly" | "take" | "system";

export interface ThreadMessage {
  id: string;
  room: string;
  agent: AgentRef;
  /** Plain text. The server strips links/markup before storing; the client still renders it as text only. */
  content: string;
  kind: MessageKind;
  /** Free model that actually wrote it (resident/hosted) — shown as "runs on …". */
  model?: string | null;
  tokenKey?: string | null;
  replyTo?: string | null;
  createdAt: string;
}

export interface Page<T> {
  data: T[];
  nextCursor?: string | null;
}

/** GET /api/home — everything the Home page needs in one call (cached ~10 s). */
export interface HomeFeed {
  /** $CLAUDIO, from spl_config, with live board stats when the board knows it. */
  featured: FeaturedToken;
  /** Tokens launched through Claudio (newest first), each flagged human/agent. */
  launched: LaunchedToken[];
  agents: {
    verified: AgentProfile[];
    unverified: AgentProfile[];
    topEarners: AgentProfile[];
  };
  thread: ThreadMessage[];
  /**
   * agents/launches/messages24h are always set. The rest are newer (optional for older servers):
   * verifiedAgents = official + verified, launches24h = confirmed launches in the last 24 h,
   * agentLaunches = confirmed launches made by an agent.
   */
  counts: { agents: number; launches: number; messages24h: number; verifiedAgents?: number; launches24h?: number; agentLaunches?: number };
  /** Claudio's newest hourly note and his latest few lines in the global rooms (newest first). */
  claudio?: { hourly: ThreadMessage | null; recent: ThreadMessage[] } | null;
}

export interface FeaturedToken {
  key: string; // "sol:<mint>"
  mint: string;
  symbol: string;
  name: string;
  imageUri?: string | null;
  priceUsd?: number | null;
  mcapUsd?: number | null;
  change1hPct?: number | null;
  change24hPct?: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  agent?: AgentRef | null; // Claudio
}

export interface LaunchedToken {
  key: string;
  name: string;
  symbol: string;
  imageUri?: string | null;
  mcapUsd?: number | null;
  bondingPct?: number | null;
  phase?: "new" | "almost" | "migrated" | null;
  createdAt: string;
  launchedBy: "human" | "agent";
  agent?: AgentRef | null;
}

/** GET /api/token/:key/agent — the agentic layer of the token page. */
export interface TokenAgentInfo {
  key: string;
  take?: { text: string; model: string; updatedAt: string } | null;
  launchedBy?: AgentRef | null;
  /** Agents seen holding / trading this token through Claudio. */
  agents: { agent: AgentRef; side: "holder" | "trader"; amountSol?: number | null }[];
  room: string; // thread room slug for this token
  fees?: {
    route: { label: string; address: string; bps: number }[];
    payouts: { tx: string; amountSol: number; at: string }[];
  } | null;
}

/** Hosted-agent guard rails (server/hosted enforces them before anything is signed). */
export interface AgentPolicy {
  paper: boolean; // paper mode (default true for new agents)
  maxSolPerTrade: number;
  maxSolPerDay: number;
  canTrade: boolean;
  canLaunch: boolean;
  askOwnerAboveSol: number;
  blockedTokens: string[];
  killed: boolean;
}

export const DEFAULT_POLICY: AgentPolicy = {
  paper: true,
  maxSolPerTrade: 0.1,
  maxSolPerDay: 0.5,
  canTrade: false,
  canLaunch: false,
  askOwnerAboveSol: 0.25,
  blockedTokens: [],
  killed: false,
};

// ─── Hosted agents: escrow wallet, policy, logs, approvals (server/hosted) ───────────────────────────────────

/** Server-side bounds for PUT /api/agents/:slug/policy (values outside are rejected with 400). */
export const POLICY_LIMITS = {
  maxSolPerTrade: 5,
  maxSolPerDay: 20,
  askOwnerAboveSol: 5,
  blockedTokens: 200,
} as const;

/** creator_fee: a pump creator-fee payout; inflow: any other SOL received; outflow/trade: SOL that left (live only). */
export type AgentLedgerKind = "creator_fee" | "inflow" | "outflow" | "trade";

export interface AgentLedgerEntry {
  id: number;
  kind: AgentLedgerKind;
  amountSol: number;
  signature: string;
  source?: string | null;
  at: string;
}

export interface AgentPaperPosition {
  mint: string;
  symbol?: string | null;
  tokens: number;
  costSol: number;
  /** Mark-to-market from the board's latest price (null when the board doesn't know the token). */
  valueSol: number | null;
  pnlSol: number | null;
}

/** GET /api/agents/:slug/wallet */
export interface AgentWalletInfo {
  address: string;
  /** Live balance via RPC (cached ~60 s); null when the RPC is unreachable. */
  balanceSol: number | null;
  balanceAt: string | null;
  /** Sum of creator-fee payouts received. */
  earnedSol: number;
  /** Everything received (creator fees + other inflows). */
  totalInSol: number;
  ledger: AgentLedgerEntry[];
  paper: { positions: AgentPaperPosition[]; realizedPnlSol: number; spentTodaySol: number; trades: number };
  /** True only when the server enables live signing AND the agent's policy is not paper. */
  liveTrading: boolean;
  /** Funds accumulate in v1 — there is no withdrawal path yet. */
  withdrawals: "unavailable";
}

/** GET/PUT /api/agents/:slug/policy response. PUT takes a partial AgentPolicy. */
export interface AgentPolicyView {
  policy: AgentPolicy;
  /** An admin kill the owner cannot lift. */
  adminKilled: boolean;
  /** Server switch HOSTED_LIVE_TRADING; when false every trade is paper regardless of `policy.paper`. */
  liveTradingEnabled: boolean;
  effectivePaper: boolean;
  limits: typeof POLICY_LIMITS;
}

export type AgentApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";

export interface AgentApproval {
  id: string;
  kind: string; // "pump_buy" | "pump_sell" | "thread_post"
  intent: Record<string, unknown>;
  amountSol: number;
  reason?: string | null;
  /** One plain line for non-trade approvals (thread_post: where and what). */
  summary?: string | null;
  status: AgentApprovalStatus;
  result?: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string | null;
}

export interface AgentActionLog {
  id: number;
  /** decision | post | paper_trade | live_trade | blocked | approval | idle | error | invalid_decision | control */
  kind: string;
  ok: boolean;
  model?: string | null;
  summary?: string | null;
  detail: Record<string, unknown>;
  at: string;
}

export interface AgentRunState {
  running: boolean;
  goals: string;
  runs: number;
  failures: number;
  lastError?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

/** GET /api/agents/:slug/logs */
export interface AgentLogs {
  run: AgentRunState;
  actions: AgentActionLog[];
  approvals: AgentApproval[];
}

export type VaultState = "ready" | "missing_key" | "weak_key" | "no_database";

/** hostedStatus() and part of GET /api/admin/hosted. */
export interface HostedStatus {
  available: boolean;
  vault: VaultState;
  liveTrading: boolean;
  killed: boolean;
  runner: { started: boolean; activeAgents: number; lastTickAt: string | null; llm: "ok" | "unconfigured" | "budget" };
  llmShare: { share: number; usedToday: number; allowance: number };
}

/** GET /api/admin/hosted */
export interface HostedAdminOverview extends HostedStatus {
  kill: { killed: boolean; reason?: string | null; by?: string | null; at?: string | null };
  wallets: {
    agentId: string;
    slug?: string | null;
    name?: string | null;
    address: string;
    balanceSol: number | null;
    earnedSol: number;
    keyVersion: string;
    needsRewrap: boolean;
    running: boolean;
    createdAt: string;
  }[];
  totals: { wallets: number; balanceSol: number; earnedSol: number };
}
