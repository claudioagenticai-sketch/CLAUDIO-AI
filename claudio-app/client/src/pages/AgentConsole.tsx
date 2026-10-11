// Owner console (/a/:slug/console) and the create flow (/a/new/console). Wallet sign-in gate first.
// Hosted agents: run, approvals, guard rails, logs, Claudio-held wallet, passport, profile.
// External agents: API + device keys, request-signing snippet, wallet, passport, profile.
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowUpRight, Bot, ExternalLink, ShieldOff } from "lucide-react";
import { CHAINS } from "@shared/chains";
import type { AgentPolicy, AgentProfile } from "@shared/agents";
import { CopyAddress, Empty } from "@/components/kit";
import { Card, Page, PageHeader } from "@/features/wallet/ui";
import { SignInGate } from "@/features/session/SignInButton";
import { errorText, useAgent, useMyAgents, useViewerWallet } from "@/features/agents/api";
import { AgentAvatar, CategoryChip, ModeChip, TierBadge } from "@/features/agents/ui";
import { CreateAgentForm } from "@/features/agents/console/CreateAgent";
import { KeysCard, SnippetCard } from "@/features/agents/console/ExternalKeys";
import { ApprovalsCard, LogsCard, PolicyCard, RunCard, WalletCard } from "@/features/agents/console/Hosted";
import { PassportCard } from "@/features/agents/console/Passport";
import { ProfileCard } from "@/features/agents/console/ProfileCard";
import { SocialsCard } from "@/features/agents/console/SocialsCard";

function CreatePage({ wallet }: { wallet: string | null }) {
  const mine = useMyAgents(!!wallet);
  return (
    <Page className="max-w-3xl">
      <Link href="/agents" className="mono-label mb-3 inline-flex h-8 items-center gap-1.5 hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" />
        Agents
      </Link>
      <PageHeader title="Create your agent" subtitle="Give it a name and a job. You can change everything later." />
      <SignInGate wallet={wallet} title="Sign in to create an agent" hint="Your wallet becomes the agent's owner. Sign a short message to prove it's you — no fee, no transaction.">
        {mine.data && mine.data.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
            <span className="eyebrow mr-1">Manage</span>
            {mine.data.map((a) => (
              <Link key={a.id} href={`/a/${a.slug}/console`} className="inline-flex h-9 items-center gap-1.5 rounded-[3px] pl-1 pr-3 text-[12.5px] font-medium ring-1 ring-inset ring-line-2 hover:bg-panel">
                <AgentAvatar agent={a} size={24} />
                {a.name}
              </Link>
            ))}
          </div>
        )}
        <section className="panel p-4 md:p-6">
          <CreateAgentForm />
        </section>
      </SignInGate>
    </Page>
  );
}

function ConsoleHeader({ agent }: { agent: AgentProfile }) {
  return (
    <div className="enter mb-5 flex flex-wrap items-center gap-3 border-b border-line pb-5">
      <AgentAvatar agent={agent} size={52} />
      <div className="min-w-0 flex-1">
        <div className="mono-label">Owner console</div>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <h1 className="display truncate text-[36px] text-text md:text-[48px]">{agent.name}</h1>
          <TierBadge tier={agent.tier} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-text-3">
          <CategoryChip category={agent.category} className="text-[12.5px]" />
          <span className="text-line-2">·</span>
          <ModeChip mode={agent.mode} className="text-[12.5px]" />
        </div>
      </div>
      <Link href={`/a/${agent.slug}`} className="btn btn-secondary">
        View page
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function OwnWalletCard({ agent }: { agent: AgentProfile }) {
  return (
    <Card title="Agent wallet" right={<span className="chip">Its own</span>}>
      {agent.wallet ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <CopyAddress address={agent.wallet} head={6} tail={6} className="text-[12px]" />
            <a href={CHAINS.sol.explorerAddress(agent.wallet)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-2 hover:text-text">
              Solscan <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="text-[11.5px] leading-relaxed text-text-3">Your agent signs its own transactions with this wallet. Creator fees from coins it launches go here.</p>
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-text-3">Your agent reports its wallet the first time it connects with its API key.</p>
      )}
    </Card>
  );
}

function Welcome({ agent }: { agent: AgentProfile }) {
  const [show, setShow] = useState(() => new URLSearchParams(window.location.search).get("welcome") === "1");
  if (!show) return null;
  return (
    <div className="enter mb-4 flex items-start gap-3 rounded-[3px] border border-line border-l-2 border-l-brand bg-bg-elev p-4">
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-text-2">
        <b className="text-text">{agent.name} is here.</b>{" "}
        {agent.mode === "hosted"
          ? "It starts stopped and in paper mode. Check its guard rails, then press Start."
          : "Next: make an API key below and run the snippet on your machine."}{" "}
        Register a passport to work towards the Verified badge.
      </div>
      <button type="button" onClick={() => setShow(false)} className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 hover:text-text">
        Got it
      </button>
    </div>
  );
}

function OwnerConsole({ agent }: { agent: AgentProfile }) {

  return (
    <>
      <ConsoleHeader agent={agent} />
      <Welcome agent={agent} />
      {agent.mode === "hosted" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            <RunCard agent={agent} />
            <ApprovalsCard slug={agent.slug} />
            <PolicyCard slug={agent.slug} />
            <LogsCard slug={agent.slug} />
          </div>
          <div className="min-w-0 space-y-4">
            <WalletCard slug={agent.slug} />
            <PassportCard agent={agent} />
            <ProfileCard agent={agent} />
            <SocialsCard agent={agent} />
          </div>
        </div>
      ) : agent.mode === "external" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            <KeysCard slug={agent.slug} />
            <SnippetCard slug={agent.slug} />
          </div>
          <div className="min-w-0 space-y-4">
            <OwnWalletCard agent={agent} />
            <PassportCard agent={agent} />
            <ProfileCard agent={agent} />
            <SocialsCard agent={agent} />
          </div>
        </div>
      ) : (
        <div className="panel">
          <Empty icon={<Bot />} title="Claudio runs this one" hint="Agents from Claudio's own cast are managed from the admin panel." />
        </div>
      )}
    </>
  );
}

function ExistingConsole({ slug, wallet }: { slug: string; wallet: string | null }) {
  const q = useAgent(slug);
  const agent = q.data;
  useEffect(() => {
    if (agent) document.title = `Manage ${agent.name} · Claudio`;
  }, [agent?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page className="max-w-6xl">
      <Link href={agent ? `/a/${agent.slug}` : "/agents"} className="mono-label mb-3 inline-flex h-8 items-center gap-1.5 hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" />
        {agent ? agent.name : "Agents"}
      </Link>
      <SignInGate wallet={wallet} title="Sign in to manage this agent" hint="Only the agent's owner wallet can open its console.">
        {q.isLoading ? (
          <div className="space-y-4">
            <div className="panel sheen h-[90px]" />
            <div className="panel sheen h-[320px]" />
          </div>
        ) : !agent ? (
          <div className="panel">
            <Empty
              icon={<Bot />}
              title={q.error?.kind === "not_found" ? "No agent by that name" : q.error?.kind === "unavailable" ? "Agent consoles open soon" : "Couldn't load this agent"}
              hint={q.error?.kind === "unavailable" ? "You'll be able to create and run agents here in a moment." : errorText(q.error)}
            />
          </div>
        ) : agent.ownerWallet !== wallet ? (
          <div className="panel">
            <Empty icon={<ShieldOff />} title="This isn't your agent" hint="Only its owner can open the console. Switch to the owner wallet and sign in again." />
            <div className="flex justify-center pb-8">
              <Link href={`/a/${agent.slug}`} className="btn btn-secondary">
                View {agent.name}
              </Link>
            </div>
          </div>
        ) : (
          <OwnerConsole agent={agent} />
        )}
      </SignInGate>
    </Page>
  );
}

export default function AgentConsole() {
  const { slug = "" } = useParams() as { slug?: string };
  const viewer = useViewerWallet();
  useEffect(() => {
    if (slug === "new") document.title = "Create your agent · Claudio";
  }, [slug]);
  if (viewer.loading) {
    return (
      <Page className="max-w-3xl">
        <div className="panel sheen mx-auto h-[280px] max-w-md" />
      </Page>
    );
  }
  if (slug === "new") return <CreatePage wallet={viewer.wallet} />;
  return <ExistingConsole slug={slug} wallet={viewer.wallet} />;
}
