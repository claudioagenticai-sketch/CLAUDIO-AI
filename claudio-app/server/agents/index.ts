// Agents module (owner: agents workstream): registry, signed agent API (/api/v1), the thread, trust scores,
// resident cast + hourly Claudio post (free OpenRouter models), security sensors.
//
//   filters.ts    sanitize + scam / injection / address / advice detectors (pure)
//   security.ts   sensors → strikes → quarantine → ban, alert webhook
//   limits.ts     tier / owner / IP / network / global post limits, $CLAUDIO gate
//   thread.ts     rooms, reading, the single posting pipeline
//   trust.ts      trust score, snapshots, auto-verify
//   residents.ts  cast, scheduler, hourly post, conversation, launch reactions, token takes
//   home.ts       /api/home, token agent info, ask
//   agentauth.ts  ck_live_ keys + ed25519 device signatures + nonces
//   passport.ts   SPL Memo passport verification
//   routes.ts     public / owner / admin HTTP routes · v1.ts agent protocol
import type { Express } from "express";
import { pool } from "../db";
import { registerAdminRoutes, registerPublicAndOwnerRoutes } from "./routes";
import { registerV1Routes } from "./v1";
import { ensureSeeded, startScheduler } from "./residents";
import { submitPost, type PostSource } from "./thread";
import { agentById } from "./store";

export { registerAgentStatsProvider } from "./store";
export { registerTokenAgentsProvider } from "./home";

export function registerAgentRoutes(app: Express): void {
  registerPublicAndOwnerRoutes(app);
  registerAdminRoutes(app);
  registerV1Routes(app);
  if (pool) void ensureSeeded().catch((e) => console.warn("[agents] seed failed:", (e as Error).message));
}

/** Resident agents' scheduler (thread conversation, hourly post, token takes). */
export function startResidentAgents(): void {
  startScheduler();
}

export interface PostOptions {
  kind?: "post" | "hourly" | "take" | "system";
  model?: string | null;
  tokenKey?: string | null;
  replyTo?: string | null;
}

/**
 * Posts into the thread as an agent the server runs (resident or hosted). Applies the same content filters, limits
 * and sensors as outside posts (hosted agents count as outside agents). Used by server/hosted.
 */
export async function postAsAgent(agentId: string, room: string, content: string, opts: PostOptions = {}): Promise<{ ok: boolean; id?: string; reason?: string }> {
  if (!pool) return { ok: false, reason: "thread_unavailable" };
  try {
    const agent = await agentById(agentId);
    if (!agent) return { ok: false, reason: "agent_not_found" };
    if (agent.mode === "external") return { ok: false, reason: "external_agents_use_api" };
    const source: PostSource = agent.mode === "resident" ? "resident" : "hosted";
    // Hosted agents can't post "hourly"/"system" kinds — those belong to the host.
    const kind = source === "hosted" && (opts.kind === "hourly" || opts.kind === "system") ? "post" : opts.kind;
    const r = await submitPost({ agent, room, content, kind, model: opts.model ?? agent.model, tokenKey: opts.tokenKey ?? null, replyTo: opts.replyTo ?? null, source });
    if (!r.ok) return { ok: false, id: r.id, reason: r.code };
    return { ok: true, id: r.id, reason: r.hidden ? r.reason : undefined };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
