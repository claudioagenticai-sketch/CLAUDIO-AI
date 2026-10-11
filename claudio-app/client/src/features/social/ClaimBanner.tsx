// Token page strip: "Creator fees go to @handle — Is this you? Claim now". Renders nothing for normal launches.
// Split launches list every account sharing the creator fees, each with its claim status.
import { useState } from "react";
import { BadgeCheck, Gift, Info } from "lucide-react";
import type { ChainId } from "@shared/chains";
import { SOCIAL_PROVIDER_LABEL, type FeeShare } from "@shared/social";
import { ActionButton } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { useTokenBeneficiary } from "./api";
import { ClaimSheet, SocialHandle } from "./ui";

export function ClaimBanner({ chain, address }: { chain: ChainId; address: string }) {
  const { data } = useTokenBeneficiary(chain, address);
  const [open, setOpen] = useState(false);
  const b = data?.beneficiary;
  if (!b) return null;
  if (data?.shares?.length) return <SharedBanner shares={data.shares} open={open} setOpen={setOpen} />;
  const who = b.handle ? `@${b.handle}` : b.identityKey;
  const waiting = data?.vault && !b.claimed ? Number(data.vault.balance) : 0;
  return (
    <>
      <section className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", b.claimed ? "panel" : "panel-accent")}>
        <div className="flex min-w-0 items-center gap-3">
          {b.avatarUrl ? (
            <img src={b.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full ring-1 ring-line-2" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] text-brand ring-1 ring-inset ring-line-2">
              <Gift className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="text-text-2">Creator fees go to</span>
              <SocialHandle provider={b.provider} handle={b.handle} fallback={b.identityKey} />
              {b.claimed ? (
                <span className="chip chip-buy">
                  <BadgeCheck className="h-3 w-3" /> claimed
                </span>
              ) : (
                <span className="chip chip-warn">unclaimed</span>
              )}
            </div>
            <div className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-text-3">
              <Info className="mt-px h-3 w-3 shrink-0" />
              {b.claimed
                ? `${who} verified this ${SOCIAL_PROVIDER_LABEL[b.provider]} account. Fees are paid out automatically.`
                : `Launched for ${who} by someone else — not affiliated unless claimed.`}
              {waiting > 0 && ` ${waiting.toLocaleString(undefined, { maximumFractionDigits: 5 })} ${data?.vault?.symbol} waiting.`}
            </div>
          </div>
        </div>
        {!b.claimed && (
          <ActionButton onClick={() => setOpen(true)} className="h-10">
            <Gift /> Is this you? Claim now
          </ActionButton>
        )}
      </section>
      <ClaimSheet open={open} onOpenChange={setOpen} focusKey={b.identityKey} label={who} />
    </>
  );
}

function SharedBanner({ shares, open, setOpen }: { shares: FeeShare[]; open: boolean; setOpen: (v: boolean) => void }) {
  const firstUnclaimed = shares.find((s) => s.kind === "social" && !s.claimed);
  const label = (s: FeeShare) => (s.handle ? `@${s.handle}` : (s.identityKey ?? ""));
  return (
    <>
      <section className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", firstUnclaimed ? "panel-accent" : "panel")}>
        <div className="min-w-0">
          <div className="eyebrow">Creator fees are shared</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {shares.map((s) => (
              <span key={s.address} className="inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 ring-1 ring-inset ring-line">
                {s.kind === "launcher" || !s.provider ? (
                  <span className="text-text-2">launcher</span>
                ) : (
                  <SocialHandle provider={s.provider} handle={s.handle} fallback={s.identityKey ?? s.address} />
                )}
                <span className="num font-semibold">{s.bps / 100}%</span>
                {s.kind === "social" &&
                  (s.claimed ? (
                    <span className="chip chip-buy">
                      <BadgeCheck className="h-3 w-3" /> claimed
                    </span>
                  ) : (
                    <span className="chip chip-warn">unclaimed</span>
                  ))}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-text-3">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Shares are fixed on-chain. Accounts were added by the launcher — not affiliated unless claimed.
          </div>
        </div>
        {firstUnclaimed && (
          <ActionButton onClick={() => setOpen(true)} className="h-10">
            <Gift /> Is this you? Claim now
          </ActionButton>
        )}
      </section>
      {firstUnclaimed?.identityKey && (
        <ClaimSheet open={open} onOpenChange={setOpen} focusKey={firstUnclaimed.identityKey} label={label(firstUnclaimed)} />
      )}
    </>
  );
}
