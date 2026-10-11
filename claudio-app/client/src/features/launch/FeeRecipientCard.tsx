// "Creator rewards go to".
//  Solana: the launcher's wallet, or one of the signed-in owner's hosted agents (the creator share then goes to that
//          agent's Claudio-run wallet, never to the launcher — said plainly before signing).
//  EVM: the launcher's wallet, one social account (X, TikTok, GitHub, Twitch…) that claims later, or a
//          split between the launcher and several social accounts. Every handle is resolved live.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AtSign, BadgeCheck, Bot, Check, Loader2, LogIn, Plus, ShieldAlert, Split, Users, Wallet, X } from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { AgentProfile } from "@shared/agents";
import { getActiveAccount, openWalletPrompt } from "@/lib/wallet";
import { signInWithWallet, useRefreshSession, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { fetchMyAgents } from "./api";
import type { ChainId } from "@shared/chains";
import { BRAND } from "@shared/brand";
import { FEE_SPLIT, LAUNCHPADS, type LaunchpadId } from "@shared/launchpads";
import { HANDLE_KEYED, MAX_FEE_SHARES, SOCIAL_PROVIDER_LABEL, TARGET_INPUT, type SocialProvider } from "@shared/social";
import { fmtCompact } from "@/lib/format";
import { resolveSocial, useMySocial, useSocialConfig, type ResolvedAccount } from "@/features/social/api";
import { SocialIcon } from "@/features/social/ui";
import { shareTotals, useLaunchDraft, type DraftFeeShare } from "./draft";
import { Callout, ChoiceCards, FieldLabel, Segmented, TextInput } from "./ui";

type Lookup = { state: "idle" | "loading" } | { state: "ok"; account: ResolvedAccount; optedOut: boolean; claimed: boolean } | { state: "error"; message: string };

function useAccountLookup(provider: SocialProvider, handle: string, enabled: boolean): Lookup {
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  useEffect(() => {
    if (!enabled || !handle.trim()) return setLookup({ state: "idle" });
    setLookup({ state: "loading" });
    const t = setTimeout(async () => {
      try {
        const r = await resolveSocial(provider, handle);
        setLookup({ state: "ok", account: r.account, optedOut: r.optedOut, claimed: r.claimed });
      } catch (e) {
        setLookup({ state: "error", message: (e as Error).message });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [provider, handle, enabled]);
  return lookup;
}

/** Provider picker + handle input + live preview of the resolved account. */
function AccountInput({
  providers,
  provider,
  handle,
  onProvider,
  onHandle,
  layoutId,
  trailing,
}: {
  providers: SocialProvider[];
  provider: SocialProvider;
  handle: string;
  onProvider: (p: SocialProvider) => void;
  onHandle: (h: string) => void;
  layoutId: string;
  trailing?: React.ReactNode;
}) {
  const lookup = useAccountLookup(provider, handle, true);
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Segmented
          layoutId={layoutId}
          size="sm"
          value={provider}
          onChange={onProvider}
          options={providers.map((p) => ({ value: p, label: <SocialIcon provider={p} /> }))}
        />
        <TextInput
          value={handle}
          onChange={(e) => onHandle(e.target.value)}
          placeholder={TARGET_INPUT[provider]?.placeholder ?? `@handle on ${SOCIAL_PROVIDER_LABEL[provider]}`}
          inputMode={provider === "discord" ? "numeric" : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          invalid={lookup.state === "error" || (lookup.state === "ok" && lookup.optedOut)}
        />
        {trailing}
      </div>
      {TARGET_INPUT[provider]?.hint && lookup.state === "idle" && <div className="text-[11px] text-text-3">{TARGET_INPUT[provider]!.hint}</div>}
      {lookup.state === "loading" && (
        <div className="flex items-center gap-2 text-xs text-text-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up the account…
        </div>
      )}
      {lookup.state === "error" && <Callout tone="bad">{lookup.message}</Callout>}
      {lookup.state === "ok" && (
        <div className="flex items-center gap-3 rounded-[3px] border border-line bg-bg-elev p-3">
          {lookup.account.avatarUrl && <img src={lookup.account.avatarUrl} alt="" className="h-10 w-10 rounded-full" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <SocialIcon provider={lookup.account.provider} className="h-3.5 w-3.5" />
              <span className="truncate">{lookup.account.displayName ?? lookup.account.handle}</span>
              {lookup.account.verified && <BadgeCheck className="h-3.5 w-3.5 text-info" />}
            </div>
            <div className="num truncate text-[11px] text-text-3">
              @{lookup.account.handle} · id {lookup.account.providerUserId}
              {lookup.account.followers !== undefined && (
                <>
                  {" "}
                  · <Users className="inline h-3 w-3" /> {fmtCompact(lookup.account.followers)}
                </>
              )}
            </div>
          </div>
          {lookup.claimed && <span className="chip text-buy">signed in before</span>}
        </div>
      )}
      {lookup.state === "ok" && HANDLE_KEYED.has(provider) && (
        <Callout tone="warn">
          {SOCIAL_PROVIDER_LABEL[provider]} fees are tied to the username @{lookup.account.handle}. If they rename before claiming,
          whoever takes that name next could claim instead.
        </Callout>
      )}
      {lookup.state === "ok" && lookup.optedOut && (
        <Callout tone="bad" icon={<ShieldAlert />}>
          This account opted out of launches in its name.
        </Callout>
      )}
    </div>
  );
}

function SplitEditor({ providers, shareAvailable }: { providers: SocialProvider[]; shareAvailable: boolean }) {
  const shares = useLaunchDraft((s) => s.feeShares);
  const patch = useLaunchDraft((s) => s.patch);
  const { socialPct, launcherPct } = shareTotals(shares);
  const creatorPct = FEE_SPLIT.creatorBps / 100;
  const set = (i: number, p: Partial<DraftFeeShare>) => patch({ feeShares: shares.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const add = () =>
    patch({ feeShares: [...shares, { provider: providers[0] ?? "x", handle: "", pct: Math.max(1, Math.min(25, 100 - socialPct)) }] });

  if (!shareAvailable) return <Callout tone="info">Fee sharing with several accounts isn't deployed on this chain yet.</Callout>;
  return (
    <div className="grid gap-3">
      <FieldLabel label="Share the creator fees" hint={`% of the ${creatorPct}% creator share`} />
      {shares.map((s, i) => (
        <AccountInput
          key={i}
          layoutId={`fee-share-provider-${i}`}
          providers={providers}
          provider={s.provider}
          handle={s.handle}
          onProvider={(v) => set(i, { provider: v })}
          onHandle={(v) => set(i, { handle: v })}
          trailing={
            <>
              <div className="relative w-20 shrink-0">
                <TextInput
                  aria-label="Share in percent"
                  className="pr-6 text-right"
                  inputMode="numeric"
                  value={String(s.pct)}
                  onChange={(e) => set(i, { pct: Math.max(0, Math.min(100, Math.round(Number(e.target.value.replace(/[^0-9]/g, "")) || 0))) })}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-text-3">%</span>
              </div>
              <button
                type="button"
                className="h-11 w-9 shrink-0 rounded-[3px] text-text-3 transition hover:bg-panel-2 hover:text-sell md:h-10"
                aria-label="Remove account"
                onClick={() => patch({ feeShares: shares.filter((_, j) => j !== i) })}
              >
                <X className="mx-auto h-4 w-4" />
              </button>
            </>
          }
        />
      ))}
      {shares.length < MAX_FEE_SHARES && (
        <button
          type="button"
          onClick={add}
          className="flex h-10 items-center justify-center gap-1.5 rounded-[3px] border border-dashed border-line-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-text-2 transition hover:border-brand/60 hover:text-text"
        >
          <Plus className="h-3.5 w-3.5" /> Add an account
        </button>
      )}
      <div className={`flex items-center justify-between gap-3 rounded-[3px] px-3 py-2.5 text-[12px] ${socialPct > 100 ? "bg-sell-bg text-sell" : "bg-bg-elev"}`}>
        <span>You keep</span>
        <span className="num font-semibold">
          {socialPct > 100 ? "over 100% — lower a share" : `${launcherPct}% of the creator share (${((launcherPct * creatorPct) / 100).toFixed(1)}% of all fees)`}
        </span>
      </div>
      <Callout tone="info">
        Each account's share goes to a vault only it can claim, tied to its permanent id. The split is written into a
        contract at launch and can never be changed: not by you, not by them, not by {BRAND.full}. You still sign, pay and receive
        the dev-buy tokens.
      </Callout>
    </div>
  );
}

/** One-tap targets from the accounts you've linked by signing in (e.g. launch "for" your own TikTok). */
function LinkedPicks({ providers, onPick }: { providers: SocialProvider[]; onPick: (p: SocialProvider, handle: string) => void }) {
  const me = useMySocial();
  const picks = (me.data?.accounts ?? []).filter((a) => a.handle && providers.includes(a.provider));
  if (!picks.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-text-3">Your accounts:</span>
      {picks.map((a) => (
        <button
          key={a.identityKey}
          type="button"
          onClick={() => onPick(a.provider, a.provider === "discord" ? a.providerUserId : a.handle!)}
          className="chip inline-flex items-center gap-1 hover:text-text"
        >
          <SocialIcon provider={a.provider} className="h-3 w-3" /> @{a.handle}
        </button>
      ))}
    </div>
  );
}

/** Hosted agents of the signed-in owner (null = the agents service isn't available on this server). */
function useMyHostedAgents(wallet: string | null | undefined) {
  return useQuery({
    queryKey: ["/api/me/agents", wallet],
    queryFn: fetchMyAgents,
    enabled: !!wallet,
    staleTime: 30_000,
    retry: false,
    select: (list: AgentProfile[] | null) => (list === null ? null : list.filter((a) => a.mode === "hosted")),
  });
}

function SignInPrompt() {
  const refresh = useRefreshSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    if (!getActiveAccount("svm")) {
      openWalletPrompt("Sign in to launch with your agent");
      return;
    }
    setBusy(true);
    try {
      await signInWithWallet();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-[3px] border border-line bg-bg-elev p-3">
      <div className="text-[13px] font-semibold text-text">Sign in to use your agents</div>
      <p className="mt-0.5 text-[11.5px] leading-snug text-text-3">
        Signing a message proves you own the agent. It doesn't send a transaction or cost anything.
      </p>
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className="btn btn-secondary mt-2.5 h-10 px-3.5"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        Sign in with your wallet
      </button>
      {err && <div className="mt-2 text-[11.5px] text-sell">{err}</div>}
    </div>
  );
}

function AgentPicker() {
  const session = useSession();
  const wallet = session.data?.wallet;
  const agents = useMyHostedAgents(wallet);
  const agentSlug = useLaunchDraft((s) => s.agentSlug);
  const agentName = useLaunchDraft((s) => s.agentName);
  const patch = useLaunchDraft((s) => s.patch);

  if (session.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your sign-in…
      </div>
    );
  }
  if (!wallet) return <SignInPrompt />;
  if (agents.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your agents…
      </div>
    );
  }
  if (agents.isError) return <Callout tone="bad">Couldn't load your agents — try again in a moment.</Callout>;
  const list = agents.data ?? [];
  if (!list.length) {
    return (
      <Callout tone="info" icon={<Bot />}>
        {agents.data === null ? "Agents aren't available on this server yet." : "You don't have a hosted agent yet."}{" "}
        <Link href="/agents" className="font-semibold text-text underline underline-offset-2">
          Create one on the Agents page
        </Link>{" "}
        — or launch to your own wallet.
      </Callout>
    );
  }
  const picked = list.find((a) => a.slug === agentSlug);
  return (
    <div className="grid gap-2">
      <FieldLabel label="Your hosted agents" hint="The agent's wallet earns the creator rewards" />
      <div role="radiogroup" className="grid gap-1.5">
        {list.map((a) => {
          const on = a.slug === agentSlug;
          const blocked = a.status !== "active";
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={blocked}
              onClick={() => patch({ agentSlug: a.slug, agentName: a.name })}
              className={cn(
                "flex min-h-[52px] items-center gap-3 rounded-[3px] border px-3 py-2 text-left transition-[border-color,background-color]",
                on ? "border-brand/70 bg-brand-bg" : "border-line bg-bg-elev hover:border-line-2",
                blocked && "cursor-not-allowed opacity-50",
              )}
            >
              {a.avatarUrl ? (
                <img src={a.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel-3 text-text-2">
                  <Bot className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-text">{a.name}</span>
                <span className="num block truncate text-[11px] text-text-3">
                  @{a.slug}
                  {a.wallet ? ` · wallet ${a.wallet.slice(0, 4)}…${a.wallet.slice(-4)}` : ""}
                  {blocked ? ` · ${a.status}` : ""}
                </span>
              </span>
              {on && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] bg-brand text-brand-ink">
                  <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {(picked || agentSlug) && (
        <Callout tone="warn" icon={<ShieldAlert />}>
          Creator rewards go to <b>{picked?.name ?? agentName ?? agentSlug}</b>'s wallet, run by Claudio — not to you. You still sign, pay
          and receive the dev-buy tokens.
        </Callout>
      )}
    </div>
  );
}

function SolanaRecipient() {
  const feeTo = useLaunchDraft((s) => s.feeTo);
  const patch = useLaunchDraft((s) => s.patch);
  // Social / split routing is EVM-only: a choice left over from another chain falls back to "My wallet".
  useEffect(() => {
    if (feeTo !== "me" && feeTo !== "agent") patch({ feeTo: "me" });
  }, [feeTo, patch]);
  const value = feeTo === "agent" ? "agent" : "me";
  return (
    <div className="grid gap-3">
      <ChoiceCards
        className="sm:grid-cols-2"
        value={value}
        onChange={(v) => patch({ feeTo: v })}
        options={[
          { value: "me", label: "My wallet", hint: "The signing wallet earns", icon: <Wallet /> },
          { value: "agent", label: "Launch with my agent", hint: "Your hosted agent's wallet earns", icon: <Bot /> },
        ]}
      />
      {value === "agent" && <AgentPicker />}
    </div>
  );
}

export function FeeRecipientCard({ chain, launchpad }: { chain: ChainId; launchpad?: LaunchpadId }) {
  if (CHAINS[chain].kind === "svm") return <SolanaRecipient />;
  return <EvmRecipient chain={chain} launchpad={launchpad} />;
}

function EvmRecipient({ chain, launchpad }: { chain: ChainId; launchpad?: LaunchpadId }) {
  const feeTo = useLaunchDraft((s) => s.feeTo);
  const provider = useLaunchDraft((s) => s.feeSocialProvider);
  const handle = useLaunchDraft((s) => s.feeSocialHandle);
  const shares = useLaunchDraft((s) => s.feeShares);
  const patch = useLaunchDraft((s) => s.patch);
  const config = useSocialConfig();

  const providers = config.data?.resolvable ?? [];
  const chainOk = !!config.data?.chains.includes(chain);
  const padOk = !!launchpad && !!config.data?.launchpads.includes(launchpad);
  const available = chainOk && padOk && providers.length > 0;
  const shareAvailable = !!config.data?.shareChains?.includes(chain);

  // Agents are Solana-only (their wallets are Solana escrows).
  useEffect(() => {
    if (feeTo === "agent") patch({ feeTo: "me" });
  }, [feeTo, patch]);

  // Keep the chosen providers valid for this server.
  useEffect(() => {
    if (providers.length && !providers.includes(provider)) patch({ feeSocialProvider: providers[0] });
    if (providers.length && shares.some((s) => !providers.includes(s.provider))) {
      patch({ feeShares: shares.map((s) => (providers.includes(s.provider) ? s : { ...s, provider: providers[0] })) });
    }
  }, [providers, provider, shares, patch]);

  // Entering split mode with no rows: start with one.
  useEffect(() => {
    if (feeTo === "split" && shares.length === 0 && providers.length) patch({ feeShares: [{ provider: providers[0], handle: "", pct: 30 }] });
  }, [feeTo, shares.length, providers, patch]);

  const unavailableReason = !config.data
    ? null
    : !chainOk
        ? "Social fee accounts aren't live on this chain yet."
      : !padOk
        ? `${launchpad ? LAUNCHPADS[launchpad].name : "This launchpad"} can't route fees to a social account yet (${(config.data.launchpads as LaunchpadId[]).map((id) => LAUNCHPADS[id]?.name ?? id).join(", ") || "none"} can).`
        : !providers.length
          ? "Social sign-in isn't set up on this server yet, so nobody could claim."
          : null;

  return (
    <div className="grid gap-3">
      <ChoiceCards
        className="sm:grid-cols-3"
        value={feeTo === "agent" ? "me" : feeTo}
        onChange={(v) => patch({ feeTo: v })}
        options={[
          { value: "me", label: "My wallet", hint: "The signing wallet earns", icon: <Wallet /> },
          { value: "social", label: "A social account", hint: "They claim by signing in", icon: <AtSign /> },
          { value: "split", label: "Split", hint: "You + several accounts", icon: <Split /> },
        ]}
      />
      {feeTo !== "me" && unavailableReason && <Callout tone="info">{unavailableReason}</Callout>}
      {feeTo === "social" && !unavailableReason && (
        <>
          <div>
            <FieldLabel label="Account" hint="They claim it later by signing in" />
            <div className="mb-2">
              <LinkedPicks providers={providers} onPick={(p, h) => patch({ feeSocialProvider: p, feeSocialHandle: h })} />
            </div>
            <AccountInput
              layoutId="fee-provider"
              providers={providers}
              provider={provider}
              handle={handle}
              onProvider={(v) => patch({ feeSocialProvider: v })}
              onHandle={(v) => patch({ feeSocialHandle: v })}
            />
          </div>
          <Callout tone="info">
            The creator share goes to a vault only this account can claim, tied to its permanent id (renaming the handle
            doesn't change it). You still sign, pay and receive the dev-buy tokens. The coin is labelled as launched by
            someone else until they claim.
          </Callout>
        </>
      )}
      {feeTo === "split" && !unavailableReason && <SplitEditor providers={providers} shareAvailable={shareAvailable} />}
    </div>
  );
}
