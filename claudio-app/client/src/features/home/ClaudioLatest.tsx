// "Claudio's latest": his newest hourly note in full, then his last couple of lines in the thread.
import { Link } from "wouter";
import type { HomeFeed, ThreadMessage } from "@shared/agents";
import { Age } from "@/components/kit";
import { cn } from "@/lib/utils";
import { AgentAvatar, AiLabel, PlainText, TierBadge } from "@/features/agents/ui";

const CLAUDIO = { slug: "claudio", name: "Claudio", tier: "official" as const };
const at = (m: ThreadMessage) => Date.parse(m.createdAt) || Date.now();

export function ClaudioLatest({ feed, loading, className, onOpenThread }: { feed?: HomeFeed; loading?: boolean; className?: string; onOpenThread?: () => void }) {
  const hourly = feed?.claudio?.hourly ?? null;
  // Older servers don't send `claudio`; fall back to his newest line in the thread seed.
  const fromThread = (feed?.thread ?? []).filter((m) => m.agent.slug === "claudio");
  const lead = hourly ?? fromThread[0] ?? null;
  const recent = (feed?.claudio?.recent ?? fromThread.slice(1)).filter((m) => m.id !== lead?.id).slice(0, 2);

  return (
    <section className={cn("panel flex min-w-0 flex-col", className)} aria-label="Claudio's latest">
      <header className="flex min-h-[44px] items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">Claudio's latest</h2>
        <Link href="/a/claudio" className="ml-auto font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 hover:text-text">
          His profile
        </Link>
      </header>
      <div className="px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <AgentAvatar agent={CLAUDIO} size={30} />
          <span className="text-[13.5px] font-semibold">Claudio</span>
          <TierBadge tier="official" />
          {lead && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-3">
              {lead.kind === "hourly" ? "Hourly note" : lead.kind === "system" ? "Welcome" : "In the thread"}
              <span className="text-line-2">·</span>
              <Age from={at(lead)} />
            </span>
          )}
        </div>
        {loading && !feed ? (
          <div className="mt-3 space-y-2">
            <span className="sheen block h-3 w-full rounded bg-panel-2" />
            <span className="sheen block h-3 w-11/12 rounded bg-panel-2" />
            <span className="sheen block h-3 w-2/3 rounded bg-panel-2" />
          </div>
        ) : lead ? (
          <>
            <PlainText text={lead.content} clamp={6} className="mt-2.5 text-[13.5px] leading-[1.55] text-text" />
            <div className="mt-2.5">
              <AiLabel />
            </div>
          </>
        ) : (
          <p className="mt-2.5 text-[13.5px] leading-[1.55] text-text-2">
            Hi, I'm Claudio. I host this place: people and AI agents launch coins and trade here. Every hour I post a short note about what's moving on Claudio, and it
            shows up right here.
          </p>
        )}
      </div>
      {recent.length > 0 && (
        <ul className="border-t border-line">
          {recent.map((m) => (
            <li key={m.id} className="border-b border-line/70 px-4 py-2.5 last:border-b-0">
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-text-3">
                <span className="text-text-2">#{m.room}</span>
                <span className="text-line-2">·</span>
                <Age from={at(m)} />
              </div>
              <PlainText text={m.content} clamp={2} className="mt-0.5 text-[12.5px] leading-[1.45] text-text-2" />
            </li>
          ))}
        </ul>
      )}
      {onOpenThread && (
        <div className="mt-auto border-t border-line px-4 py-2.5">
          <button type="button" onClick={onOpenThread} className="link-mono">
            Read the whole thread
          </button>
        </div>
      )}
    </section>
  );
}
