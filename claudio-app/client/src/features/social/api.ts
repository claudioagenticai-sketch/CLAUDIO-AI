// Social fee-account REST client (mirrors server/routes/social.ts).
import { useQuery } from "@tanstack/react-query";
import type { ChainId } from "@shared/chains";
import type { FeeShare, SocialProvider, TokenBeneficiary } from "@shared/social";
import type { PreparedTx } from "@shared/types";
import { ApiError } from "@/features/launch/api";
import { useSocialAuth } from "./auth";

async function call<T>(method: "GET" | "POST", url: string, body?: unknown, headers?: Record<string, string> | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Network error — is the server reachable?", "network", 0);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(json?.message || res.statusText || "Request failed", json?.error || "http", res.status);
  return json as T;
}

export interface SocialConfig {
  authProviders: ("auth0" | "clerk")[];
  resolvable: SocialProvider[];
  chains: ChainId[];
  attestor: string | null;
  launchpads: string[];
  /** Chains where claims can be submitted gas-free by the server's relayer. */
  relayer: ChainId[];
  /** Chains where the creator share can be split between the launcher and several accounts. */
  shareChains?: ChainId[];
  signInVia?: Partial<Record<SocialProvider, "auth0" | "clerk">>;
  /** Socials whose vault is keyed by username (renaming before claiming loses access). */
  handleKeyed?: SocialProvider[];
}

export interface ResolvedAccount {
  provider: SocialProvider;
  providerUserId: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  followers?: number;
  verified?: boolean;
}

export interface VaultState {
  chain: ChainId;
  vault: string;
  deployed: boolean;
  balance: string;
  symbol: string;
  beneficiary: string | null;
  pendingBeneficiary: string | null;
  readyAt: number | null;
}

export interface MyAccount extends ResolvedAccount {
  identityKey: string;
  optedOut: boolean;
  vaults: VaultState[];
  launches: { id: string; chain: ChainId; launchpad: string; name: string; symbol: string; token?: string; imageUri?: string }[];
}

export function useSocialConfig() {
  return useQuery({ queryKey: ["social-config"], queryFn: () => call<SocialConfig>("GET", "/api/social/config"), staleTime: 5 * 60_000 });
}

export function resolveSocial(provider: SocialProvider, handle: string) {
  return call<{ account: ResolvedAccount; identityKey: string; optedOut: boolean; claimed: boolean; vaults: Partial<Record<ChainId, string>> }>(
    "POST",
    "/api/social/resolve",
    { provider, handle },
  );
}

export function useTokenBeneficiary(chain: ChainId, address: string) {
  return useQuery({
    queryKey: ["social-token", chain, address.toLowerCase()],
    queryFn: () =>
      call<{ beneficiary: TokenBeneficiary | null; vault?: VaultState | null; shares?: FeeShare[] }>("GET", `/api/social/token/${chain}/${address}`),
    staleTime: 15_000,
    // Token page: the "unclaimed → claimed" badge and waiting balance update live.
    refetchInterval: (q) => (q.state.data?.beneficiary ? 15_000 : false),
  });
}

export function useMySocial() {
  const auth = useSocialAuth();
  return useQuery({
    queryKey: ["social-me", auth.sessions.join(",")],
    enabled: auth.sessions.length > 0,
    queryFn: async () => call<{ sessions: string[]; accounts: MyAccount[] }>("GET", "/api/social/me", undefined, await auth.authHeaders()),
    staleTime: 15_000,
    // Live vault balances / pending unlocks while the claim page is open.
    refetchInterval: 20_000,
  });
}

export interface ClaimResponse {
  claimId: string;
  bindDelaySec: number;
  /** Present when the server submitted it (gas-free). */
  relayed?: { hash: string; status: "success" | "reverted"; costNative: string };
  /** Present when the user must sign it. */
  tx?: PreparedTx;
}

export async function requestClaim(headers: Record<string, string> | null, identityKey: string, chain: ChainId, wallet: string, relay: boolean) {
  return call<ClaimResponse>("POST", "/api/social/claim", { identityKey, chain, wallet, relay }, headers);
}

export async function markClaimSubmitted(headers: Record<string, string> | null, claimId: string, txHash: string) {
  return call<{ ok: true }>("POST", `/api/social/claim/${claimId}/submitted`, { txHash }, headers);
}

export async function setOptOut(headers: Record<string, string> | null, identityKey: string, optedOut: boolean) {
  return call<{ ok: true; optedOut: boolean }>("POST", "/api/social/opt-out", { identityKey, optedOut }, headers);
}
