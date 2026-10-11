// /cloud when the Cloud workspace is open for this visitor: Compute (still coming soon) and "Your agents in the Cloud".
import { Link } from "wouter";
import { CloudAgents } from "./CloudAgents";
import { ArrowRight, Plus } from "lucide-react";
import type { CloudAccess, CloudAgentSummary } from "@shared/cloud";
import { Age } from "@/components/kit";
import { Page, PageHeader } from "@/features/wallet/ui";
import { SignInGate } from "@/features/session/SignInButton";
import { errorText } from "@/features/agents/api";
import { AgentAvatar, ModelLabel, PlainText } from "@/features/agents/ui";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useCloudAgents } from "./api";

function ComputeCard() {
  return (
    <section className="panel p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="display-section text-text">Compute</h2>
        <span className="chip chip-brand">Coming soon</span>
      </div>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-2">
        Rent GPU and CPU servers for your agents by the hour, paid in SOL, or list your own machine and earn when an agent runs on it. This part isn't built yet;
        I'll announce it on X and TikTok first.
      </p>
    </section>
  );
}

export function CreateHostedLink({ className, label = "Create a hosted agent" }: { className?: string; label?: string }) {
  return (
    <Link href="/a/new/console" className={cn("btn btn-primary h-11 md:h-10", className)}>
      <Plus className="h-4 w-4" />
      {label}
    </Link>
  );
}

function AgentTile({ a }: { a: CloudAgentSummary }) {
  return (
    <Link href={`/cloud/${a.slug}`} className="panel group flex flex-col gap-3 p-4 transition-colors hover:border-line-2">
      <div className="flex items-center gap-3">
        <AgentAvatar agent={a} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{a.name}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-text-3">
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", a.running ? "bg-buy" : "bg-text-3")} />
            {a.status !== "active" ? a.status : a.running ? "Running" : "Stopped"}
          </div>
          <ModelLabel model={a.model} className="text-[11.5px]" />
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
      </div>
      {a.bio && <PlainText text={a.bio} clamp={2} className="text-[12.5px] leading-relaxed text-text-2" />}
      <div className="mt-auto text-[11.5px] text-text-3">
        {a.chats ? (
          <>
            {a.chats} chat{a.chats === 1 ? "" : "s"}
            {a.lastChatAt && (
              <>
                {" "}· last <Age from={Date.parse(a.lastChatAt)} className="text-text-3" /> ago
              </>
            )}
          </>
        ) : (
          "No chats yet"
        )}
      </div>
    </Link>
  );
}

function YourAgents() {
  const q = useCloudAgents(true);
  if (q.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel sheen h-[132px]" />
        ))}
      </div>
    );
  }
  if (q.error) return <p className="panel p-5 text-[13px] text-text-3">{errorText(q.error)}</p>;
  const list = q.data?.agents ?? [];
  if (!list.length) {
    return (
      <div className="panel flex flex-col items-start gap-3 p-5 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold">You don't have a hosted agent yet</div>
          <p className="mt-1 text-[13px] leading-relaxed text-text-3">Hosted agents run on Claudio. Make one, then come back here to chat with it, give it notes and files, and see what it did.</p>
        </div>
        <CreateHostedLink className="w-full md:w-auto" />
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((a) => (
        <AgentTile key={a.id} a={a} />
      ))}
    </div>
  );
}

export function CloudHome({ access }: { access: CloudAccess }) {
  const s = useSession();
  return (
    <Page className="max-w-5xl">
      <PageHeader title="The Cloud" subtitle="Where your agents live: their own chat, memory, files and helpers, working while you're away." />
      {access.admin && !access.flag && (
        <p className="mb-4 rounded-[3px] border border-line border-l-2 border-l-warn bg-bg-elev px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warn">
          Only admins can see this. The Cloud workspace is switched off for everyone else (Admin › Hosted).
        </p>
      )}
      <ComputeCard />
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="display-section text-text">Your agents in the Cloud</h2>
            <p className="mt-2 text-[13px] text-text-3">Pick an agent to open its workspace.</p>
          </div>
          {s.data?.wallet && <CreateHostedLink label="New hosted agent" className="h-10" />}
        </div>
        <SignInGate title="Sign in to see your agents" hint="Your wallet is your account. Sign a short message to prove it's you — no fee, no transaction.">
          <YourAgents />
        </SignInGate>
      </section>
      <CloudAgents />
    </Page>
  );
}
