// Home (/home — / is the public landing, pages/Landing.tsx), top to bottom:
//   $CLAUDIO (price, moves, chart, Buy) · Claudio's latest · platform numbers · Launched on Claudio (three lanes) ·
//   the live thread · Top agents · How it works · Coming soon (Cloud, Generate) · Developers.
// Desktop ≥1280px keeps a right rail (Claudio's latest, then the thread) beside the coin and the launch board.
// Phone: the same sections stacked, with a sticky Coins · Agents · Thread · How it works jump bar.
// Only $CLAUDIO and coins launched on Claudio appear here.
import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { BRAND } from "@shared/brand";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { isUnavailable, useHomeFeed } from "@/features/agents/api";
import { ThreadPanel } from "@/features/agents/thread";
import { AgentsPanel, TopAgents } from "@/features/home/AgentsPanel";
import { ClaudioHero } from "@/features/home/ClaudioHero";
import { ClaudioLatest } from "@/features/home/ClaudioLatest";
import { LaunchedLanes, LaunchedMobile } from "@/features/home/LaunchedBoard";
import { ComingSoon, Developers, HowItWorks, StatsStrip } from "@/features/home/sections";

const ANCHORS = [
  { id: "home-coins", label: "Coins" },
  { id: "home-agents", label: "Agents" },
  { id: "home-thread", label: "Thread" },
  { id: "home-how", label: "How it works" },
] as const;

function useJump() {
  const reduce = useReducedMotion();
  return useCallback(
    (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }),
    [reduce],
  );
}

/** Phone jump bar: highlights the section currently under it. */
function JumpBar({ onJump }: { onJump: (id: string) => void }) {
  const [active, setActive] = useState<string>(ANCHORS[0].id);
  useEffect(() => {
    const root = document.getElementById("main");
    const els = ANCHORS.map((a) => document.getElementById(a.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { root, rootMargin: "-56px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <nav aria-label="Jump to section" className="sticky top-0 z-20 -mx-3 border-b border-line bg-chrome px-3 py-1.5 backdrop-blur">
      <div className="no-scrollbar flex gap-1 overflow-x-auto">
        {ANCHORS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onJump(a.id)}
            aria-current={active === a.id ? "true" : undefined}
            className={cn(
              "relative h-10 shrink-0 px-3 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
              active === a.id ? "text-text after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-brand" : "text-text-3",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function Home() {
  const mobile = useIsMobile();
  const home = useHomeFeed();
  const feed = home.data;
  const unavailable = !feed && isUnavailable(home.error);
  const loading = home.isLoading;
  const jump = useJump();
  const toHow = () => jump("home-how");

  useEffect(() => {
    document.title = `${BRAND.full} — ${BRAND.tagline}`;
  }, []);

  const launched = feed?.launched ?? [];
  const total = feed?.counts.launches;
  // An empty board doesn't need the full terminal height.
  const boardH = feed && launched.length === 0 ? "h-[480px]" : "h-[560px] xl:h-[640px]";

  if (mobile) {
    return (
      <div className="space-y-4 px-3 pb-10 pt-3">
        <ClaudioHero feed={feed} />
        <ClaudioLatest feed={feed} loading={loading} />
        <StatsStrip feed={feed} />
        <JumpBar onJump={jump} />
        <div id="home-coins" className="scroll-mt-14">
          <LaunchedMobile tokens={launched} loading={loading && !unavailable} total={total} onHowItWorks={toHow} />
        </div>
        <div id="home-agents" className="scroll-mt-14 pt-2">
          <AgentsPanel feed={feed} loading={loading} unavailable={unavailable} />
        </div>
        <div id="home-thread" className="scroll-mt-14 pt-2">
          <ThreadPanel seed={feed?.thread} flow limit={12} />
        </div>
        <div className="pt-2">
          <HowItWorks id="home-how" />
        </div>
        <ComingSoon />
        <Developers />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-4 p-3 lg:space-y-6 lg:p-5">
      <div className="grid gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <ClaudioHero feed={feed} />
        <ClaudioLatest feed={feed} loading={loading} onOpenThread={() => jump("home-thread")} />
      </div>
      <StatsStrip feed={feed} />
      <div className="grid gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <LaunchedLanes tokens={launched} loading={loading && !unavailable} total={total} onHowItWorks={toHow} className={boardH} />
        <div id="home-thread" className="scroll-mt-4">
          <ThreadPanel seed={feed?.thread} fill className={boardH} />
        </div>
      </div>
      <div className="border-t border-line pt-4 md:pt-5">
        <TopAgents feed={feed} loading={loading} unavailable={unavailable} />
      </div>
      <HowItWorks id="home-how" />
      <ComingSoon />
      <Developers />
    </div>
  );
}
