// Claim: sign in with a social account (Auth0 or Clerk), see creator fees waiting for it on each chain, claim them to a
// wallet, and opt out of future launches in your name.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { FEE_SPLIT } from "@shared/launchpads";
import { BRAND } from "@shared/brand";
import { Card, Page, ActionButton, SwitchLite } from "@/features/wallet/ui";
import { toast } from "@/hooks/use-toast";
import { useSocialAuth } from "@/features/social/auth";
import { setOptOut, useMySocial } from "@/features/social/api";
import { MyClaims, SignInOptions, SocialHandle } from "@/features/social/ui";

function OptOuts() {
  const auth = useSocialAuth();
  const me = useMySocial();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const accounts = me.data?.accounts ?? [];
  if (!accounts.length) return null;
  return (
    <Card title="Launches in your name">
      <div className="grid gap-2">
        {accounts.map((a) => (
          <div key={a.identityKey} className="flex items-center justify-between gap-3 rounded-[3px] px-3 py-2.5 ring-1 ring-inset ring-line">
            <div className="min-w-0 text-sm">
              <SocialHandle provider={a.provider} handle={a.handle} fallback={a.identityKey} />
              <div className="mt-0.5 text-[11.5px] text-text-3">
                {a.optedOut ? "New launches paying this account are blocked." : "Anyone can launch a coin that pays this account."}
              </div>
            </div>
            <SwitchLite
              checked={a.optedOut}
              disabled={busy === a.identityKey}
              onChange={async (v) => {
                setBusy(a.identityKey);
                try {
                  await setOptOut(await auth.authHeaders(), a.identityKey, v);
                  await qc.invalidateQueries({ queryKey: ["social-me"] });
                } catch (e) {
                  toast({ title: "Couldn't update", description: (e as Error).message, variant: "destructive" });
                } finally {
                  setBusy(null);
                }
              }}
            />
          </div>
        ))}
        <p className="mt-1 text-[11px] text-text-3">Opting out doesn't affect coins already launched; their fees stay claimable by you.</p>
      </div>
    </Card>
  );
}

export default function Claim() {
  const auth = useSocialAuth();
  const creatorPct = FEE_SPLIT.creatorBps / 100;
  return (
    <Page className="max-w-5xl">
      <header className="mb-6 md:mb-8">
        <div className="mono-label flex items-center gap-2">
          <span className="text-brand" aria-hidden>
            /
          </span>
          <span>Claudio</span>
          <span aria-hidden>/</span>
          <span className="text-text-2">Claim</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5 md:mt-4 md:pb-6">
        <div className="min-w-0">
          <h1 className="display-page text-text">Claim creator fees</h1>
          <p className="lede mt-3 max-w-xl md:mt-4">
            Coins launched for your X, TikTok, GitHub, Twitch, Spotify or Hugging Face account send {creatorPct}% of their creator fees to a vault
            only you can claim.
          </p>
        </div>
        {auth.active && (
          <div className="flex items-center gap-2">
            <span className="chip chip-buy">Signed in</span>
            <ActionButton tone="ghost" onClick={() => void auth.signOut()}>
              <LogOut /> Sign out
            </ActionButton>
          </div>
        )}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px] md:gap-8">
        <div className="grid min-w-0 content-start gap-4">
          <Card title={auth.active ? "Your accounts" : "Prove it's you"}>
            {auth.active ? <MyClaims /> : <SignInOptions />}
          </Card>
          {auth.active && (
            <Card title="Link another account">
              <SignInOptions />
            </Card>
          )}
          {auth.active && <OptOuts />}
          <ul className="grid gap-1.5 px-1 text-[12.5px] leading-relaxed text-text-3">
            <li>Signing in only proves you own the account. {BRAND.full} never posts for you.</li>
            <li>Your trading keys stay on this device.</li>
            <li>You can block future launches in your name from this page.</li>
          </ul>
        </div>
        <aside className="min-w-0">
          <h2 className="mb-4 flex items-baseline gap-2.5 border-t border-line pt-4">
            <span className="display-section text-text">How it works</span>
          </h2>
          <ol className="grid gap-4 text-[12.5px] leading-relaxed text-text-2">
            {[
              ["A coin pays your account", `Someone launches a coin on ${BRAND.full} and sends its ${creatorPct}% creator share to your social account.`],
              ["Fees collect in a vault", "The vault is tied to your account's permanent id, not your handle."],
              ["Sign in and pick a wallet", "Sign in to prove it's you and pick a wallet. The vault is then locked to that wallet; only you can move it later."],
              ["No endorsement", "Claiming doesn't mean you endorse the coin."],
            ].map(([t, b], i) => (
              <li key={t} className="flex gap-3">
                <span className="section-num w-5 shrink-0 pt-px">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block font-semibold text-text">{t}</span>
                  {b}
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </Page>
  );
}
