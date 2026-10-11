// /cloud/:slug — one hosted agent's workspace: Chat, Helpers, Memory, Files, Skills, Activity.
// Desktop: header + a tab row, chat fills the height. Phone: tabs as a segmented control, chat full-screen.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import type { CloudWorkspace } from "@shared/cloud";
import { Page } from "@/features/wallet/ui";
import { errorText } from "@/features/agents/api";
import { AgentAvatar, ModelLabel } from "@/features/agents/ui";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./api";
import { ChatTab } from "./Chat";
import { FilesTab } from "./Files";
import { ActivityTab, HelpersTab, MemoryTab, SkillsTab } from "./panels";
import { CreateHostedLink } from "./CloudHome";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "helpers", label: "Helpers" },
  { id: "memory", label: "Memory" },
  { id: "files", label: "Files" },
  { id: "skills", label: "Skills" },
  { id: "activity", label: "Activity" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function readTab(): TabId {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.id === t) ? (t as TabId) : "chat";
}

function Tabs({ tab, setTab, pending }: { tab: TabId; setTab: (t: TabId) => void; pending: number }) {
  return (
    <div role="tablist" aria-label="Workspace" className="grid w-full grid-cols-6 gap-0.5 border-b border-line md:inline-flex md:w-auto md:gap-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === tab}
          onClick={() => setTab(t.id)}
          className={cn(
            "relative h-10 whitespace-nowrap px-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] transition-colors md:px-3.5 md:text-[11.5px] md:tracking-[0.1em]",
            t.id === tab ? "text-text shadow-[inset_0_-2px_0_var(--brand)]" : "text-text-3 hover:text-text-2",
          )}
        >
          {t.label}
          {t.id === "chat" && pending > 0 && (
            <span className="num ml-1 rounded-[2px] bg-warn px-1.5 text-[10px] font-bold text-bg" aria-label={`${pending} waiting for you`}>
              {pending}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function Header({ ws }: { ws: CloudWorkspace }) {
  const a = ws.agent;
  return (
    <div className="flex items-center gap-3">
      <AgentAvatar agent={a} size={40} className="hidden md:inline-flex" />
      <div className="min-w-0 flex-1">
        <h1 className="display truncate text-[30px] text-text md:text-[40px]">{a.name}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", a.running ? "bg-buy" : "bg-text-3")} />
            {a.status !== "active" ? a.status : a.running ? "Running" : "Stopped"}
          </span>
          <ModelLabel model={a.model} className="text-[12px]" />
          {ws.policy.killed && <span className="chip chip-sell">Kill switch on</span>}
          {ws.role === "admin" && <span className="chip chip-warn">Admin view, read only</span>}
        </div>
      </div>
      <Link href={`/a/${a.slug}/console`} className="btn btn-secondary h-9 shrink-0 px-3">
        Owner console
      </Link>
    </div>
  );
}

export function Workspace({ slug }: { slug: string }) {
  const q = useWorkspace(slug);
  const mobile = useIsMobile();
  const [tab, setTabState] = useState<TabId>(readTab);
  const setTab = (t: TabId) => {
    setTabState(t);
    const url = new URL(window.location.href);
    if (t === "chat") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  };
  useEffect(() => {
    if (q.data) document.title = `${q.data.agent.name} · Cloud · Claudio`;
  }, [q.data?.agent.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) {
    return (
      <Page className="max-w-6xl">
        <div className="panel sheen h-[70px]" />
        <div className="panel sheen mt-4 h-[420px]" />
      </Page>
    );
  }
  if (!q.data) {
    const code = (q.error as { code?: string } | null)?.code;
    const text =
      code === "not_owner"
        ? { title: "This isn't your agent", hint: "Only its owner can open its workspace. Switch to the owner wallet and sign in again." }
        : code === "not_hosted"
          ? { title: "This agent runs on its own machine", hint: "Only agents hosted by Claudio have a Cloud workspace." }
          : code === "not_found"
            ? { title: "No agent by that name", hint: "Check the link, or pick one of your agents." }
            : { title: "Couldn't open this workspace", hint: errorText(q.error) };
    return (
      <Page className="max-w-3xl">
        <Link href="/cloud" className="mb-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-text-3 hover:text-text">
          <ArrowLeft className="h-3.5 w-3.5" />
          Cloud
        </Link>
        <div className="panel p-6 text-center">
          <h2 className="display-section text-text">{text.title}</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-text-3">{text.hint}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/cloud" className="btn btn-secondary">
              Your agents
            </Link>
            {code === "not_found" && <CreateHostedLink />}
          </div>
        </div>
      </Page>
    );
  }
  const ws = q.data;
  const chat = tab === "chat";
  return (
    <div className="flex h-full flex-col">
      <div className={cn("mx-auto w-full max-w-6xl shrink-0 px-4 pt-3 md:px-8 md:pt-6", chat && mobile ? "pb-2" : "pb-4")}>
        <Link href="/cloud" className="mb-2 inline-flex items-center gap-1 text-[12px] font-semibold text-text-3 hover:text-text">
          <ArrowLeft className="h-3.5 w-3.5" />
          Cloud
        </Link>
        <Header ws={ws} />
        <div className="mt-3 md:mt-4">
          <Tabs tab={tab} setTab={setTab} pending={ws.counts.pendingApprovals} />
        </div>
      </div>
      {chat ? (
        <div className="mx-auto min-h-0 w-full max-w-6xl flex-1 px-3 md:px-8 md:pb-6">
          <ChatTab ws={ws} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-8">
            {tab === "helpers" && <HelpersTab ws={ws} />}
            {tab === "memory" && <MemoryTab ws={ws} />}
            {tab === "files" && <FilesTab ws={ws} />}
            {tab === "skills" && <SkillsTab ws={ws} />}
            {tab === "activity" && <ActivityTab ws={ws} />}
          </div>
        </div>
      )}
    </div>
  );
}
