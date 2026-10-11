// Wallet session (Sign-In With Solana) + admin step. Server: server/auth.
//   useSession()            → { wallet, isAdminWallet, admin, … } (null wallet when signed out)
//   signInWithWallet()      → nonce → sign with the active Solana account → verify (sets an httpOnly cookie)
//   adminLogin(password)    → second step for admin wallets
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getActiveAccount } from "@/lib/wallet/state";
import { signSolMessage } from "@/lib/wallet/sign";

export interface SessionInfo {
  wallet: string | null;
  isAdminWallet: boolean;
  admin: boolean;
  adminUntil?: string | null;
  adminLoginConfigured?: boolean;
}

export const SESSION_KEY = ["/api/auth/me"] as const;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  return body as T;
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => json<T>(r));
}

export async function fetchSession(): Promise<SessionInfo> {
  return json<SessionInfo>(await fetch("/api/auth/me", { credentials: "include" }));
}

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 30_000, retry: false });
}

/** Call after sign-in / sign-out / admin login so every consumer re-reads the session. */
export function useRefreshSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SESSION_KEY });
}

/** Signs in with the active Solana account (local Claudio wallet or a browser wallet). */
export async function signInWithWallet(): Promise<SessionInfo> {
  const acct = getActiveAccount("svm");
  if (!acct) throw new Error("Set up or connect a Solana wallet first");
  const { nonce, message } = await post<{ nonce: string; message: string }>("/api/auth/nonce", { wallet: acct.address });
  const { signature } = await signSolMessage(message);
  return post<SessionInfo>("/api/auth/verify", { wallet: acct.address, nonce, signature });
}

export function signOut(): Promise<{ ok: boolean }> {
  return post("/api/auth/logout");
}

export function adminLogin(password: string): Promise<{ admin: boolean; adminUntil: string }> {
  return post("/api/admin/login", { password });
}

export function adminLogout(): Promise<{ ok: boolean }> {
  return post("/api/admin/logout");
}

/** True when the signed-in wallet is listed in ADMIN_WALLETS (drives the hidden Admin link). */
export function useIsAdminWallet(): boolean {
  const { data } = useSession();
  return !!data?.isAdminWallet;
}
