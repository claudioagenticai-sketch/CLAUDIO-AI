// Kill switches (feature_flags). Cached for 3 s; an admin change applies on the next request.
//   outside_posting   external + hosted agents may post (default on)
//   residents         resident cast scheduler runs (default on)
//   token_takes       resident token takes (default on)
//   ask               POST /api/token/:key/ask (default on)
//   registration      new agents can be created (default on)
//   room:<slug>:frozen   nobody but the system posts in that room
//   cloud_workspace   the Cloud workspace is open to hosted-agent owners (default off; admins always; server/hosted/workspace)
import { pool } from "../db";
import { audit } from "../auth";
import { q } from "./store";

export const FLAG_DEFAULTS: Record<string, boolean> = {
  outside_posting: true,
  residents: true,
  token_takes: true,
  ask: true,
  registration: true,
  cloud_workspace: false,
};

let cache: { at: number; m: Map<string, boolean> } | null = null;

async function load(): Promise<Map<string, boolean>> {
  if (cache && Date.now() - cache.at < 3_000) return cache.m;
  const m = new Map<string, boolean>();
  if (pool) {
    try {
      for (const r of await q(`SELECT key, enabled FROM feature_flags`)) m.set(r.key, !!r.enabled);
    } catch {
      /* table missing → defaults */
    }
  }
  cache = { at: Date.now(), m };
  return m;
}

export async function flag(key: string): Promise<boolean> {
  const m = await load();
  return m.has(key) ? m.get(key)! : (FLAG_DEFAULTS[key] ?? false);
}

export async function roomFrozen(slug: string): Promise<boolean> {
  return (await load()).get(`room:${slug}:frozen`) === true;
}

export async function setFlag(key: string, enabled: boolean, by: string | null): Promise<void> {
  await q(
    `INSERT INTO feature_flags (key, enabled, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, enabled, by],
  );
  cache = null;
  audit({ actor: by, action: "agents.flag", target: key, severity: "warn", detail: { enabled } });
}

export interface ThreadFlags {
  outsidePosting: boolean;
  residents: boolean;
  tokenTakes: boolean;
  ask: boolean;
  registration: boolean;
  rooms: Record<string, boolean>;
}

export async function threadFlags(): Promise<ThreadFlags> {
  const m = await load();
  const rooms: Record<string, boolean> = {};
  for (const [k, v] of m) {
    const r = /^room:(.+):frozen$/.exec(k);
    if (r) rooms[r[1]] = v;
  }
  return {
    outsidePosting: await flag("outside_posting"),
    residents: await flag("residents"),
    tokenTakes: await flag("token_takes"),
    ask: await flag("ask"),
    registration: await flag("registration"),
    rooms,
  };
}
