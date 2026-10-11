// Hybrid social sign-in. Each social has ONE sign-in service (SIGN_IN_VIA): X, GitHub, Twitch, Discord and Spotify go
// through Auth0; TikTok, Hugging Face and LinkedIn through Clerk. Both can be signed in at the same time. Each SDK
// runs inside its own provider component; a small bridge publishes its state into one store, so the rest of the app
// uses `useSocialAuth()` without caring which service proved which account.
//
// No hosted/modal UI from either service: every button starts that social's OAuth redirect directly.
// Sign-in here is ONLY for proving a social account (to claim fees). Trading keys stay in the local wallet.
import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { AuthenticateWithRedirectCallback, ClerkProvider, useAuth, useClerk, useSignIn } from "@clerk/react";
import { SIGN_IN_SOCIALS, SIGN_IN_VIA, type AuthServiceId, type SocialProvider } from "@shared/social";

export type AuthProviderId = AuthServiceId;

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN as string | undefined;
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined;
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined;

export const AUTH_CONFIGURED: Record<AuthProviderId, boolean> = {
  clerk: !!CLERK_KEY,
  auth0: !!(AUTH0_DOMAIN && AUTH0_CLIENT_ID && AUTH0_AUDIENCE),
};

/** Sign-in buttons this build can offer (its service is configured). */
export const AVAILABLE_SIGN_INS: SocialProvider[] = SIGN_IN_SOCIALS.filter((p) => {
  const via = SIGN_IN_VIA[p];
  return !!via && AUTH_CONFIGURED[via];
});

/** Auth0 connection names (override with VITE_AUTH0_CONNECTIONS="x:twitter,discord:discord-oauth"). */
function auth0Connection(p: SocialProvider): string {
  const map: Record<string, string> = { x: "twitter", github: "github", twitch: "twitch", discord: "discord", spotify: "spotify" };
  for (const pair of ((import.meta.env.VITE_AUTH0_CONNECTIONS as string | undefined) ?? "").split(",")) {
    const [k, v] = pair.split(":").map((s) => s.trim());
    if (k && v) map[k] = v;
  }
  return map[p] ?? p;
}

/** Clerk OAuth strategy per social. */
const CLERK_STRATEGY: Partial<Record<SocialProvider, string>> = {
  tiktok: "oauth_tiktok",
  huggingface: "oauth_huggingface",
  linkedin: "oauth_linkedin_oidc",
};

export class SignInError extends Error {}

interface ProviderState {
  ready: boolean;
  signedIn: boolean;
  getToken: () => Promise<string | null>;
  signIn: (social: SocialProvider) => Promise<void>;
  signOut: () => Promise<void>;
}

interface AuthStore {
  providers: Partial<Record<AuthProviderId, ProviderState>>;
  set: (id: AuthProviderId, s: ProviderState) => void;
}

const useAuthStore = create<AuthStore>((set) => ({
  providers: {},
  set: (id, s) => set((st) => ({ providers: { ...st.providers, [id]: s } })),
}));

const here = () => window.location.pathname + window.location.search;

// ─── Bridges (rendered inside each SDK's provider) ────────────────────────────────────────────

function ClerkBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const { signIn } = useSignIn();
  const set = useAuthStore((s) => s.set);
  useEffect(() => {
    set("clerk", {
      ready: isLoaded,
      signedIn: !!isSignedIn,
      getToken: async () => (await getToken()) ?? null,
      signIn: async (social) => {
        const strategy = CLERK_STRATEGY[social] as "oauth_tiktok" | undefined;
        if (!strategy) throw new SignInError(`${social} isn't a Clerk sign-in`);
        // Already signed in: connect the extra social to the same Clerk user instead of starting a new session.
        if (isSignedIn && clerk.user) {
          const ext = await clerk.user.createExternalAccount({ strategy, redirectUrl: here() });
          const url = ext.verification?.externalVerificationRedirectURL;
          if (!url) throw new SignInError("Clerk didn't return a sign-in link");
          window.location.assign(url.toString());
          return;
        }
        if (!signIn) throw new SignInError("Sign-in is still loading — try again");
        const { error } = await signIn.sso({ strategy, redirectUrl: here(), redirectCallbackUrl: "/sso-callback" });
        if (error) throw new SignInError(error.message || "Couldn't start sign-in");
      },
      signOut: () => clerk.signOut(),
    });
  }, [isLoaded, isSignedIn, getToken, clerk, signIn, set]);
  return null;
}

function Auth0Bridge() {
  const { isLoading, isAuthenticated, getAccessTokenSilently, loginWithRedirect, logout } = useAuth0();
  const set = useAuthStore((s) => s.set);
  useEffect(() => {
    set("auth0", {
      ready: !isLoading,
      signedIn: isAuthenticated,
      getToken: async () => {
        try {
          return (await getAccessTokenSilently()) ?? null;
        } catch {
          return null;
        }
      },
      signIn: (social) =>
        loginWithRedirect({
          // prompt=login: always show the provider's own screen, so switching accounts never silently reuses the last one.
          authorizationParams: { connection: auth0Connection(social), prompt: "login" },
          appState: { returnTo: here() },
        }),
      signOut: () => logout({ logoutParams: { returnTo: window.location.href } }),
    });
  }, [isLoading, isAuthenticated, getAccessTokenSilently, loginWithRedirect, logout, set]);
  return null;
}

export function SocialAuthProvider({ children }: { children: ReactNode }) {
  let tree = <>{children}</>;
  if (AUTH_CONFIGURED.auth0) {
    tree = (
      <Auth0Provider
        domain={AUTH0_DOMAIN!}
        clientId={AUTH0_CLIENT_ID!}
        authorizationParams={{ audience: AUTH0_AUDIENCE, redirect_uri: window.location.origin }}
        cacheLocation="localstorage"
        useRefreshTokens
        onRedirectCallback={(state) => {
          const to = (state as { returnTo?: string } | undefined)?.returnTo ?? "/claim";
          window.history.replaceState({}, "", to);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
      >
        <Auth0Bridge />
        {tree}
      </Auth0Provider>
    );
  }
  if (AUTH_CONFIGURED.clerk) {
    tree = (
      <ClerkProvider publishableKey={CLERK_KEY!} signInFallbackRedirectUrl="/claim" signUpFallbackRedirectUrl="/claim">
        <ClerkBridge />
        {tree}
      </ClerkProvider>
    );
  }
  return tree;
}

/** Route element for Clerk's OAuth redirect (/sso-callback). First-time users are signed up transparently. */
export function ClerkCallback() {
  if (!AUTH_CONFIGURED.clerk) return null;
  return <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/claim" signUpFallbackRedirectUrl="/claim" continueSignUpUrl="/claim" />;
}

export interface SocialAuth {
  configured: AuthProviderId[];
  ready: boolean;
  /** Every service the user is signed in to (both is normal). */
  sessions: AuthProviderId[];
  /** Back-compat: the first signed-in service, or null. */
  active: AuthProviderId | null;
  /** Starts the OAuth redirect for `social` through its service. */
  signIn: (social: SocialProvider) => Promise<void>;
  /** Signs out of one service, or all of them. */
  signOut: (which?: AuthProviderId) => Promise<void>;
  /** Headers carrying every live session's token, or null when signed out. */
  authHeaders: () => Promise<Record<string, string> | null>;
}

const HEADER: Record<AuthProviderId, string> = { auth0: "X-Auth0-Token", clerk: "X-Clerk-Token" };

export function useSocialAuth(): SocialAuth {
  const providers = useAuthStore((s) => s.providers);
  const configured = (Object.keys(AUTH_CONFIGURED) as AuthProviderId[]).filter((k) => AUTH_CONFIGURED[k]);
  const sessions = (["auth0", "clerk"] as AuthProviderId[]).filter((k) => providers[k]?.signedIn);
  return {
    configured,
    ready: configured.every((k) => providers[k]?.ready),
    sessions,
    active: sessions[0] ?? null,
    signIn: async (social) => {
      const via = SIGN_IN_VIA[social];
      const p = via ? providers[via] : undefined;
      if (!via || !AUTH_CONFIGURED[via]) throw new SignInError("This sign-in isn't set up on this server yet");
      if (!p) throw new SignInError("Sign-in is still loading — try again");
      await p.signIn(social);
    },
    signOut: async (which) => {
      for (const k of which ? [which] : sessions) await providers[k]?.signOut();
    },
    authHeaders: async () => {
      const out: Record<string, string> = {};
      for (const k of sessions) {
        const t = await providers[k]?.getToken();
        if (t) out[HEADER[k]] = t;
      }
      return Object.keys(out).length ? out : null;
    },
  };
}
