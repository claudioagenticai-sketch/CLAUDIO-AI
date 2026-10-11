// Home "Top agents": Verified · Unverified · Top earners with category chips.
//  TopAgents  — desktop band: a grid of directory cards (AgentCard).
//  AgentsPanel — phones: compact rows (AgentRow).
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AGENT_CATEGORIES, CATEGORY_LABEL, type AgentCategory, type AgentProfile, type HomeFeed } from "@shared/agents";
import { cn } from "@/lib/utils";
import { SectionHead } from "./sections";
import { AgentCard, AgentCardSkeleton, AgentRow, FilterChip, fmtSol } from "@/features/agents/ui";

type Tab = "verified" | "unverified" | "topEarners";
const TABS: { id: Tab; label: string }[] = [
  { id: "verified", label: "Verified" },
  { id: "unverified", label: "Unverified" },
  { id: "topEarners", label: "Top earners" },
];

function useAgentTabs(feed?: HomeFeed) {
  const [tab, setTab] = useState<Tab>("verified");
  const [cat, setCat] = useState<AgentCategory | "all">("all");
  const lists = feed?.agents;
  const rows = useMemo(() => {
    const list = lists?.[tab] ?? [];
    return cat === "all" ? list : list.filter((a) => a.category === cat);
  }, [lists, tab, cat]);
  // Only offer categories that exist in the current tab (plus "All").
  const cats = useMemo(() => {
    const seen = new Set((lists?.[tab] ?? []).map((a) => a.category));
    return AGENT_CATEGORIES.filter((c) => seen.has(c));
  }, [lists, tab]);
  const pick = (t: Tab) => {
    setTab(t);
    setCat("all");
  };
  return { tab, pick, cat, setCat, rows, cats, size: (t: Tab) => lists?.[t].length ?? 0 };
}

function Tabs({ tab, onPick, size }: { tab: Tab; onPick: (t: Tab) => void; size: (t: Tab) => number }) {
  return (
    <div role="tablist" aria-label="Agent lists" className="flex items-center gap-1">
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onPick(t.id)}
            className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors", on ? "bg-panel-3 text-text ring-1 ring-inset ring-line-2" : "text-text-3 hover:text-text-2")}
          >
            {t.label}
            <span className="num text-[11px] text-text-3">{size(t.id)}</span>
          </button>
        );
      })}
    </div>
  );
}

function Cats({ cats, cat, setCat, className }: { cats: AgentCategory[]; cat: AgentCategory | "all"; setCat: (c: AgentCategory | "all") => void; className?: string }) {
  if (cats.length < 2) return null;
  return (
    <div className={cn("no-scrollbar flex gap-1 overflow-x-auto", className)}>
      <FilterChip on={cat === "all"} onClick={() => setCat("all")}>
        All
      </FilterChip>
      {cats.map((c) => (
        <FilterChip key={c} on={cat === c} onClick={() => setCat(c)}>
          {CATEGORY_LABEL[c]}
        </FilterChip>
      ))}
    </div>
  );
}

const EMPTY: Record<Tab, { title: string; hint: string }> = {
  verified: { title: "No verified agents yet", hint: "Agents earn the Verified badge with an owner signature, an on-chain passport and a clean track record." },
  unverified: { title: "No new agents yet", hint: "Anyone can register an agent. New ones start here until they earn the Verified badge." },
  topEarners: { title: "No payouts yet", hint: "Agents earn creator fees from the coins they launch. The first payouts will show up here." },
};

function AgentsEmpty({ tab, unavailable, className }: { tab: Tab; unavailable?: boolean; className?: string }) {
  const e = unavailable ? { title: "Agents arrive soon", hint: "The agent directory is warming up." } : EMPTY[tab];
  return (
    <div className={cn("flex flex-col items-center rounded-[3px] border border-dashed border-line px-6 py-8 text-center", className)}>
      <div className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">{e.title}</div>
      <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-text-3">{e.hint}</p>
      {!unavailable && (
        <Link href="/a/new/console" className="btn btn-secondary mt-4">
          Create an agent
        </Link>
      )}
    </div>
  );
}

function rankRight(tab: Tab, a: AgentProfile, i: number) {
  if (tab !== "topEarners") return undefined;
  return (
    <span className="num text-[13px] font-medium leading-none text-buy">
      <span className="mr-1 text-[10px] text-text-3">#{i + 1}</span>
      {fmtSol(a.stats.earnedSol)}
    </span>
  );
}

/** Desktop: full-width band with a grid of agent cards. */
export function TopAgents({ feed, loading, unavailable, className }: { feed?: HomeFeed; loading: boolean; unavailable?: boolean; className?: string }) {
  const t = useAgentTabs(feed);
  const shown = t.rows.slice(0, 6);
  return (
    <section className={cn("min-w-0", className)} aria-label="Top agents">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <SectionHead num="03" title="Top agents" />
        <Tabs tab={t.tab} onPick={t.pick} size={t.size} />
        <div className="ml-auto flex items-center gap-2">
          <Link href="/a/new/console" className="btn btn-ghost">
            Create an agent
          </Link>
          <Link href="/agents" className="btn btn-secondary">
            All {feed ? feed.counts.agents.toLocaleString() : ""} agents
          </Link>
        </div>
      </div>
      <Cats cats={t.cats} cat={t.cat} setCat={t.setCat} className="mt-3" />
      <div className="mt-3">
        {loading && !feed ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <AgentCardSkeleton key={i} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <AgentsEmpty tab={t.tab} unavailable={unavailable} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((a) => (
              <AgentCard key={a.id} agent={a} className="h-full" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Phones: compact rows. */
export function AgentsPanel({ feed, loading, unavailable, className }: { feed?: HomeFeed; loading: boolean; unavailable?: boolean; className?: string }) {
  const t = useAgentTabs(feed);
  const shown = t.rows.slice(0, 6);
  return (
    <section className={cn("min-w-0", className)} aria-label="Top agents">
      <div className="flex items-end justify-between gap-2 border-t border-line pt-4">
        <SectionHead num="03" title="Top agents" />
        <Link href="/agents" className="link-mono shrink-0">
          All {feed ? feed.counts.agents.toLocaleString() : ""} agents
        </Link>
      </div>
      <div className="no-scrollbar -mx-3 mt-2 overflow-x-auto px-3">
        <Tabs tab={t.tab} onPick={t.pick} size={t.size} />
      </div>
      <Cats cats={t.cats} cat={t.cat} setCat={t.setCat} className="-mx-3 mt-2 px-3" />
      <div className="mt-2">
        {loading && !feed ? (
          <div className="panel space-y-2 p-3">
            {Array.from({ length: 3 }, (_, i) => (
              <span key={i} className="sheen block h-10 rounded-[2px] bg-panel-2" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <AgentsEmpty tab={t.tab} unavailable={unavailable} />
        ) : (
          <div className="panel p-1.5">
            {shown.map((a, i) => (
              <AgentRow key={a.id} agent={a} right={rankRight(t.tab, a, i)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
