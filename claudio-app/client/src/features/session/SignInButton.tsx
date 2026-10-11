// "Sign in with your wallet" — reusable. No Solana account yet → opens the existing wallet setup / connect sheet;
// a locked Claudio wallet → unlock; then signs the server's nonce (signInWithWallet) and refreshes the session.
import { useState, type ReactNode } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { getActiveAccount, requireUnlocked, useActiveAccount } from "@/lib/wallet";
import { signInWithWallet, useRefreshSession, useSession } from "@/lib/session";
import { shortAddr } from "@/lib/format";
import { ActionButton } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/cancel/i.test(msg)) return "Cancelled — nothing was signed.";
  if (/reject/i.test(msg)) return "You declined the signature in your wallet.";
  return msg;
}

export function useSignIn() {
  const refresh = useRefreshSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!getActiveAccount("svm")) {
        // Opens the wallet sheet (create a Claudio wallet or connect Phantom/Backpack/Solflare).
        await requireUnlocked("Set up or connect a Solana wallet to sign in");
      }
      if (!getActiveAccount("svm")) throw new Error("Connect a Solana wallet to sign in — EVM wallets can't sign in here yet.");
      await signInWithWallet();
      await refresh();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

export function SignInButton({ className, children, size = "md" }: { className?: string; children?: ReactNode; size?: "md" | "lg" }) {
  const { run, busy, error } = useSignIn();
  const acct = useActiveAccount("svm");
  return (
    <div className={cn("flex flex-col items-stretch gap-2", className)}>
      <ActionButton onClick={run} busy={busy} className={size === "lg" ? "h-12 text-[12.5px] md:h-11" : undefined}>
        {!busy && <LogIn />}
        {children ?? (acct ? "Sign in with your wallet" : "Set up a wallet to sign in")}
      </ActionButton>
      {acct && !busy && <span className="text-center text-[11.5px] text-text-3">Signs a one-time message with {shortAddr(acct.address)} — no transaction, no fee.</span>}
      {error && (
        <span role="alert" className="text-center text-[12px] text-sell">
          {error}
        </span>
      )}
    </div>
  );
}

/** Full-card gate shown in place of owner-only screens. */
export function SignInCard({ title = "Sign in to continue", hint, className }: { title?: string; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("panel relative mx-auto max-w-md overflow-hidden p-6 text-center md:p-8", className)}>
            <div className="relative">
        <div className="mono-label">Sign in</div>
        <h2 className="display mt-3 text-[30px] text-text">{title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-text-3">
          {hint ?? "Your wallet is your account. Sign a short message to prove it's you — it costs nothing and moves no funds."}
        </p>
        <SignInButton className="mt-5" size="lg" />
        <p className="mt-4 text-[11.5px] leading-relaxed text-text-3">
          <ShieldCheck className="-mt-0.5 mr-1 inline h-3.5 w-3.5 text-buy" />
          Keys stay on your device. Claudio only sees your address.
        </p>
      </div>
    </div>
  );
}

/** Renders children when signed in, otherwise the sign-in card. */
export function SignInGate({ children, title, hint, wallet }: { children: ReactNode; title?: string; hint?: ReactNode; wallet?: string | null }) {
  const s = useSession();
  const signedIn = wallet !== undefined ? !!wallet : !!s.data?.wallet;
  if (s.isLoading && wallet === undefined) return <div className="panel sheen mx-auto h-[280px] max-w-md" />;
  if (!signedIn) return <SignInCard title={title} hint={hint} />;
  return <>{children}</>;
}
