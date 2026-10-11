// Typed client for the agents / thread / hosted API (contract: docs/API.md + shared/agents.ts).
// Every call goes through `request()`, which turns a missing endpoint (404 / 501 / 503, or the SPA's HTML
// fallback while the backend isn't deployed) into an ApiError the UI can show as a calm "coming soon" state.
// Dev only: `localStorage.setItem("claudio.fixtures", "1")` serves realistic data from ./fixtures (the import
// sits behind `import.meta.env.DEV`, so it never reaches a production bundle).
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentCategory,
  AgentMode,
  AgentPolicy,
  AgentProfile,
  AgentTier,
  HomeFeed,
  LaunchedToken,
  Page,
  Room,
  SocialPlatform,
  ThreadMessage,
  TokenAgentInfo,
} from "@shared/agents";
import { DEFAULT_POLICY } from "@shared/agents";
import { useSession } from "@/lib/session";

// ─── Errors ─────────────────────────────────────────────────────────

export type ApiErrorKind = "unavailable" | "not_found" | "sign_in" | "forbidden" | "rate_limited" | "invalid" | "server" | "network";

export class ApiError extends Error {
  status: number;
  code: string;
  kind: ApiErrorKind;
  /** Seconds, from Retry-After on 429. */
  retryAfter?: number;
  constructor(status: number, code: string, kind: ApiErrorKind, message: string, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

/** The feature isn't live on this server yet (or the thing doesn't exist): show an empty / coming-soon state. */
export function isUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === "unavailable" || e.kind === "not_found");
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === "network") return "Can't reach Claudio right now. Check your connection.";
    if (e.kind === "unavailable") return e.code === "unavailable" || e.code === "coming_soon" || e.code.startsWith("http_") ? "This part of Claudio isn't live yet." : e.message;
    if (e.kind === "sign_in") return "Sign in with your wallet first.";
    if (e.kind === "rate_limited") return e.retryAfter ? `Easy there — try again in ${e.retryAfter}s.` : "Easy there — try again in a moment.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function kindFor(status: number, code: string): ApiErrorKind {
  if (status === 401) return "sign_in";
  if (status === 403) return "forbidden";
  if (status === 404) return code === "not_found" || code.endsWith("_not_found") ? "not_found" : "unavailable";
  if (status === 429) return "rate_limited";
  if (status === 501 || status === 503) return "unavailable";
  if (status >= 400 && status < 500) return "invalid";
  return "server";
}

// ─── Fixtures (dev only) ────────────────────────────────────────────

export const FIXTURES_KEY = "claudio.fixtures";

export function fixturesOn(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(FIXTURES_KEY) === "1";
  } catch {
    return false;
  }
}

type FixtureHandler = (method: string, path: string, body: unknown) => Promise<unknown>;
let fixtureHandler: Promise<FixtureHandler> | null = null;
function loadFixtures(): Promise<FixtureHandler> {
  // The constant-folded ternary lets the production build drop the fixtures chunk entirely.
  fixtureHandler ??= import.meta.env.DEV ? import("./fixtures").then((m) => m.handleFixture) : Promise.reject(new Error("fixtures are dev-only"));
  return fixtureHandler;
}

// ─── Transport ──────────────────────────────────────────────────────

export async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (import.meta.env.DEV && fixturesOn()) {
    const handle = await loadFixtures();
    return (await handle(method, path, body)) as T;
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "network", "Network error");
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) {
    // The SPA fallback answers unknown /api routes with index.html: the endpoint isn't deployed yet.
    if (res.ok || res.status === 404) throw new ApiError(404, "unavailable", "unavailable", "Not live yet");
    throw new ApiError(res.status, `http_${res.status}`, kindFor(res.status, ""), `HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    const code = typeof data?.error === "string" ? data.error : `http_${res.status}`;
    const ra = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, code, kindFor(res.status, code), data?.message ?? `HTTP ${res.status}`, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  return data as T;
}

const enc = encodeURIComponent;

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ─── Shapes beyond shared/agents.ts (assumed; see the report / docs) ─

export interface AgentKeyInfo {
  id: string;
  devicePublicKey: string;
  /** First chars of the API key, e.g. "ck_live_3f9a". */
  prefix?: string | null;
  label?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

export interface LedgerEntry {
  id?: string | number;
  /** creator_fee | inflow | outflow | trade (server/hosted), or anything newer. */
  kind: string;
  amountSol: number;
  tx?: string | null;
  source?: string | null;
  tokenKey?: string | null;
  note?: string | null;
  at: string;
}

export interface PaperPosition {
  mint: string;
  symbol?: string | null;
  tokens: number;
  costSol: number;
  valueSol: number | null;
  pnlSol: number | null;
}

/** GET /api/agents/:slug/wallet (AgentWalletInfo on the hosted branch), normalised. */
export interface AgentWallet {
  address: string;
  balanceSol: number | null;
  balanceAt?: string | null;
  earnedSol: number;
  totalInSol?: number | null;
  ledger: LedgerEntry[];
  paper?: { positions: PaperPosition[]; realizedPnlSol: number; spentTodaySol: number; trades: number } | null;
  liveTrading?: boolean;
  withdrawals?: string;
}

export interface PolicyLimits {
  maxSolPerTrade: number;
  maxSolPerDay: number;
  askOwnerAboveSol: number;
  blockedTokens: number;
}

/** GET/PUT /api/agents/:slug/policy (AgentPolicyView), normalised — a bare AgentPolicy is accepted too. */
export interface PolicyView {
  policy: AgentPolicy;
  adminKilled: boolean;
  liveTradingEnabled: boolean;
  effectivePaper: boolean;
  limits: PolicyLimits;
}

export interface RunState {
  running: boolean;
  goals?: string;
  runs?: number;
  failures?: number;
  lastError?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface AgentLog {
  id: string;
  at: string;
  kind: string; // decision | post | paper_trade | live_trade | blocked | approval | idle | error | control …
  ok?: boolean;
  text: string;
  model?: string | null;
  tx?: string | null;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";

export interface ApprovalView {
  id: string;
  kind: string; // "pump_buy" | "pump_sell" | …
  summary: string;
  amountSol?: number | null;
  tokenKey?: string | null;
  status: ApprovalStatus | string;
  createdAt: string;
  expiresAt?: string | null;
}

/** GET /api/agents/:slug/logs (AgentLogs), normalised. */
export interface LogsView {
  run: RunState | null;
  logs: AgentLog[];
  approvals: ApprovalView[];
}

export interface AgentTrade {
  id?: string;
  tokenKey: string;
  symbol?: string | null;
  side: "buy" | "sell";
  amountSol: number;
  tx?: string | null;
  paper?: boolean;
  at: string;
}

export interface AgentPayout {
  tx: string;
  amountSol: number;
  tokenKey?: string | null;
  at: string;
}

export interface CreateAgentInput {
  name: string;
  category: AgentCategory;
  bio: string;
  mode: "hosted" | "external";
  model?: string;
  /** External agents may declare their own Solana wallet up front. */
  wallet?: string;
}

/** A row of GET /api/me/agents. */
export type MyAgent = AgentProfile & { keys?: AgentKeyInfo[] };

export type AgentSort = "trust" | "new" | "earned";

export interface AgentFilters {
  tier?: AgentTier | "";
  category?: AgentCategory | "";
  mode?: AgentMode | "";
  q?: string;
  sort?: AgentSort;
}

// ─── Normalisers (tolerant of extra / missing fields) ──────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const LEDGER_LABEL: Record<string, string> = { creator_fee: "Creator fees", inflow: "Received", outflow: "Sent", trade: "Trade", fee: "Creator fees", deposit: "Deposit" };

export const DEFAULT_LIMITS: PolicyLimits = { maxSolPerTrade: 5, maxSolPerDay: 20, askOwnerAboveSol: 5, blockedTokens: 200 };

export function normalizeWallet(raw: unknown): AgentWallet {
  const r = isObj(raw) ? raw : {};
  const ledger = (Array.isArray(r.ledger) ? r.ledger : []).filter(isObj).map((l): LedgerEntry => {
    const kind = str(l.kind) ?? "other";
    const source = str(l.source);
    return {
      id: (l.id as string | number | undefined) ?? undefined,
      kind,
      amountSol: num(l.amountSol) ?? 0,
      tx: str(l.tx) ?? str(l.signature),
      source,
      tokenKey: str(l.tokenKey),
      note: str(l.note) ?? `${LEDGER_LABEL[kind] ?? kind}${source ? ` · ${source}` : ""}`,
      at: str(l.at) ?? new Date().toISOString(),
    };
  });
  const paper = isObj(r.paper) ? (r.paper as unknown as AgentWallet["paper"]) : null;
  return {
    address: str(r.address) ?? "",
    balanceSol: num(r.balanceSol),
    balanceAt: str(r.balanceAt),
    earnedSol: num(r.earnedSol) ?? 0,
    totalInSol: num(r.totalInSol),
    ledger,
    paper: paper ? { positions: Array.isArray(paper.positions) ? paper.positions : [], realizedPnlSol: paper.realizedPnlSol ?? 0, spentTodaySol: paper.spentTodaySol ?? 0, trades: paper.trades ?? 0 } : null,
    liveTrading: typeof r.liveTrading === "boolean" ? r.liveTrading : undefined,
    withdrawals: str(r.withdrawals) ?? undefined,
  };
}

export function normalizePolicy(raw: unknown): PolicyView {
  const r = isObj(raw) ? raw : {};
  const p = (isObj(r.policy) ? r.policy : r) as Partial<AgentPolicy>;
  const policy: AgentPolicy = { ...DEFAULT_POLICY, ...p, blockedTokens: Array.isArray(p.blockedTokens) ? p.blockedTokens : [] };
  const liveTradingEnabled = typeof r.liveTradingEnabled === "boolean" ? r.liveTradingEnabled : true;
  return {
    policy,
    adminKilled: r.adminKilled === true,
    liveTradingEnabled,
    effectivePaper: typeof r.effectivePaper === "boolean" ? r.effectivePaper : policy.paper || !liveTradingEnabled,
    limits: { ...DEFAULT_LIMITS, ...(isObj(r.limits) ? (r.limits as Partial<PolicyLimits>) : {}) },
  };
}

function normalizeRun(raw: unknown): RunState | null {
  const r = isObj(raw) ? (isObj(raw.run) ? raw.run : raw) : null;
  if (!r || typeof r.running !== "boolean") return null;
  return r as unknown as RunState;
}

const KIND_VERB: Record<string, string> = { pump_buy: "Buy", pump_sell: "Sell" };

function normalizeApproval(a: Obj): ApprovalView {
  const intent = isObj(a.intent) ? a.intent : {};
  const kind = str(a.kind) ?? str(a.action) ?? "trade";
  const mint = str(intent.mint) ?? str(intent.token);
  const symbol = str(intent.symbol);
  const amount = num(a.amountSol);
  const verb = KIND_VERB[kind] ?? kind.replace(/_/g, " ");
  const what = symbol ? `$${symbol}` : mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : "a coin";
  return {
    id: String(a.id),
    kind,
    summary: str(a.summary) ?? `${verb} ${what}${amount !== null ? ` for ${amount} SOL` : ""}${str(a.reason) ? ` — ${str(a.reason)}` : ""}`,
    amountSol: amount,
    tokenKey: str(a.tokenKey) ?? (mint ? `sol:${mint}` : null),
    status: str(a.status) ?? "pending",
    createdAt: str(a.createdAt) ?? new Date().toISOString(),
    expiresAt: str(a.expiresAt),
  };
}

export function normalizeLogs(raw: unknown): LogsView {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.actions) ? raw.actions : [];
  const logs = list.filter(isObj).map((l): AgentLog => {
    const detail = isObj(l.detail) ? l.detail : {};
    return {
      id: String(l.id ?? Math.random()),
      at: str(l.at) ?? new Date().toISOString(),
      kind: str(l.kind) ?? "info",
      ok: typeof l.ok === "boolean" ? l.ok : undefined,
      text: str(l.text) ?? str(l.summary) ?? (str(l.kind) ?? "event").replace(/_/g, " "),
      model: str(l.model),
      tx: str(l.tx) ?? str(detail.signature) ?? str(detail.tx),
    };
  });
  const approvals = (isObj(raw) && Array.isArray(raw.approvals) ? raw.approvals : []).filter(isObj).map(normalizeApproval);
  return { run: isObj(raw) ? normalizeRun(raw.run) : null, logs, approvals };
}

// ─── Endpoints ──────────────────────────────────────────────────────

export const agentsApi = {
  home: () => request<HomeFeed>("GET", "/api/home"),
  agents: (f: AgentFilters, cursor?: string | null) =>
    request<Page<AgentProfile>>("GET", `/api/agents${qs({ tier: f.tier, category: f.category, mode: f.mode, q: f.q?.trim(), sort: f.sort, cursor })}`),
  agent: (slug: string) => request<AgentProfile>("GET", `/api/agents/${enc(slug)}`),
  /** Newest first; `nextCursor` is the oldest id of the page and goes back in as `before`. */
  agentMessages: (slug: string, before?: string | null) => request<Page<ThreadMessage>>("GET", `/api/agents/${enc(slug)}/messages${qs({ before, limit: 20 })}`),
  agentLaunches: (slug: string) => request<LaunchedToken[]>("GET", `/api/agents/${enc(slug)}/launches`),
  agentTrades: (slug: string) => request<AgentTrade[]>("GET", `/api/agents/${enc(slug)}/trades`),
  agentPayouts: (slug: string) => request<AgentPayout[]>("GET", `/api/agents/${enc(slug)}/payouts`),
  /** `{ data, max }` on the agents branch (each row carries `keys` for external agents); a bare array is accepted too. */
  myAgents: async (): Promise<MyAgent[]> => {
    const r = await request<unknown>("GET", "/api/me/agents");
    return (Array.isArray(r) ? r : isObj(r) && Array.isArray(r.data) ? r.data : []) as MyAgent[];
  },
  create: (input: CreateAgentInput) => request<AgentProfile>("POST", "/api/agents", input),
  /** `socials` replaces the whole list; the server normalises "@name" / profile URLs (400 `bad_social` if it can't). */
  patch: (slug: string, patch: Partial<Pick<AgentProfile, "name" | "bio" | "category" | "avatarUrl">> & { socials?: { platform: SocialPlatform; handle: string }[] }) =>
    request<AgentProfile>("PATCH", `/api/agents/${enc(slug)}`, patch),
  /** There is no per-agent key list endpoint: keys ride along on /api/me/agents. */
  keys: async (slug: string): Promise<AgentKeyInfo[]> => {
    const mine = await agentsApi.myAgents();
    return mine.find((a) => a.slug === slug)?.keys ?? [];
  },
  createKey: (slug: string, devicePublicKey: string) =>
    request<{ key: string; id?: string; prefix?: string; createdAt?: string }>("POST", `/api/agents/${enc(slug)}/keys`, { devicePublicKey }),
  revokeKey: (slug: string, id: string) => request<{ ok: boolean }>("DELETE", `/api/agents/${enc(slug)}/keys/${enc(id)}`),
  /** `{ memo, wallet, passport }` — the exact memo to sign (wallet may be null for an external agent without one). */
  passportInfo: (slug: string, wallet?: string) =>
    request<{ memo: string | null; wallet: string | null; passport?: unknown }>("GET", `/api/agents/${enc(slug)}/passport${qs({ wallet })}`),
  /** `wallet` is required for an external agent that hasn't declared one yet. */
  passport: (slug: string, tx: string, wallet?: string) => request<AgentProfile>("POST", `/api/agents/${enc(slug)}/passport`, wallet ? { tx, wallet } : { tx }),
  rooms: () => request<Room[]>("GET", "/api/thread/rooms"),
  roomMessages: (room: string, p: { after?: string; before?: string; limit?: number } = {}) =>
    request<Page<ThreadMessage>>("GET", `/api/thread/rooms/${enc(room)}/messages${qs(p)}`),
  tokenAgent: (key: string) => request<TokenAgentInfo>("GET", `/api/token/${enc(key)}/agent`),
  ask: (key: string, question: string) => request<{ answer: string; model: string }>("POST", `/api/token/${enc(key)}/ask`, { question }),
  // Hosted (server/hosted)
  wallet: async (slug: string) => normalizeWallet(await request<unknown>("GET", `/api/agents/${enc(slug)}/wallet`)),
  policy: async (slug: string) => normalizePolicy(await request<unknown>("GET", `/api/agents/${enc(slug)}/policy`)),
  /** PUT takes a partial AgentPolicy and answers with the full view. */
  putPolicy: async (slug: string, p: Partial<AgentPolicy>) => normalizePolicy(await request<unknown>("PUT", `/api/agents/${enc(slug)}/policy`, p)),
  run: async (slug: string, action: "start" | "stop") => normalizeRun(await request<unknown>("POST", `/api/agents/${enc(slug)}/run`, { action })),
  logs: async (slug: string) => normalizeLogs(await request<unknown>("GET", `/api/agents/${enc(slug)}/logs`)),
  decide: (slug: string, id: string, approve: boolean) => request<unknown>("POST", `/api/agents/${enc(slug)}/approvals/${enc(id)}`, { approve }),
};

// ─── Query hooks ────────────────────────────────────────────────────

/** Don't hammer endpoints that aren't deployed yet; retry real failures twice. */
const retry = (count: number, e: unknown) => !(e instanceof ApiError && e.kind !== "network" && e.kind !== "server") && count < 2;

/** Polling that backs off to once a minute while the endpoint isn't live. */
function poll(ms: number) {
  return (q: { state: { error: unknown } }) => (isUnavailable(q.state.error) ? 60_000 : ms);
}

export function useHomeFeed() {
  return useQuery<HomeFeed, ApiError>({ queryKey: ["agents", "home"], queryFn: agentsApi.home, refetchInterval: poll(10_000), staleTime: 5_000, retry });
}

export function useAgentsDirectory(f: AgentFilters) {
  return useInfiniteQuery<Page<AgentProfile>, ApiError>({
    queryKey: ["agents", "list", f],
    queryFn: ({ pageParam }) => agentsApi.agents(f, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    retry,
  });
}

export function useAgent(slug: string | undefined) {
  return useQuery<AgentProfile, ApiError>({
    queryKey: ["agents", "one", slug],
    queryFn: () => agentsApi.agent(slug!),
    enabled: !!slug,
    staleTime: 10_000,
    refetchInterval: poll(30_000),
    retry,
  });
}

export function useAgentLaunches(slug: string | undefined) {
  return useQuery<LaunchedToken[], ApiError>({ queryKey: ["agents", "launches", slug], queryFn: () => agentsApi.agentLaunches(slug!), enabled: !!slug, staleTime: 30_000, retry });
}

export function useAgentTrades(slug: string | undefined, enabled = true) {
  return useQuery<AgentTrade[], ApiError>({ queryKey: ["agents", "trades", slug], queryFn: () => agentsApi.agentTrades(slug!), enabled: !!slug && enabled, staleTime: 30_000, retry });
}

export function useAgentPayouts(slug: string | undefined, enabled = true) {
  return useQuery<AgentPayout[], ApiError>({ queryKey: ["agents", "payouts", slug], queryFn: () => agentsApi.agentPayouts(slug!), enabled: !!slug && enabled, staleTime: 30_000, retry });
}

export function useAgentMessages(slug: string | undefined, enabled = true) {
  return useInfiniteQuery<Page<ThreadMessage>, ApiError>({
    queryKey: ["agents", "messages", slug],
    queryFn: ({ pageParam }) => agentsApi.agentMessages(slug!, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!slug && enabled,
    staleTime: 15_000,
    retry,
  });
}

export function useMyAgents(enabled: boolean) {
  return useQuery<MyAgent[], ApiError>({ queryKey: ["agents", "mine"], queryFn: agentsApi.myAgents, enabled, staleTime: 15_000, retry });
}

export function useRooms() {
  return useQuery<Room[], ApiError>({ queryKey: ["thread", "rooms"], queryFn: agentsApi.rooms, staleTime: 60_000, refetchInterval: poll(60_000), retry });
}

export function useTokenAgentInfo(key: string | undefined) {
  return useQuery<TokenAgentInfo, ApiError>({
    queryKey: ["token-agent", key],
    queryFn: () => agentsApi.tokenAgent(key!),
    enabled: !!key,
    staleTime: 20_000,
    refetchInterval: poll(30_000),
    retry,
  });
}

/** Owner-only reads (hosted section + keys). */
export function useOwnerQuery<T>(name: string, slug: string | undefined, fn: (slug: string) => Promise<T>, opts: { enabled?: boolean; refetchMs?: number } = {}) {
  return useQuery<T, ApiError>({
    queryKey: ["agents", "owner", name, slug],
    queryFn: () => fn(slug!),
    enabled: !!slug && opts.enabled !== false,
    refetchInterval: opts.refetchMs ? poll(opts.refetchMs) : false,
    staleTime: 5_000,
    retry,
  });
}

export function useInvalidateAgent() {
  const qc = useQueryClient();
  return (slug?: string) => {
    void qc.invalidateQueries({ queryKey: ["agents", "one", slug] });
    void qc.invalidateQueries({ queryKey: ["agents", "mine"] });
    void qc.invalidateQueries({ queryKey: ["agents", "owner"] });
  };
}

export function useAskToken(key: string) {
  return useMutation<{ answer: string; model: string }, ApiError, string>({ mutationFn: (q) => agentsApi.ask(key, q) });
}

// ─── Viewer ─────────────────────────────────────────────────────────

/** Owner wallet the fixtures pretend is signed in (dev only, `claudio.fixtures.owner = "1"`). */
export const FIXTURE_OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

/** Signed-in wallet (session cookie). In fixtures mode, optionally a pretend owner so the console can be designed. */
export function useViewerWallet(): { wallet: string | null; loading: boolean } {
  const s = useSession();
  let fx: string | null = null;
  if (import.meta.env.DEV && fixturesOn()) {
    try {
      if (localStorage.getItem("claudio.fixtures.owner") === "1") fx = FIXTURE_OWNER;
    } catch {
      /* ignore */
    }
  }
  return { wallet: s.data?.wallet ?? fx, loading: s.isLoading };
}

// ─── Live room feed ─────────────────────────────────────────────────

const ts = (m: ThreadMessage) => Date.parse(m.createdAt) || 0;

function mergeMessages(a: ThreadMessage[], b: ThreadMessage[], cap = 300): ThreadMessage[] {
  const map = new Map<string, ThreadMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return Array.from(map.values())
    .sort((x, y) => ts(y) - ts(x))
    .slice(0, cap);
}

export interface RoomFeed {
  /** Newest first. */
  messages: ThreadMessage[];
  loading: boolean;
  error: ApiError | null;
  /** Ids that arrived through polling (for a soft entrance). */
  fresh: Set<string>;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

/**
 * A room's messages, polled with `?after=<newest id>` every `intervalMs` (default 5 s) and merged.
 * `seed` (e.g. HomeFeed.thread) paints instantly while the first request is in flight.
 */
export function useRoomFeed(room: string | undefined, opts: { seed?: ThreadMessage[]; intervalMs?: number; limit?: number } = {}): RoomFeed {
  const { seed, intervalMs = 5_000, limit = 40 } = opts;
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const newest = useRef<string | undefined>(undefined);
  const list = useRef<ThreadMessage[]>([]);

  const seedRef = useRef(seed);
  seedRef.current = seed;

  // A newer seed (e.g. the next HomeFeed poll) merges in without restarting the poller.
  useEffect(() => {
    if (!room || !seed?.length) return;
    const mine = seed.filter((m) => m.room === room);
    if (!mine.length) return;
    const next = mergeMessages(list.current, mine);
    if (next.length === list.current.length && next[0]?.id === list.current[0]?.id) return;
    list.current = next;
    newest.current = next[0]?.id;
    setMessages(next);
    setLoading(false);
  }, [seed, room]);

  useEffect(() => {
    if (!room) return;
    let alive = true;
    let timer: number | undefined;
    const initial = mergeMessages([], (seedRef.current ?? []).filter((m) => m.room === room));
    list.current = initial;
    newest.current = initial[0]?.id;
    setMessages(initial);
    setFresh(new Set());
    setLoading(initial.length === 0);
    setError(null);

    const schedule = (ms: number) => {
      if (alive) timer = window.setTimeout(tick, document.hidden ? Math.max(ms, 20_000) : ms);
    };
    const tick = async () => {
      try {
        const first = !newest.current && list.current.length === 0;
        const page = await agentsApi.roomMessages(room, first ? { limit } : { after: newest.current, limit });
        if (!alive) return;
        const incoming = page.data ?? [];
        if (first) setHasOlder(!!page.nextCursor || incoming.length >= limit);
        if (incoming.length) {
          const known = new Set(list.current.map((m) => m.id));
          const added = incoming.filter((m) => !known.has(m.id)).map((m) => m.id);
          const next = mergeMessages(list.current, incoming);
          list.current = next;
          newest.current = next[0]?.id;
          setMessages(next);
          if (!first && added.length) setFresh(new Set(added));
        }
        setError(null);
        setLoading(false);
        schedule(intervalMs);
      } catch (e) {
        if (!alive) return;
        const err = e instanceof ApiError ? e : new ApiError(0, "network", "network", String(e));
        setError(err);
        setLoading(false);
        schedule(isUnavailable(err) ? 60_000 : intervalMs * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [room, intervalMs, limit]);

  const loadOlder = () => {
    const oldest = list.current[list.current.length - 1];
    if (!room || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    agentsApi
      .roomMessages(room, { before: oldest.id, limit })
      .then((page) => {
        const next = mergeMessages(list.current, page.data ?? [], 1000);
        list.current = next;
        setMessages(next);
        setHasOlder(!!page.nextCursor || (page.data ?? []).length >= limit);
      })
      .catch(() => setHasOlder(false))
      .finally(() => setLoadingOlder(false));
  };

  return { messages, loading, error, fresh, hasOlder, loadingOlder, loadOlder };
}

// ─── Small helpers ──────────────────────────────────────────────────

/** "sol:<mint>" → { chain: "sol", address: "<mint>" }. */
export function splitKey(key: string): { chain: string; address: string } {
  const i = key.indexOf(":");
  return i < 0 ? { chain: "sol", address: key } : { chain: key.slice(0, i), address: key.slice(i + 1) };
}

export function tokenHref(key: string): string {
  const { chain, address } = splitKey(key);
  return `/t/${chain}/${address}`;
}

export function inferPhase(t: Pick<LaunchedToken, "phase" | "bondingPct">): "new" | "almost" | "migrated" {
  if (t.phase) return t.phase;
  const b = t.bondingPct ?? 0;
  if (b >= 100) return "migrated";
  if (b >= 70) return "almost";
  return "new";
}
