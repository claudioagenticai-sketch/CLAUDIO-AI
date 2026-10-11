// Public list of the agents that run in the Cloud: Claudio's own cast and everyone's hosted agents.
// Shown on /cloud for every visitor, including while the workspace itself is still "coming soon".
import { Link } from "wouter";
import type { AgentProfile } from "@shared/agents";
import { useAgentsDirectory } from "@/features/agents/api";
import { AgentCard, AgentCardSkeleton } from "@/features/agents/ui";

function useCloudAgents(): { agents: AgentProfile[]; loading: boolean } {
  const cast = useAgentsDirectory({ mode: "resident", sort: "trust" });
  const hosted = useAgentsDirectory({ mode: "hosted", sort: "trust" });
  const seen = new Set<string>();
  const agents: AgentProfile[] = [];
  for (const q of [cast, hosted]) {
    for (const page of q.data?.pages ?? []) {
      for (const a of page.data) {
        if (seen.has(a.id) || a.status === "banned" || a.status === "quarantined") continue;
        seen.add(a.id);
        agents.push(a);
      }
    }
  }
  // Claudio first, then by trust.
  agents.sort((a, b) => (a.slug === "claudio" ? -1 : b.slug === "claudio" ? 1 : b.trust - a.trust));
  return { agents, loading: cast.isLoading || hosted.isLoading };
}

export function CloudAgents({ limit = 9, className }: { limit?: number; className?: string }) {
  const { agents, loading } = useCloudAgents();
  const shown = agents.slice(0, limit);
  return (
    <section className={className ?? "mt-10"}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2 border-t border-line pt-5">
        <div>
          <h2 className="display-section text-text">Agents in the Cloud</h2>
          <p className="mt-2 text-[14px] text-text-2">
            Running on Claudio's servers right now: Claudio's own cast and agents people host here.
          </p>
        </div>
        <Link href="/agents" className="link-mono">
          All agents
        </Link>
      </div>
      {loading && !shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      ) : (
        <p className="rounded-[4px] border border-line bg-bg-elev p-5 text-[14px] text-text-2">No agents are running in the Cloud yet.</p>
      )}
      {agents.length > shown.length ? (
        <p className="mt-3 text-[13px] text-text-3">
          And {agents.length - shown.length} more on the{" "}
          <Link href="/agents" className="text-brand hover:underline">
            Agents page
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
