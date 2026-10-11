// Social claim UI: provider icons, the hybrid sign-in sheet (Auth0 / Clerk), and the claim sheet.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import { SiDiscord, SiFarcaster, SiGithub, SiGoogle, SiHuggingface, SiSpotify, SiTelegram, SiTiktok, SiTwitch } from "react-icons/si";
import { Check, CheckCircle2, Clock, ExternalLink, Gift, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { HANDLE_KEYED, SIGN_IN_SOCIALS, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "@shared/social";
import { ChainLogo, ResponsiveSheet } from "@/components/kit";
import { ActionButton } from "@/features/wallet/ui";
import { SendError, signAndSend, useActiveAccount } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { AVAILABLE_SIGN_INS, useSocialAuth } from "./auth";
import { markClaimSubmitted, requestClaim, useMySocial, useSocialConfig, type MyAccount, type VaultState } from "./api";

const ICONS: Record<SocialProvider, typeof SiGithub> = {
  x: FaXTwitter,
  github: SiGithub,
  twitch: SiTwitch,
  discord: SiDiscord,
  spotify: SiSpotify,
  tiktok: SiTiktok,
  huggingface: SiHuggingface,
  linkedin: FaLinkedinIn,
  farcaster: SiFarcaster,
  telegram: SiTelegram,
  google: SiGoogle,
};

/** Brand accent per social (icon tint + hover ring on the sign-in buttons). */
export const SOCIAL_COLOR: Record<SocialProvider, string> = {
  x: "#e7e9ea",
  github: "#e6edf3",
  twitch: "#a970ff",
  discord: "#5865f2",
  spotify: "#1ed760",
  tiktok: "#ff0050",
  huggingface: "#ffd21e",
  linkedin: "#0a66c2",
  farcaster: "#8a63d2",
  telegram: "#26a5e4",
  google: "#4285f4",
};

export function SocialIcon({ provider, className }: { provider: SocialProvider; className?: string }) {
  const Icon = ICONS[provider];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-label={SOCIAL_PROVIDER_LABEL[provider]} />;
}

export function SocialHandle({ provider, handle, fallback }: { provider: SocialProvider; handle?: string | null; fallback?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <SocialIcon provider={provider} className="h-3.5 w-3.5" />
      <span className="truncate font-semibold">{handle ? `@${handle}` : fallback}</span>
    </span>
  );
}

// ─── Sign in ────────────────────────────────────────────────────────────────────────────────────

/** Social claims aren't switched on yet: the sign-in buttons show which socials will be supported, but can't be used. */
export const SOCIAL_CLAIMS_LIVE = false;

/**
 * One button per social. Each one goes straight to that social's own OAuth screen; which service runs it behind the
 * scenes (Auth0 or Clerk) is invisible here. Accounts already linked show a check; you can link several.
 * While SOCIAL_CLAIMS_LIVE is false every button is shown disabled with a "Coming soon" note.
 */
export function SignInOptions({ onStarted, compact }: { onStarted?: () => void; compact?: boolean }) {
  const auth = useSocialAuth();
  const me = useMySocial();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const linked = new Set((me.data?.accounts ?? []).map((a) => a.provider));
  const live = SOCIAL_CLAIMS_LIVE && AVAILABLE_SIGN_INS.length > 0;
  const providers = live ? AVAILABLE_SIGN_INS : SIGN_IN_SOCIALS;
  return (
    <div className="grid gap-3">
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
        {providers.map((s) => {
          const on = linked.has(s);
          if (!live) {
            return (
              <button
                key={s}
                type="button"
                disabled
                aria-disabled="true"
                tabIndex={-1}
                aria-label={`${SOCIAL_PROVIDER_LABEL[s]} sign-in, coming soon`}
                className="flex h-11 cursor-not-allowed items-center gap-2.5 rounded-[3px] border border-line px-3 text-left text-[13px] font-medium text-text-3"
              >
                <SocialIcon provider={s} className="text-text-2" />
                <span className="truncate">{SOCIAL_PROVIDER_LABEL[s]}</span>
              </button>
            );
          }
          return (
            <button
              key={s}
              type="button"
              disabled={busy !== null}
              aria-label={`${on ? "Linked" : "Continue with"} ${SOCIAL_PROVIDER_LABEL[s]}`}
              onClick={async () => {
                setBusy(s);
                onStarted?.();
                try {
                  await auth.signIn(s);
                } catch (e) {
                  toast({ title: `Couldn't open ${SOCIAL_PROVIDER_LABEL[s]}`, description: (e as Error).message, variant: "destructive" });
                  setBusy(null);
                }
              }}
              style={{ ["--brand" as string]: SOCIAL_COLOR[s] }}
              className={cn(
                "relative flex h-11 items-center gap-2.5 rounded-[3px] border border-line-2 px-3 text-left text-[13px] font-medium transition",
                "hover:border-[color:var(--brand)] hover:bg-panel disabled:opacity-60",
                on && "border-[color:var(--brand)]",
              )}
            >
              {busy === s ? <Loader2 className="h-4 w-4 animate-spin" /> : <SocialIcon provider={s} className="text-[color:var(--brand)]" />}
              <span className="truncate">{SOCIAL_PROVIDER_LABEL[s]}</span>
              {on && <Check className="ml-auto h-3.5 w-3.5 text-buy" aria-label="linked" />}
            </button>
          );
        })}
      </div>
      {live ? (
        <p className="text-[11.5px] leading-relaxed text-text-3">
          Signing in only proves you own the account. Claudio never posts for you, and your trading keys stay on this device.
        </p>
      ) : (
        <p className="text-[12px] leading-relaxed text-text-2">
          <span className="font-semibold text-text">Coming soon.</span> Social sign-in isn't switched on yet. Fees sent to your account wait in
          its vault until then.
        </p>
      )}
    </div>
  );
}

// ─── Claim ──────────────────────────────────────────────────────────────────────────────────────

function VaultRow({ acct, v, onClaimed }: { acct: MyAccount; v: VaultState; onClaimed: () => void }) {
  const auth = useSocialAuth();
  const wallet = useActiveAccount("evm");
  const config = useSocialConfig();
  const gasFree = !!config.data?.relayer?.includes(v.chain);
  const [busy, setBusy] = useState(false);
  const c = CHAINS[v.chain];
  const pendingUntil = v.readyAt ? v.readyAt * 1000 : 0;

  const claim = async () => {
    if (!wallet) return toast({ title: "Create or connect an EVM wallet first", variant: "destructive" });
    setBusy(true);
    try {
      const headers = await auth.authHeaders();
      const res = await requestClaim(headers, acct.identityKey, v.chain, wallet.address, gasFree);
      if (res.relayed) {
        if (res.relayed.status !== "success") throw new Error("The claim transaction reverted");
      } else if (res.tx) {
        const { hashes } = await signAndSend(v.chain, [res.tx]);
        if (hashes[0]) await markClaimSubmitted(headers, res.claimId, hashes[0]).catch(() => undefined);
      }
      toast({
        title: res.bindDelaySec ? "Claim submitted" : "Claimed",
        description: res.bindDelaySec
          ? `Funds unlock in ${Math.round(res.bindDelaySec / 3600)}h, then go to ${shortAddr(wallet.address)}.`
          : `Fees now go to ${shortAddr(wallet.address)}.`,
      });
      onClaimed();
    } catch (e) {
      const msg = e instanceof SendError || e instanceof Error ? e.message : "Claim failed";
      toast({ title: "Couldn't claim", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] p-3 ring-1 ring-inset ring-line">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] ring-1 ring-inset ring-line-2">
          <ChainLogo chain={v.chain} size={18} />
        </span>
        <div className="min-w-0">
          <div className="num text-[15px] font-medium">
            {Number(v.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {v.symbol}
          </div>
          <div className="text-[11px] text-text-3">
            {c.name} · vault {shortAddr(v.vault)}
          </div>
        </div>
      </div>
      {v.beneficiary ? (
        <span className="chip chip-buy">
          <CheckCircle2 className="h-3 w-3" /> Paying {shortAddr(v.beneficiary)}
        </span>
      ) : v.pendingBeneficiary ? (
        <span className="chip chip-warn">
          <Clock className="h-3 w-3" /> Unlocks {pendingUntil ? new Date(pendingUntil).toLocaleString() : "soon"}
        </span>
      ) : (
        <ActionButton busy={busy} onClick={claim} className="h-10">
          <Gift /> Claim{wallet ? ` to ${shortAddr(wallet.address)}` : ""}
          {gasFree && <span className="rounded-[2px] px-1.5 py-0.5 text-[10px] ring-1 ring-inset ring-brand-ink/30">NO GAS</span>}
        </ActionButton>
      )}
    </div>
  );
}

export function MyClaims({ focusKey }: { focusKey?: string }) {
  const me = useMySocial();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["social-me"] });
    void qc.invalidateQueries({ queryKey: ["social-token"] });
  };
  if (me.isLoading) return <div className="h-24 rounded-[3px] border border-line sheen" />;
  if (me.error) return <p className="rounded-[3px] border border-line border-l-2 border-l-sell px-3.5 py-3 text-sm text-sell">{(me.error as Error).message}</p>;
  const accounts = me.data?.accounts ?? [];
  if (!accounts.length) {
    return (
      <p className="rounded-[3px] border border-line border-l-2 border-l-warn px-3.5 py-3 text-[13px] leading-relaxed text-text-2">
        None of your signed-in accounts is linked yet. Continue with the account the coin was launched for.
      </p>
    );
  }
  const sorted = focusKey ? [...accounts].sort((a) => (a.identityKey === focusKey ? -1 : 1)) : accounts;
  return (
    <div className="grid gap-4">
      {sorted.map((a) => (
        <div key={a.identityKey} className="grid gap-2">
          <div className="flex items-center gap-2">
            {a.avatarUrl && <img src={a.avatarUrl} alt="" className="h-8 w-8 rounded-full ring-1 ring-line-2" />}
            <SocialHandle provider={a.provider} handle={a.handle} fallback={a.identityKey} />
            <ShieldCheck className="h-3.5 w-3.5 text-buy" aria-label="verified" />
          </div>
          {HANDLE_KEYED.has(a.provider) && (
            <p className="text-[11px] text-text-3">
              {SOCIAL_PROVIDER_LABEL[a.provider]} fees are tied to your username. Claim before changing it.
            </p>
          )}
          {a.vaults.length ? (
            a.vaults.map((v) => <VaultRow key={v.chain} acct={a} v={v} onClaimed={refresh} />)
          ) : (
            <p className="rounded-[3px] px-3 py-2.5 text-xs text-text-3 ring-1 ring-inset ring-line">No fee vaults on the enabled chains yet.</p>
          )}
          {a.launches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-text-3">
              Coins paying this account:
              {a.launches.map((l) => (
                <span key={l.id} className="chip num">
                  ${l.symbol}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ClaimSheet({ open, onOpenChange, focusKey, label }: { open: boolean; onOpenChange: (o: boolean) => void; focusKey?: string; label?: string }) {
  const auth = useSocialAuth();
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={auth.active ? "Claim your fees" : `Is ${label ?? "this"} you?`}
      description={
        auth.active
          ? "Pick where your creator fees should go. After claiming, every future fee is sent there automatically."
          : "Sign in with that account to prove it's yours, then claim the creator fees waiting for you."
      }
    >
      <div className="grid gap-4 pb-2">
        {auth.active ? (
          <>
            <MyClaims focusKey={focusKey} />
            <details className="rounded-[3px] px-3 py-2.5 text-xs text-text-2 ring-1 ring-inset ring-line">
              <summary className="cursor-pointer select-none">Link another account</summary>
              <div className="pt-3">
                <SignInOptions compact />
              </div>
            </details>
            <button type="button" onClick={() => void auth.signOut()} className="inline-flex items-center gap-1.5 self-start text-xs text-text-3 hover:text-text">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </>
        ) : (
          <SignInOptions compact />
        )}
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text-3">
          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
          Claiming doesn't mean you endorse the coin. Anyone can launch a coin that pays an account; you can opt out of
          future launches from the Claim page.
        </p>
      </div>
    </ResponsiveSheet>
  );
}

export function chainName(c: ChainId) {
  return CHAINS[c].name;
}
