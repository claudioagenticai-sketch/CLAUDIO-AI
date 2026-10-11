// Edit the public profile: name, bio, category, avatar URL (http(s) only).
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { AGENT_CATEGORIES, CATEGORY_LABEL, type AgentCategory, type AgentProfile } from "@shared/agents";
import { toast } from "@/hooks/use-toast";
import { ActionButton, Card } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { agentsApi, errorText, isUnavailable, useInvalidateAgent } from "../api";
import { AgentAvatar, safeImageUrl } from "../ui";
import { Field, inputCls } from "./CreateAgent";

export function ProfileCard({ agent }: { agent: AgentProfile }) {
  const invalidate = useInvalidateAgent();
  const [name, setName] = useState(agent.name);
  const [bio, setBio] = useState(agent.bio);
  const [category, setCategory] = useState<AgentCategory>(agent.category);
  const [avatar, setAvatar] = useState(agent.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(agent.name);
    setBio(agent.bio);
    setCategory(agent.category);
    setAvatar(agent.avatarUrl ?? "");
  }, [agent.name, agent.bio, agent.category, agent.avatarUrl]);

  const avatarOk = !avatar.trim() || !!safeImageUrl(avatar);
  const dirty = name !== agent.name || bio !== agent.bio || category !== agent.category || avatar !== (agent.avatarUrl ?? "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.patch(agent.slug, { name: name.trim(), bio: bio.trim(), category, avatarUrl: avatar.trim() || null });
      invalidate(agent.slug);
      toast({ title: "Profile saved" });
    } catch (e) {
      setError(isUnavailable(e) ? "Editing profiles is coming soon." : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Profile" icon={<UserRound />}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={{ slug: agent.slug, name: name || agent.name, avatarUrl: avatarOk ? avatar : null, tier: agent.tier }} size={52} />
          <div className="min-w-0 flex-1">
            <Field label="Avatar URL" hint="An https:// image link. Leave empty for initials.">
              <input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" className={cn(inputCls, "h-10 text-[13px]", !avatarOk && "border-sell")} spellCheck={false} />
            </Field>
          </div>
        </div>
        <Field label="Name" counter={`${name.length}/32`}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 32))} className={cn(inputCls, "h-11")} />
        </Field>
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as AgentCategory)} className={cn(inputCls, "h-11 appearance-none")}>
            {AGENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bio" counter={`${bio.length}/280`}>
          <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 280))} rows={3} className={cn(inputCls, "resize-none py-2.5 leading-relaxed")} />
        </Field>
        {error && <p role="alert" className="text-[12px] text-sell">{error}</p>}
        <ActionButton className="w-full" disabled={!dirty || !avatarOk || name.trim().length < 2} busy={busy} onClick={save}>
          Save profile
        </ActionButton>
      </div>
    </Card>
  );
}
