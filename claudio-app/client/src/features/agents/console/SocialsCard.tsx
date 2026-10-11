// Owner-editable social links. Saved with PATCH /api/agents/:slug { socials }; the server normalises "@name" and
// profile URLs, and a link only becomes "verified" after an admin checks the account mentioned @claudio_onchain.
import { useEffect, useMemo, useState } from "react";
import { SOCIAL_PLATFORMS, type AgentProfile, type SocialPlatform } from "@shared/agents";
import { toast } from "@/hooks/use-toast";
import { ActionButton, Card } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { agentsApi, errorText, isUnavailable, useInvalidateAgent } from "../api";
import { SOCIAL_LABEL, SocialMark } from "../ui";
import { inputCls } from "./CreateAgent";

const PLACEHOLDER: Record<SocialPlatform, string> = {
  x: "@handle or x.com link",
  tiktok: "@handle or tiktok.com link",
  youtube: "@channel",
  instagram: "@handle",
  telegram: "t.me/… or @handle",
  website: "example.com",
};

type Draft = Record<SocialPlatform, string>;

function draftOf(agent: AgentProfile): Draft {
  const d = Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, ""])) as Draft;
  for (const s of agent.socials ?? []) d[s.platform] = s.platform === "website" ? s.handle : `@${s.handle}`;
  return d;
}

export function SocialsCard({ agent }: { agent: AgentProfile }) {
  const invalidate = useInvalidateAgent();
  const initial = useMemo(() => draftOf(agent), [agent]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(initial), [initial]);

  const dirty = SOCIAL_PLATFORMS.some((p) => draft[p].trim() !== initial[p]);
  const byPlatform = new Map((agent.socials ?? []).map((s) => [s.platform, s]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const socials = SOCIAL_PLATFORMS.filter((p) => draft[p].trim()).map((platform) => ({ platform, handle: draft[platform].trim() }));
      await agentsApi.patch(agent.slug, { socials });
      invalidate(agent.slug);
      toast({ title: "Social accounts saved" });
    } catch (e) {
      setError(isUnavailable(e) ? "Social accounts are coming soon." : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Social accounts">
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-text-3">
          To verify, post from that account mentioning @claudio_onchain on X or TikTok — we'll confirm it.
        </p>
        <ul className="space-y-2">
          {SOCIAL_PLATFORMS.map((p) => {
            const saved = byPlatform.get(p);
            const same = saved && draft[p].trim() === initial[p];
            return (
              <li key={p} className="flex items-center gap-2">
                <span className="flex w-[92px] shrink-0 items-center gap-2 text-[12.5px] font-semibold text-text-2">
                  <SocialMark platform={p} size={14} />
                  {SOCIAL_LABEL[p]}
                </span>
                <input
                  value={draft[p]}
                  onChange={(e) => setDraft((d) => ({ ...d, [p]: e.target.value.slice(0, 120) }))}
                  placeholder={PLACEHOLDER[p]}
                  aria-label={`${SOCIAL_LABEL[p]} account`}
                  spellCheck={false}
                  autoCapitalize="none"
                  className={cn(inputCls, "h-10 min-w-0 flex-1 text-[13px]")}
                />
                {draft[p] && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, [p]: "" }))}
                    className="h-10 shrink-0 rounded-[3px] px-2 text-[12px] font-semibold text-text-3 hover:bg-panel-3 hover:text-text"
                    aria-label={`Remove ${SOCIAL_LABEL[p]}`}
                  >
                    Remove
                  </button>
                )}
                {same && saved && (
                  <span className={cn("w-[66px] shrink-0 text-right text-[11px]", saved.verified ? "font-semibold text-buy" : "text-text-3")}>
                    {saved.verified ? "Verified" : "Unverified"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="text-[12px] text-sell">
            {error}
          </p>
        )}
        <ActionButton className="w-full" disabled={!dirty} busy={busy} onClick={save}>
          Save social accounts
        </ActionButton>
      </div>
    </Card>
  );
}
