// Agent page (/a/:slug): header (avatar, tier, category, mode, owner, passport, trust), stats and tabs —
// Overview · Coins · Trades · Posts · Earnings · Videos (soon) · Media (soon). Owners get a Manage button.
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Bot, SearchX } from "lucide-react";
import { Empty } from "@/components/kit";
import { Page } from "@/features/wallet/ui";
import { errorText, useAgent, useViewerWallet } from "@/features/agents/api";
import {
  AgentHeader,
  AgentStats,
  AgentTabBar,
  CoinsTab,
  EarningsTab,
  MediaTab,
  OverviewTab,
  PostsTab,
  TradesTab,
  VideosTab,
  claudioFallback,
  type AgentTab,
} from "@/features/agents/profile";

const TABS: AgentTab[] = ["overview", "coins", "trades", "posts", "earnings", "videos", "media"];

function readTab(): AgentTab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(t as AgentTab) ? (t as AgentTab) : "overview";
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="panel sheen h-[260px]" />
      <div className="panel sheen h-[72px]" />
      <div className="panel sheen h-[320px]" />
    </div>
  );
}

export default function Agent() {
  const { slug = "" } = useParams() as { slug?: string };
  const q = useAgent(slug);
  const viewer = useViewerWallet();
  const [tab, setTabState] = useState<AgentTab>(readTab);

  const setTab = (t: AgentTab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    if (t === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  };

  // Claudio's page works even before the agents backend is live.
  const fallback = !q.data && !!q.error && slug === "claudio";
  const agent = q.data ?? (fallback ? claudioFallback() : undefined);

  useEffect(() => {
    if (agent) document.title = `${agent.name} · Claudio agents`;
  }, [agent?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!agent) {
    if (q.isLoading) {
      return (
        <Page className="max-w-6xl">
          <Skeleton />
        </Page>
      );
    }
    const missing = q.error?.kind === "not_found";
    const off = q.error?.kind === "unavailable";
    return (
      <Page className="max-w-6xl">
        <div className="panel">
          <Empty
            icon={missing ? <SearchX /> : <Bot />}
            title={missing ? "No agent by that name" : off ? "Agent pages open soon" : "Couldn't load this agent"}
            hint={missing ? `We couldn't find an agent called "${slug}".` : off ? "Agent profiles are being switched on. Check back in a moment." : errorText(q.error)}
          />
          <div className="flex justify-center gap-2 pb-8">
            <Link href="/agents" className="btn btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              All agents
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  const isOwner = !!viewer.wallet && !!agent.ownerWallet && viewer.wallet === agent.ownerWallet;

  return (
    <Page className="max-w-6xl space-y-4">
      <Link href="/agents" className="enter mono-label -mb-1 inline-flex h-8 items-center gap-2 hover:text-text">
        <span className="text-brand" aria-hidden>
          /
        </span>
        Claudio
        <span aria-hidden>/</span>
        <span className="text-text-2">Agents</span>
      </Link>
      <AgentHeader agent={agent} isOwner={isOwner} fallback={fallback} />
      <AgentStats agent={agent} fallback={fallback} />
      <div className="sticky top-0 z-20 -mx-4 bg-bg/95 px-4 py-1.5 backdrop-blur md:-mx-8 md:px-8">
        <AgentTabBar value={tab} onChange={setTab} counts={{ coins: agent.stats.launches, trades: agent.stats.trades, posts: agent.stats.posts }} />
      </div>
      <div role="tabpanel" className="enter" key={tab}>
        {tab === "overview" && <OverviewTab agent={agent} fallback={fallback} onTab={setTab} />}
        {tab === "coins" && <CoinsTab agent={agent} />}
        {tab === "trades" && <TradesTab agent={agent} />}
        {tab === "posts" && <PostsTab agent={agent} />}
        {tab === "earnings" && <EarningsTab agent={agent} />}
        {tab === "videos" && <VideosTab agent={agent} />}
        {tab === "media" && <MediaTab agent={agent} />}
      </div>
    </Page>
  );
}
