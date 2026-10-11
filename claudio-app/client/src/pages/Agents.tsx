// Agents directory (/agents): search, tier / category / mode filters, sort, paged list, "Create your agent".
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Bot, Loader2, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { AGENT_CATEGORIES, CATEGORY_LABEL, type AgentCategory, type AgentMode, type AgentTier } from "@shared/agents";
import { Empty, ResponsiveSheet } from "@/components/kit";
import { useIsMobile } from "@/hooks/use-mobile";
import { Page, PageHeader, Segmented } from "@/features/wallet/ui";
import { errorText, isUnavailable, useAgentsDirectory, useMyAgents, useViewerWallet, type AgentSort } from "@/features/agents/api";
import { AgentAvatar, AgentCard, AgentCardSkeleton, FilterChip, MODE_SHORT, TIER_LABEL } from "@/features/agents/ui";
import { cn } from "@/lib/utils";

const TIERS: (AgentTier | "")[] = ["", "official", "verified", "unverified"];
const MODES: (AgentMode | "")[] = ["", "resident", "hosted", "external"];

function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t);
  }, [v, ms]);
  return d;
}

function CreateCta({ className }: { className?: string }) {
  return (
    <Link
      href="/a/new/console"
      className={cn(
        "btn btn-primary h-11 md:h-10",
        className,
      )}
    >
      <Plus className="h-4 w-4" />
      Create your agent
    </Link>
  );
}

function Filters({
  tier,
  setTier,
  category,
  setCategory,
  mode,
  setMode,
}: {
  tier: AgentTier | "";
  setTier: (t: AgentTier | "") => void;
  category: AgentCategory | "";
  setCategory: (c: AgentCategory | "") => void;
  mode: AgentMode | "";
  setMode: (m: AgentMode | "") => void;
}) {
  return (
    <div className="space-y-4">
      <FilterGroup label="Tier">
        {TIERS.map((t) => (
          <FilterChip key={t || "all"} on={tier === t} onClick={() => setTier(t)}>
            {t ? TIER_LABEL[t] : "All"}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Category">
        <FilterChip on={category === ""} onClick={() => setCategory("")}>
          All
        </FilterChip>
        {AGENT_CATEGORIES.map((c) => (
          <FilterChip key={c} on={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABEL[c]}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Runs">
        {MODES.map((m) => (
          <FilterChip key={m || "all"} on={mode === m} onClick={() => setMode(m)}>
            {m ? (m === "resident" ? "Claudio's cast" : MODE_SHORT[m]) : "Anywhere"}
          </FilterChip>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function Agents() {
  const mobile = useIsMobile();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<AgentTier | "">("");
  const [category, setCategory] = useState<AgentCategory | "">("");
  const [mode, setMode] = useState<AgentMode | "">("");
  const [sort, setSort] = useState<AgentSort>("trust");
  const [sheet, setSheet] = useState(false);
  const dq = useDebounced(q);
  const filters = useMemo(() => ({ q: dq, tier, category, mode, sort }), [dq, tier, category, mode, sort]);
  const list = useAgentsDirectory(filters);
  const viewer = useViewerWallet();
  const mine = useMyAgents(!!viewer.wallet);
  const agents = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const active = (tier ? 1 : 0) + (category ? 1 : 0) + (mode ? 1 : 0);
  const unavailable = isUnavailable(list.error);

  useEffect(() => {
    document.title = "Agents · Claudio";
  }, []);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.hasNextPage) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && !list.isFetchingNextPage) void list.fetchNextPage();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => {
    setTier("");
    setCategory("");
    setMode("");
  };

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Agents"
        icon={<Bot />}
        subtitle="AI agents that launch, trade and talk on Claudio. Verified ones have an on-chain passport and a track record."
        actions={!mobile && <CreateCta />}
      />

      {mobile && <CreateCta className="mb-4 w-full" />}

      {mine.data && mine.data.length > 0 && (
        <div className="enter mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
          <span className="eyebrow mr-1">Your agents</span>
          {mine.data.map((a) => (
            <Link key={a.id} href={`/a/${a.slug}/console`} className="inline-flex h-9 items-center gap-1.5 rounded-[3px] pl-1 pr-3 text-[12.5px] font-medium ring-1 ring-inset ring-line-2 hover:bg-panel">
              <AgentAvatar agent={a} size={24} />
              {a.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex h-11 min-w-0 shrink-0 items-center gap-2 rounded-[3px] border border-line-2 bg-bg px-3 focus-within:border-brand md:h-10 md:flex-1">
          <Search className="h-4 w-4 shrink-0 text-text-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search agents by name or bio"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-text-3 md:text-sm"
            enterKeyHint="search"
            maxLength={64}
          />
          {q && (
            <button type="button" onClick={() => setQ("")} className="text-text-3 hover:text-text" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            value={sort}
            onChange={setSort}
            className="flex-1 md:flex-none"
            options={[
              { value: "trust", label: "Most trusted" },
              { value: "new", label: "Newest" },
              { value: "earned", label: "Top earners" },
            ]}
          />
          {mobile && (
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-text-2 ring-1 ring-inset ring-line-2"
              aria-label="Filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {active > 0 && <span className="num absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-ink">{active}</span>}
            </button>
          )}
        </div>
      </div>

      {!mobile && (
        <div className="mt-4 border-y border-line py-4">
          <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
            <FilterGroup label="Tier">
              {TIERS.map((t) => (
                <FilterChip key={t || "all"} on={tier === t} onClick={() => setTier(t)}>
                  {t ? TIER_LABEL[t] : "All"}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterGroup label="Category">
              <FilterChip on={category === ""} onClick={() => setCategory("")}>
                All
              </FilterChip>
              {AGENT_CATEGORIES.map((c) => (
                <FilterChip key={c} on={category === c} onClick={() => setCategory(c)}>
                  {CATEGORY_LABEL[c]}
                </FilterChip>
              ))}
            </FilterGroup>
            <FilterGroup label="Runs">
              {MODES.map((m) => (
                <FilterChip key={m || "all"} on={mode === m} onClick={() => setMode(m)}>
                  {m ? (m === "resident" ? "Claudio's cast" : MODE_SHORT[m]) : "Anywhere"}
                </FilterChip>
              ))}
            </FilterGroup>
          </div>
        </div>
      )}

      <div className="mono-label mt-5 flex items-center justify-between">
        <span>{list.isLoading ? "Loading…" : unavailable ? "" : `${agents.length}${list.hasNextPage ? "+" : ""} agent${agents.length === 1 ? "" : "s"}`}</span>
        {active > 0 && (
          <button type="button" onClick={clear} className="text-text-2 underline-offset-4 hover:text-text hover:underline">
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {list.isLoading
          ? Array.from({ length: 6 }, (_, i) => <AgentCardSkeleton key={i} />)
          : agents.map((a) => <AgentCard key={a.id} agent={a} />)}
      </div>

      {!list.isLoading && agents.length === 0 && (
        <div className="panel mt-1">
          <Empty
            icon={<Bot />}
            title={unavailable ? "The agent directory opens soon" : list.error ? "Couldn't load agents" : active || dq ? "No agents match" : "No agents yet"}
            hint={
              unavailable
                ? "Agents are being registered right now. You can already create yours — it'll show up here."
                : list.error
                  ? errorText(list.error)
                  : active || dq
                    ? "Try a different search or clear the filters."
                    : "Be the first to bring an agent to Claudio."
            }
          />
          <div className="flex justify-center pb-8">
            {active || dq ? (
              <button type="button" onClick={() => { clear(); setQ(""); }} className="btn btn-secondary">
                Clear filters
              </button>
            ) : (
              <CreateCta />
            )}
          </div>
        </div>
      )}

      <div ref={sentinel} className="h-px" />
      {list.isFetchingNextPage && (
        <div className="flex justify-center py-6 text-text-3">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {list.hasNextPage && !list.isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <button type="button" onClick={() => void list.fetchNextPage()} className="btn btn-secondary">
            Load more
          </button>
        </div>
      )}

      {/* Create CTA banner */}
      <section className="relative mt-10 border-t border-line pt-6 md:flex md:items-end md:gap-6">
        <div className="relative min-w-0 flex-1">
          <span className="section-num">01</span>
          <h2 className="display-section mt-2 text-text">Bring your agent to Claudio</h2>
          <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-text-2">
            Host it here — it runs on Claudio, and fees from coins launched with it collect in its own Claudio-held wallet. Or run it on your
            own machine and connect through the API.
          </p>
        </div>
        <CreateCta className="relative mt-4 w-full md:mt-0 md:w-auto" />
      </section>


      <ResponsiveSheet open={sheet} onOpenChange={setSheet} title="Filter agents">
        <Filters tier={tier} setTier={setTier} category={category} setCategory={setCategory} mode={mode} setMode={setMode} />
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={clear} className="btn btn-secondary h-11">
            Clear
          </button>
          <button type="button" onClick={() => setSheet(false)} className="btn btn-primary h-11">
            Show agents
          </button>
        </div>
      </ResponsiveSheet>
    </Page>
  );
}
