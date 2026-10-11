// Canonical social identities. A vault is keyed by the provider's IMMUTABLE user id, never the handle:
// handles change and get re-registered, ids don't.
import { keccak256, toBytes, type Hex } from "viem";
import { HANDLE_KEYED, SOCIAL_PROVIDERS, type SocialProvider } from "@shared/social";

export { SOCIAL_PROVIDERS, type SocialProvider };

export interface SocialIdentity {
  provider: SocialProvider;
  /** Stable id from the provider (X numeric id, Farcaster fid, GitHub numeric id, …). */
  providerUserId: string;
  /** Last known handle, for display only. */
  handle?: string;
}

export function isProvider(v: string): v is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(v);
}

/**
 * "x:44196397". Lowercase provider, id as given (ids are case-sensitive on some providers). Handle-keyed socials
 * (HANDLE_KEYED) use the lowercased username, without "@", as their id.
 */
export function identityKey(id: Pick<SocialIdentity, "provider" | "providerUserId">): string {
  let uid = id.providerUserId.trim();
  if (HANDLE_KEYED.has(id.provider)) uid = uid.replace(/^@/, "").toLowerCase();
  if (!uid || /[\s:]/.test(uid)) throw new Error("invalid provider user id");
  return `${id.provider}:${uid}`;
}

/** bytes32 the SocialVaultFactory is keyed by: keccak256(utf8("provider:id")). Must match on-chain. */
export function identityHash(key: string): Hex {
  return keccak256(toBytes(key));
}

export function parseIdentityKey(key: string): { provider: SocialProvider; providerUserId: string } | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const provider = key.slice(0, i);
  const providerUserId = key.slice(i + 1);
  if (!isProvider(provider) || !providerUserId) return null;
  return { provider, providerUserId };
}
