// Social accounts that can receive a token's creator fees (claimed later by signing in with that account).

export const SOCIAL_PROVIDERS = [
  "x", "github", "twitch", "discord", "spotify", // signed in through Auth0
  "tiktok", "huggingface", "linkedin", // signed in through Clerk
  "farcaster", "telegram", "google", // legacy: kept so old rows still parse; not offered anywhere
] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const SOCIAL_PROVIDER_LABEL: Record<SocialProvider, string> = {
  x: "X",
  github: "GitHub",
  twitch: "Twitch",
  discord: "Discord",
  spotify: "Spotify",
  tiktok: "TikTok",
  huggingface: "Hugging Face",
  linkedin: "LinkedIn",
  farcaster: "Farcaster",
  telegram: "Telegram",
  google: "Google",
};

export type AuthServiceId = "auth0" | "clerk";

/**
 * The ONE sign-in service allowed to vouch for each social. The server ignores a social account coming from the
 * other service, so a misconfigured or compromised second tenant can't mint claims for these accounts.
 */
export const SIGN_IN_VIA: Partial<Record<SocialProvider, AuthServiceId>> = {
  x: "auth0",
  github: "auth0",
  twitch: "auth0",
  discord: "auth0",
  spotify: "auth0",
  tiktok: "clerk",
  huggingface: "clerk",
  linkedin: "clerk",
};

/** Sign-in buttons, in display order. */
export const SIGN_IN_SOCIALS: SocialProvider[] = ["x", "tiktok", "github", "discord", "twitch", "spotify", "huggingface", "linkedin"];

/**
 * Socials whose vault is keyed by the lowercased USERNAME instead of an immutable id, because the sign-in service
 * only gives us an app-scoped id that can't be looked up from a public handle (TikTok's open_id). Weaker: if the
 * owner renames and someone else takes the old name, the newcomer could claim unclaimed fees. The UI says so.
 */
export const HANDLE_KEYED: ReadonlySet<SocialProvider> = new Set<SocialProvider>(["tiktok"]);

/** What the launcher types to target an account on each social. */
export const TARGET_INPUT: Partial<Record<SocialProvider, { placeholder: string; hint?: string }>> = {
  x: { placeholder: "@handle on X" },
  github: { placeholder: "GitHub username" },
  twitch: { placeholder: "Twitch username" },
  spotify: { placeholder: "Spotify user id", hint: "The id in open.spotify.com/user/<id>" },
  huggingface: { placeholder: "Hugging Face username" },
  tiktok: { placeholder: "@handle on TikTok" },
  discord: { placeholder: "Discord user id (numbers)", hint: "Discord has no public username lookup: use the numeric user id" },
};

/** Launch-time target: the server resolves `handle` to the provider's stable id before building the launch. */
export interface SocialBeneficiary {
  provider: SocialProvider;
  handle: string;
}

/** Public view of who a token's creator fees belong to. */
export interface TokenBeneficiary {
  identityKey: string;
  provider: SocialProvider;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  vault: string;
  claimed: boolean;
}

/** Most social accounts one launch can share the creator fees with (ShareSplitter holds up to 8 recipients). */
export const MAX_FEE_SHARES = 5;

/** Launch-time share of the CREATOR side (bps out of 10000 = all of the creator's 70%). The launcher keeps the rest. */
export interface FeeShareTarget extends SocialBeneficiary {
  bps: number;
}

/** One resolved recipient of a launch's creator fees (public view). */
export interface FeeShare {
  kind: "launcher" | "social";
  /** Launcher wallet or the social account's SocialVault. */
  address: string;
  /** Share of the creator side, out of 10000. */
  bps: number;
  identityKey?: string;
  provider?: SocialProvider;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  followers?: number;
  /** Social vaults only: whether the owner has claimed it. */
  claimed?: boolean;
}
