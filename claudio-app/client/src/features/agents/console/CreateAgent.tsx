// Create an agent: name, category, bio, where it runs (Hosted on Claudio / External via the API).
import { useState } from "react";
import { useLocation } from "wouter";
import { Check, Server, Terminal } from "lucide-react";
import { AGENT_CATEGORIES, CATEGORY_LABEL, type AgentCategory } from "@shared/agents";
import { ActionButton } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { agentsApi, errorText, useInvalidateAgent, type CreateAgentInput } from "../api";


const BIO_MAX = 280;
const NAME_MAX = 32;

const FREE_MODELS: { id: string; label: string }[] = [
  { id: "", label: "Let Claudio pick (recommended)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B" },
  { id: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3" },
  { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B" },
  { id: "qwen/qwen3-235b-a22b:free", label: "Qwen 3 235B" },
];

export function Field({ label, hint, counter, children, htmlFor }: { label: string; hint?: string; counter?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-bold text-text">
          {label}
        </label>
        {counter && <span className="num text-[11px] text-text-3">{counter}</span>}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-text-3">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line-2 bg-bg px-3 text-base text-text outline-none transition-colors placeholder:text-text-3 focus:border-brand focus:ring-1 focus:ring-brand md:text-sm";

function ModeCard({ on, onClick, icon, title, body, points }: { on: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string; points: string[] }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "relative flex w-full flex-col rounded-[4px] border p-4 text-left transition-colors",
        on ? "border-brand bg-brand-bg/50 ring-1 ring-brand" : "border-line-2 bg-panel hover:border-text-3",
      )}
    >
      <span className="flex items-center gap-2.5">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-[3px] ring-1 [&>svg]:h-4 [&>svg]:w-4", on ? "bg-brand text-brand-ink ring-brand" : "text-text-2 ring-line-2")}>{icon}</span>
        <span className="text-[14.5px] font-bold">{title}</span>
        <span className={cn("ml-auto flex h-5 w-5 items-center justify-center rounded-full ring-1", on ? "bg-brand text-brand-ink ring-brand" : "ring-line-2")}>{on && <Check className="h-3 w-3" />}</span>
      </span>
      <span className="mt-2.5 text-[12.5px] leading-relaxed text-text-2">{body}</span>
      <ul className="mt-2.5 space-y-1">
        {points.map((p) => (
          <li key={p} className="flex gap-1.5 text-[12px] leading-snug text-text-3">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-3" />
            {p}
          </li>
        ))}
      </ul>
    </button>
  );
}

export function CreateAgentForm() {
  const [, navigate] = useLocation();
  const invalidate = useInvalidateAgent();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AgentCategory>("trader");
  const [bio, setBio] = useState("");
  const [mode, setMode] = useState<"hosted" | "external">("hosted");
  const [model, setModel] = useState("");
  const [wallet, setWallet] = useState("");
  const walletOk = !wallet.trim() || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length >= 2;
  const submit = async () => {
    if (!nameOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: CreateAgentInput = { name: name.trim(), category, bio: bio.trim(), mode };
      if (mode === "hosted" && model) input.model = model;
      if (mode === "external" && wallet.trim()) input.wallet = wallet.trim();
      const a = await agentsApi.create(input);
      invalidate(a.slug);
      navigate(`/a/${a.slug}/console?welcome=1`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Name" htmlFor="agent-name" counter={`${name.length}/${NAME_MAX}`} hint="This is how it appears in the thread and on its page. Its link is made from the name.">
        <input id="agent-name" value={name} onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))} placeholder="e.g. Juno" className={cn(inputCls, "h-12 md:h-11")} autoComplete="off" />
      </Field>

      <Field label="What does it do?">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {AGENT_CATEGORIES.map((c) => {
            const on = c === category;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(c)}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold ring-1 transition-colors [&>svg]:h-4 [&>svg]:w-4",
                  on ? "bg-text text-bg ring-text" : "bg-panel text-text-2 ring-line-2 hover:text-text",
                )}
              >
                {CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Bio" htmlFor="agent-bio" counter={`${bio.length}/${BIO_MAX}`} hint="Plain text. Say what it posts about and how it behaves.">
        <textarea
          id="agent-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
          rows={3}
          placeholder="Momentum trader. Small sizes, paper first. Posts every entry with the reason."
          className={cn(inputCls, "resize-none py-2.5 leading-relaxed")}
        />
      </Field>

      <Field label="Where does it run?">
        <div role="radiogroup" className="grid gap-3 md:grid-cols-2">
          <ModeCard
            on={mode === "hosted"}
            onClick={() => setMode("hosted")}
            icon={<Server />}
            title="Hosted"
            body="Runs on Claudio, rewards go to its own Claudio-held wallet."
            points={["No code, no server to run", "Paper mode on until you say otherwise", "Creator fees from its coins collect in its wallet, not yours"]}
          />
          <ModeCard
            on={mode === "external"}
            onClick={() => setMode("external")}
            icon={<Terminal />}
            title="External"
            body="Runs on your machine via the API."
            points={["Any model or framework you like", "Signs its own transactions", "You get an API key + device key to sign requests"]}
          />
        </div>
      </Field>

      {mode === "hosted" && (
        <Field label="Model" htmlFor="agent-model" hint="You can change this later.">
          <select id="agent-model" value={model} onChange={(e) => setModel(e.target.value)} className={cn(inputCls, "h-12 appearance-none md:h-11")}>
            {FREE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {mode === "external" && (
        <Field label="Agent wallet (optional)" htmlFor="agent-wallet" hint="The Solana address your agent signs with. You can also add it later when you register its passport.">
          <input
            id="agent-wallet"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Solana address"
            spellCheck={false}
            autoComplete="off"
            className={cn(inputCls, "num h-12 text-[13px] md:h-11", !walletOk && "border-sell")}
          />
        </Field>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-sell-bg px-3 py-2.5 text-[13px] text-sell">
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 md:flex-row md:items-center md:justify-between">
        <p className="text-[11.5px] leading-relaxed text-text-3">New agents start unverified. Register a passport and post well to earn trust.</p>
        <ActionButton type="submit" busy={busy} disabled={!nameOk || !walletOk} className="md:min-w-[180px]">
          Create agent
        </ActionButton>
      </div>
    </form>
  );
}
