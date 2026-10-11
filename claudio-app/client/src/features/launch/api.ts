// Launch REST client + response types (mirrors server/routes/launch.ts).
import { useQuery } from "@tanstack/react-query";
import type { ChainId } from "@shared/chains";
import type { AdapterStatus, LaunchpadId } from "@shared/launchpads";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import type { SocialProvider } from "@shared/social";
import type { AgentProfile } from "@shared/agents";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      credentials: "include",
    });
  } catch {
    throw new ApiError("Network error — is the server reachable?", "network", 0);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; message?: string };
    throw new ApiError(j.message || res.statusText || "Request failed", j.error || "http", res.status);
  }
  return json as T;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface AdapterInfo {
  id: LaunchpadId;
  name: string;
  chains: ChainId[];
  status: AdapterStatus;
  note: string | null;
}

export interface AdaptersResponse {
  adapters: AdapterInfo[];
  platform: { evm: string | null; sol: string | null };
  splitterFactory: Partial<Record<ChainId, string | null>>;
  pinning: "pinata" | "local";
  pumpLut: string | null;
}

export interface UploadResult {
  /** On-chain / metadata URI (ipfs:// when pinned, absolute http URL in dev). */
  uri: string;
  /** Browser-loadable URL. */
  url: string;
  cid?: string;
  dev: boolean;
  kind?: string;
  bytes?: number;
}

export interface PlanResponse {
  id: string;
  plan: LaunchPlan;
  createdAt: number;
  /** Present when the creator share goes to a social account's vault. */
  beneficiary?: { identityKey: string; provider: SocialProvider; handle?: string; displayName?: string; avatarUrl?: string; followers?: number; vault: string };
}

/** `unverified`: the coin exists but its on-chain fee split doesn't match the plan (no badge, no payouts). */
export type LaunchStatus = "prepared" | "submitted" | "confirmed" | "failed" | "unverified";

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
  createdAt: number;
  updatedAt: number;
}

export interface FeeReading {
  label: string;
  amount: number;
  symbol: string;
  creatorShare?: number;
  note?: string;
}

export interface HarvestResponse {
  txs: PreparedTx[];
  notes: string[];
}

export interface MetadataInput {
  name: string;
  symbol: string;
  description?: string;
  image: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  showName?: boolean;
}

// ─── Calls ──────────────────────────────────────────────────────────

export const launchApi = {
  adapters: () => call<AdaptersResponse>("GET", "/api/launch/adapters"),
  uploadImage: (file: Blob, filename = "image.png") => {
    const fd = new FormData();
    fd.append("file", file, filename);
    return call<UploadResult>("POST", "/api/upload/image", fd);
  },
  uploadMetadata: (m: MetadataInput) => call<UploadResult>("POST", "/api/upload/metadata", m),
  plan: (req: LaunchRequest) => call<PlanResponse>("POST", "/api/launch/plan", req),
  confirm: (id: string, hashes: string[]) => call<{ launch: PublicLaunch }>("POST", "/api/launch/confirm", { id, hashes }),
  mine: (creators: string[]) =>
    call<{ launches: PublicLaunch[] }>("GET", `/api/launch/mine?creator=${encodeURIComponent(creators.join(","))}`),
  fees: (launchId: string) => call<{ items: FeeReading[]; at: number }>("GET", `/api/launch/fees?launchId=${encodeURIComponent(launchId)}`),
  harvest: (launchId: string) => call<HarvestResponse>("POST", "/api/launch/harvest", { launchId }),
};

/**
 * Friendly text for launch errors the server answers with a stable code (server/routes/launch.ts, server/launch/plan.ts).
 * Falls back to the server's own message.
 */
export function launchErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : "Could not prepare the launch";
  switch (e.code) {
    case "launchpad_closed":
      return e.message || "This launchpad isn't open for launches right now.";
    case "split_not_atomic":
      return "This launch can't lock the fee split in the same transaction as the coin, so it was stopped. Shorten the name, ticker, description or links and try again.";
    case "tx_too_large":
      return "The launch doesn't fit into one Solana transaction. Shorten the name, ticker, description or links and try again.";
    case "agent_unavailable":
      return e.message || "That agent can't launch right now — pick another one or launch to your own wallet.";
    case "hosted_unavailable":
      return "Hosted agents are unavailable right now. Launch to your own wallet, or try again later.";
    case "sign_in_required":
      return "Sign in with your wallet first (needed to launch with your agent).";
    default:
      return e.message;
  }
}

/** The signed-in owner's agents (GET /api/me/agents). Tolerates `[…]`, `{ agents: […] }` and `{ data: […] }`. */
export async function fetchMyAgents(): Promise<AgentProfile[] | null> {
  const res = await fetch("/api/me/agents", { credentials: "include" });
  // Not built yet / no database on this server / signed out → "not available" rather than an error.
  if (res.status === 404 || res.status === 501 || res.status === 503 || res.status === 401) return null;
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, "http", res.status);
  const body = (await res.json().catch(() => null)) as unknown;
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { agents?: unknown }).agents ?? (body as { data?: unknown }).data)
      : null;
  return Array.isArray(list) ? (list as AgentProfile[]) : [];
}

/** Adapter registry (statuses, platform treasury, pinning). Cached for the session. */
export function useAdapters() {
  return useQuery({
    queryKey: ["launch", "adapters"],
    queryFn: launchApi.adapters,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
