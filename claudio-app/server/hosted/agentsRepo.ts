// Read-only, defensive access to the `agents` table (owned by the agents workstream). Every query selects only the
// columns this module needs and treats a missing table/column as "no agent" instead of crashing.
import { pool } from "../db";

export interface HostedAgentRow {
  id: string;
  slug: string;
  name: string;
  mode: "resident" | "hosted" | "external" | string;
  ownerWallet: string | null;
  persona: string;
  bio: string;
  model: string | null;
  status: string;
}

let warned = false;

function mapRow(r: any): HostedAgentRow {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name ?? r.slug),
    mode: String(r.mode),
    ownerWallet: r.owner_wallet ?? null,
    persona: String(r.persona ?? ""),
    bio: String(r.bio ?? ""),
    model: r.model ?? null,
    status: String(r.status ?? "active"),
  };
}

async function q(where: string, params: unknown[], limit = 1): Promise<HostedAgentRow[]> {
  if (!pool) return [];
  try {
    const r = await pool.query(
      `SELECT id, slug, name, mode, owner_wallet, persona, bio, model, status FROM agents WHERE ${where} LIMIT ${Math.max(1, Math.min(1000, limit))}`,
      params,
    );
    return r.rows.map(mapRow);
  } catch (e) {
    const msg = (e as Error).message;
    // 42P01 undefined_table / 42703 undefined_column: the agents workstream hasn't migrated yet (or changed shape).
    if (!warned) {
      warned = true;
      console.warn(`[hosted] agents table unavailable: ${msg}`);
    }
    return [];
  }
}

export async function agentById(id: string): Promise<HostedAgentRow | null> {
  if (typeof id !== "string" || !id || id.length > 128) return null;
  return (await q("id = $1", [id]))[0] ?? null;
}

export async function agentBySlug(slug: string): Promise<HostedAgentRow | null> {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) return null;
  return (await q("slug = $1", [slug.toLowerCase()]))[0] ?? null;
}

export async function agentsByIds(ids: string[]): Promise<Map<string, HostedAgentRow>> {
  const out = new Map<string, HostedAgentRow>();
  if (!ids.length) return out;
  for (const a of await q("id = ANY($1::text[])", [ids], ids.length)) out.set(a.id, a);
  return out;
}

/** Agents allowed to own a Claudio-held escrow: hosted agents, and Claudio himself (resident, slug "claudio"). */
export function escrowEligible(a: HostedAgentRow | null): boolean {
  if (!a) return false;
  return a.mode === "hosted" || (a.mode === "resident" && a.slug === "claudio");
}

/** Hosted agents the runner may run: mode hosted + status active. */
export function runnable(a: HostedAgentRow | null): boolean {
  return !!a && a.mode === "hosted" && a.status === "active";
}
