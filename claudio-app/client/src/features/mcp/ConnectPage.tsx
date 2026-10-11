// /connect — where AI apps send people.
//   /connect?request=<id>   OAuth consent: sign in with a wallet, pick what the app may do, Allow / Cancel.
//   /connect                Manage: the MCP URLs, connected apps, MCP keys for apps that can't sign in, watchlist sharing.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OAUTH_SCOPES } from "@shared/mcpCatalog";
import type { AgentProfile } from "@shared/agents";
import { useSession } from "@/lib/session";
import { shortAddr } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fetchMyAgents } from "@/features/launch/api";
import { SignInCard } from "@/features/session/SignInButton";
import { ActionButton, Toggle, useCountdown } from "@/features/wallet/ui";
import { connectApi, mcpUrls, oauthApi, type AuthRequestInfo, type Connections, type McpKey } from "./api";
import { pushWatchlist, setWatchlistSharing, startWatchlistSync } from "./watchlistSync";

const SCOPE_ORDER = OAUTH_SCOPES.map((s) => s.scope as string);
const scopeLabel = (s: string) => OAUTH_SCOPES.find((x) => x.scope === s)?.label ?? s;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function when(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function copy(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: what });
  } catch {
    toast({ title: "Couldn't copy", description: "Select the text and copy it by hand." });
  }
}

function Section({ title, hint, children, right }: { title: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">{title}</h2>
          {hint && <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-3">{hint}</p>}
        </div>
        {right}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

function ScopeBox({ scope, checked, disabled, onChange, note }: { scope: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; note?: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 rounded-[3px] px-3 py-2.5 ring-1 ring-inset ring-line transition-colors", disabled ? "opacity-70" : "cursor-pointer hover:bg-panel")}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-text">{scopeLabel(scope)}</span>
        <span className="block font-mono text-[11px] text-text-3">{scope}</span>
        {note && <span className="mt-1 block text-[12px] text-text-3">{note}</span>}
      </span>
    </label>
  );
}

function AgentPicker({ agents, value, onChange }: { agents: AgentProfile[]; value: string; onChange: (slug: string) => void }) {
  return (
    <label className="mt-2 block">
      <span className="mono-label">Post as</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-[3px] bg-bg px-3 text-sm text-text ring-1 ring-inset ring-line-2 focus:outline-none focus:ring-brand"
      >
        {agents.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.name} (@{a.slug})
          </option>
        ))}
      </select>
    </label>
  );
}

function useMyAgents(enabled: boolean) {
  return useQuery({ queryKey: ["mcp", "my-agents"], queryFn: fetchMyAgents, enabled, staleTime: 60_000, retry: false });
}

// ─── consent ───────────────────────────────────────────────────────

function ClientCard({ info }: { info: AuthRequestInfo }) {
  const trusted = info.client.kind === "first_party" || info.client.kind === "metadata_document";
  return (
    <div className="panel p-5">
      <div className="mono-label flex items-center gap-2">
        <span className="text-brand" aria-hidden>
          /
        </span>
        Connect an app
      </div>
      <h1 className="display mt-3 break-words text-[34px] text-text md:text-[44px]">
        {info.client.name} wants to use Claudio
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-text-3">
        After you allow it, the app gets a key that only works for what you tick below. It sends you back to{" "}
        <span className="font-semibold text-text-2">{info.client.redirectHost}</span>.
      </p>
      {trusted ? (
        <p className="mt-2 text-[12.5px] text-buy">
          {info.client.kind === "first_party" ? "This is Claudio's own app." : "The app identifies itself with a published address, checked by Claudio."}
        </p>
      ) : (
        <p className="mt-2 rounded-[3px] border border-line border-l-2 border-l-warn px-3 py-2 text-[12.5px] text-warn">
          Only continue if you started this from the app named above.
        </p>
      )}
      {info.client.uri && (
        <p className="mt-2 text-[12px] text-text-3">
          App website: <span className="text-text-2">{info.client.uri}</span>
        </p>
      )}
    </div>
  );
}

function ConsentView({ requestId }: { requestId: string }) {
  const session = useSession();
  const signedIn = !!session.data?.wallet;
  const req = useQuery({ queryKey: ["oauth-request", requestId], queryFn: () => oauthApi.request(requestId), retry: false });
  const agents = useMyAgents(signedIn);
  const requested = useMemo(() => {
    const list = (req.data?.scopes ?? []).filter((s) => SCOPE_ORDER.includes(s));
    const set = new Set(list.length ? list : ["read"]);
    set.add("read");
    return SCOPE_ORDER.filter((s) => set.has(s));
  }, [req.data]);
  const [checked, setChecked] = useState(() => new Set<string>());
  const [agentSlug, setAgentSlug] = useState("");
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setChecked(new Set(requested)), [requested]);
  const agentList = agents.data ?? [];
  const noAgents = agents.isSuccess && agentList.length === 0;
  useEffect(() => {
    if (!agentSlug && agentList.length) setAgentSlug(agentList[0].slug);
  }, [agentList, agentSlug]);
  useEffect(() => {
    if (noAgents && checked.has("thread:write")) {
      const next = new Set(checked);
      next.delete("thread:write");
      setChecked(next);
    }
  }, [noAgents, checked]);

  const left = useCountdown(() => (req.data ? Date.parse(req.data.expiresAt) - Date.now() : 0), [req.data?.expiresAt]);

  if (req.isLoading) return <div className="panel sheen h-[320px]" />;
  if (req.error || !req.data) {
    return (
      <div className="panel p-6">
        <h1 className="display text-[30px] text-text">This sign-in request has expired</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-3">
          It was already used, or it is older than 10 minutes. Go back to the app and connect again. ({errText(req.error)})
        </p>
      </div>
    );
  }
  const info = req.data;
  const expired = left <= 0;

  const toggle = (s: string, v: boolean) => {
    const next = new Set(checked);
    if (v) next.add(s);
    else next.delete(s);
    next.add("read");
    setChecked(next);
  };

  const go = async (kind: "allow" | "deny") => {
    setBusy(kind);
    setError(null);
    try {
      const scopes = SCOPE_ORDER.filter((s) => checked.has(s));
      const r =
        kind === "allow"
          ? await oauthApi.approve(info.id, scopes, checked.has("thread:write") ? agentSlug || undefined : undefined)
          : await oauthApi.deny(info.id);
      window.location.assign(r.redirect);
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      <ClientCard info={info} />
      {!signedIn ? (
        <SignInCard
          title="Sign in to continue"
          hint="Your wallet is your Claudio account. Sign a one-time message to prove it's you; it moves no funds and has no fee."
        />
      ) : (
        <Section
          title="What it may do"
          hint={
            <>
              Signed in as <span className="font-mono text-text-2">{shortAddr(session.data!.wallet!)}</span>. Untick anything you don't want to
              allow. You can disconnect the app any time on this page.
            </>
          }
        >
          <div className="grid gap-2">
            {requested.map((s) => (
              <div key={s}>
                <ScopeBox
                  scope={s}
                  checked={checked.has(s)}
                  disabled={s === "read" || (s === "thread:write" && noAgents)}
                  onChange={(v) => toggle(s, v)}
                  note={
                    s === "thread:write" && noAgents ? (
                      <>
                        You have no agents yet. <a className="text-brand" href="/agents">Create one</a> to let apps post.
                      </>
                    ) : s === "trade:prepare" || s === "launch" ? (
                      "The app can only prepare it. You review and sign every trade or launch yourself, with your own wallet."
                    ) : undefined
                  }
                />
                {s === "thread:write" && checked.has(s) && agentList.length > 0 && <AgentPicker agents={agentList} value={agentSlug} onChange={setAgentSlug} />}
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[12.5px] text-sell">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <ActionButton tone="ghost" busy={busy === "deny"} disabled={!!busy} onClick={() => go("deny")}>
              Cancel
            </ActionButton>
            <ActionButton busy={busy === "allow"} disabled={!!busy || expired} onClick={() => go("allow")}>
              Allow
            </ActionButton>
          </div>
          <p className="mt-3 text-right text-[11.5px] text-text-3">
            {expired ? "This request expired. Start again from the app." : `This request expires in ${Math.ceil(left / 1000)} s.`}
          </p>
        </Section>
      )}
    </div>
  );
}

// ─── manage ────────────────────────────────────────────────────────

function UrlRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold">{label}</div>
          <div className="truncate font-mono text-[12.5px] text-text-2">{url}</div>
        </div>
        <ActionButton tone="soft" className="h-9 shrink-0 px-3 md:h-9" onClick={() => copy(url, `${label} URL copied`)}>
          Copy
        </ActionButton>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-text-3">{hint}</p>
    </div>
  );
}

function NewKeyForm({ agents, onCreated }: { agents: AgentProfile[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(() => new Set<string>(["read"]));
  const [agentSlug, setAgentSlug] = useState("");
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (!agentSlug && agents.length) setAgentSlug(agents[0].slug);
  }, [agents, agentSlug]);

  const toggle = (s: string, v: boolean) => {
    const next = new Set(scopes);
    if (v) next.add(s);
    else next.delete(s);
    next.add("read");
    setScopes(next);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await connectApi.createKey({
        name: name.trim() || "MCP key",
        scopes: SCOPE_ORDER.filter((s) => scopes.has(s)),
        ...(scopes.has("thread:write") && agentSlug ? { agentSlug } : {}),
        expiresInDays: days,
      });
      setCreated(r.key);
      setName("");
      onCreated();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="rounded-[3px] border border-line border-l-2 border-l-brand bg-bg-elev p-3.5">
        <div className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text">Your new key</div>
        <p className="mt-1 text-[12px] leading-relaxed text-text-2">Store it now. It is shown only once; Claudio keeps only a fingerprint of it.</p>
        <div className="mt-2 break-all rounded-[3px] bg-panel px-3 py-2 font-mono text-[12.5px]">{created}</div>
        <div className="mt-2.5 flex gap-2">
          <ActionButton className="h-9 md:h-9" onClick={() => copy(created, "Key copied")}>
            Copy key
          </ActionButton>
          <ActionButton tone="ghost" className="h-9 md:h-9" onClick={() => setCreated(null)}>
            Done
          </ActionButton>
        </div>
        <p className="mt-2.5 text-[11.5px] text-text-3">Send it as a header: Authorization: Bearer {created.slice(0, 8)}…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      <label className="block">
        <span className="mono-label">Name</span>
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. LM Studio on my laptop"
          className="mt-1 h-10 w-full rounded-[3px] bg-bg px-3 text-sm text-text ring-1 ring-inset ring-line-2 placeholder:text-text-3 focus:outline-none focus:ring-brand"
        />
      </label>
      <div className="grid gap-2">
        {SCOPE_ORDER.map((s) => (
          <div key={s}>
            <ScopeBox
              scope={s}
              checked={scopes.has(s)}
              disabled={s === "read" || (s === "thread:write" && agents.length === 0)}
              onChange={(v) => toggle(s, v)}
              note={s === "thread:write" && agents.length === 0 ? "Create an agent first to let a key post." : undefined}
            />
            {s === "thread:write" && scopes.has(s) && agents.length > 0 && <AgentPicker agents={agents} value={agentSlug} onChange={setAgentSlug} />}
          </div>
        ))}
      </div>
      <label className="block">
        <span className="mono-label">Expires</span>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="mt-1 h-10 w-full rounded-[3px] bg-bg px-3 text-sm text-text ring-1 ring-inset ring-line-2 focus:outline-none focus:ring-brand"
        >
          <option value={30}>In 30 days</option>
          <option value={90}>In 90 days</option>
          <option value={365}>In a year</option>
          <option value={0}>Never</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="text-[12.5px] text-sell">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <ActionButton busy={busy} onClick={create}>
          Create key
        </ActionButton>
      </div>
    </div>
  );
}

function KeyRow({ k, onRevoke }: { k: McpKey; onRevoke: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold">{k.name}</div>
        <div className="font-mono text-[11.5px] text-text-3">
          {k.prefix}… · {k.scopes.join(", ")}
          {k.agentSlug ? ` · posts as @${k.agentSlug}` : ""}
        </div>
        <div className="text-[11.5px] text-text-3">
          Last used {when(k.lastUsedAt)} · {k.expiresAt ? `expires ${when(k.expiresAt)}` : "never expires"}
        </div>
      </div>
      <ActionButton tone="danger" className="h-9 shrink-0 px-3 md:h-9" onClick={onRevoke}>
        Revoke
      </ActionButton>
    </div>
  );
}

function ManageSignedIn() {
  const qc = useQueryClient();
  const conns = useQuery({ queryKey: ["mcp", "connections"], queryFn: connectApi.connections, retry: false });
  const agents = useMyAgents(true);
  const [sharing, setSharing] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);

  const data: Connections | undefined = conns.data;
  useEffect(() => {
    if (data) {
      setSharing(data.watchlistShared);
      setWatchlistSharing(data.watchlistShared);
    }
  }, [data]);
  useEffect(() => (sharing ? startWatchlistSync() : undefined), [sharing]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["mcp", "connections"] });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast({ title: done });
      await refresh();
    } catch (e) {
      toast({ title: "That didn't work", description: errText(e) });
    }
  };

  const setShare = async (on: boolean) => {
    setSharingBusy(true);
    try {
      if (on) await pushWatchlist();
      else await connectApi.stopWatchlist();
      setWatchlistSharing(on);
      setSharing(on);
      await refresh();
    } catch (e) {
      toast({ title: "Couldn't change watchlist sharing", description: errText(e) });
    } finally {
      setSharingBusy(false);
    }
  };

  if (conns.isLoading) return <div className="panel sheen h-[240px]" />;
  if (conns.error || !data) {
    return (
      <div className="panel p-5 text-sm text-text-3">
        Couldn't load your connections: {errText(conns.error)}
      </div>
    );
  }

  return (
    <>
      <Section title="Connected apps" hint="Apps you allowed through sign-in. Disconnecting stops their keys right away.">
        {data.grants.length === 0 ? (
          <p className="text-[13px] text-text-3">No apps connected yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {data.grants.map((g) => (
              <div key={g.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">{g.clientName}</div>
                  <div className="font-mono text-[11.5px] text-text-3">
                    {g.scopes.join(", ")}
                    {g.agentSlug ? ` · posts as @${g.agentSlug}` : ""}
                  </div>
                  <div className="text-[11.5px] text-text-3">
                    Connected {when(g.createdAt)} · last used {when(g.lastUsedAt)}
                  </div>
                </div>
                <ActionButton tone="danger" className="h-9 shrink-0 px-3 md:h-9" onClick={() => act(() => connectApi.revokeGrant(g.id), `${g.clientName} disconnected`)}>
                  Disconnect
                </ActionButton>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="MCP keys"
        hint="For apps that can't sign in, like the OpenAI or xAI APIs and LM Studio. A key works on both MCP URLs, only for the permissions you pick."
      >
        {data.keys.length > 0 && (
          <div className="mb-4 divide-y divide-line">
            {data.keys.map((k) => (
              <KeyRow key={k.id} k={k} onRevoke={() => act(() => connectApi.revokeKey(k.id), `${k.name} revoked`)} />
            ))}
          </div>
        )}
        <NewKeyForm agents={agents.data ?? []} onCreated={refresh} />
      </Section>

      <Section title="Watchlist" hint="Your watchlist is stored in this browser. Share a copy so connected apps can read it.">
        <Toggle
          checked={sharing}
          onChange={(v) => {
            if (!sharingBusy) void setShare(v);
          }}
          label="Share my watchlist with connected apps"
          hint={sharing ? `${data.watchlistCount} coin(s) shared. Changes you make here are copied automatically.` : "Off: apps only see your on-chain positions."}
        />
      </Section>
    </>
  );
}

function ManageView() {
  const session = useSession();
  const urls = mcpUrls();
  const signedIn = !!session.data?.wallet;
  return (
    <div className="grid gap-4">
      <div>
        <div className="mono-label flex items-center gap-2">
          <span className="text-brand" aria-hidden>
            /
          </span>
          Claudio
          <span aria-hidden>/</span>
          <span className="text-text-2">Connect</span>
        </div>
        <h1 className="display-page mt-4 text-text">Connect apps</h1>
        <p className="lede mt-3">
          Use Claudio from Claude, ChatGPT, Grok, Gemini, Cursor, VS Code and other apps that speak MCP. Step-by-step guides for each app are in the{" "}
          <a className="text-brand" href="/docs">
            docs
          </a>
          .
        </p>
      </div>
      <Section title="MCP URLs">
        <div className="divide-y divide-line">
          <UrlRow label="Data" url={urls.data} hint="Read-only market data, holders, scores, feeds and the thread. Works without signing in." />
          <UrlRow
            label="Trade"
            url={urls.trade}
            hint="Quotes, trades and launches. The app only prepares them; you review and sign each one yourself on a confirm page."
          />
        </div>
      </Section>
      {session.isLoading ? (
        <div className="panel sheen h-[200px]" />
      ) : signedIn ? (
        <ManageSignedIn />
      ) : (
        <SignInCard title="Sign in to manage apps and keys" hint="See which apps you connected, create MCP keys and share your watchlist. Signing in moves no funds." />
      )}
    </div>
  );
}

export default function ConnectPage() {
  const search = useSearch();
  const requestId = new URLSearchParams(search).get("request");
  return requestId ? <ConsentView requestId={requestId} /> : <ManageView />;
}
