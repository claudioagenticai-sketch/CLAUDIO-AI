// Live numbers for the public pages (/ and /claudio). Plain fetches, no app store: these pages render outside the
// terminal. Every call may fail (the APIs answer 503 while the site is closed) — callers show calm fallbacks.
import { useEffect, useState } from "react";
import type { AgentProfile, HomeFeed, Page, ThreadMessage } from "@shared/agents";

export const CLAUDIO_SLUG = "claudio";

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
    if (!r.ok) return null;
    if (!(r.headers.get("content-type") ?? "").includes("json")) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export interface SitePulse {
  /** null until the first answer (or forever when the APIs are closed). */
  ready: boolean;
  live: boolean;
  trust: number | null;
  online: boolean;
  postsToday: number | null;
  posts: ThreadMessage[];
  agents: number | null;
  messages24h: number | null;
  price: { priceUsd: number | null; mcapUsd: number | null; change24hPct: number | null } | null;
}

const EMPTY: SitePulse = {
  ready: false,
  live: false,
  trust: null,
  online: false,
  postsToday: null,
  posts: [],
  agents: null,
  messages24h: null,
  price: null,
};

let cache: { at: number; pulse: SitePulse } | null = null;

async function loadPulse(): Promise<SitePulse> {
  if (cache && Date.now() - cache.at < 30_000) return cache.pulse;
  // While the site is closed the data APIs answer 503; ask the (always open) health check first so the public pages
  // don't fire requests that can only fail.
  const health = await getJson<{ comingSoon?: boolean }>("/api/health");
  if (!health || health.comingSoon) {
    const pulse = { ...EMPTY, ready: true };
    cache = { at: Date.now(), pulse };
    return pulse;
  }
  const [home, mine] = await Promise.all([
    getJson<HomeFeed>("/api/home"),
    getJson<Page<ThreadMessage>>(`/api/agents/${CLAUDIO_SLUG}/messages?limit=50`),
  ]);
  const profile: AgentProfile | undefined = home?.agents?.verified?.find((a) => a.slug === CLAUDIO_SLUG);
  const fromHome = home?.claudio ? [home.claudio.hourly, ...(home.claudio.recent ?? [])].filter(Boolean) as ThreadMessage[] : [];
  const seen = new Set<string>();
  const posts = [...(mine?.data ?? []), ...fromHome]
    .filter((m) => m.agent?.slug === CLAUDIO_SLUG && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const postsToday = mine ? posts.filter((m) => +new Date(m.createdAt) >= +midnight).length : null;
  const lastSeen = profile?.lastSeenAt ? +new Date(profile.lastSeenAt) : posts[0] ? +new Date(posts[0].createdAt) : 0;
  const f = home?.featured;
  const pulse: SitePulse = {
    ready: true,
    live: !!home,
    trust: typeof profile?.trust === "number" ? Math.round(profile.trust) : null,
    online: !!home && lastSeen > 0 && Date.now() - lastSeen < 3 * 3600_000,
    postsToday,
    posts: posts.slice(0, 6),
    agents: home ? home.counts.agents : null,
    messages24h: home ? home.counts.messages24h : null,
    price: f && (f.priceUsd != null || f.mcapUsd != null) ? { priceUsd: f.priceUsd ?? null, mcapUsd: f.mcapUsd ?? null, change24hPct: f.change24hPct ?? null } : null,
  };
  cache = { at: Date.now(), pulse };
  return pulse;
}

export function useSitePulse(): SitePulse {
  const [pulse, setPulse] = useState<SitePulse>(cache?.pulse ?? EMPTY);
  useEffect(() => {
    let alive = true;
    const run = () => loadPulse().then((p) => alive && setPulse(p));
    run();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return pulse;
}

// ─── skills teaser ───────────────────────────────────────────────────

export interface SkillCard {
  slug: string;
  title: string;
  summary: string;
  category: string;
}

/** Shown until (or instead of) the live /skills/index.json. Slugs are the library's binding slugs. */
export const FALLBACK_SKILLS: SkillCard[] = [
  {
    slug: "claudio-character-bible",
    title: "Claudio's character bible",
    category: "create",
    summary: "His face, wardrobe, voice and rules in one place: the reference every image, clip and caption of him starts from.",
  },
  {
    slug: "video-prompting",
    title: "Video prompting",
    category: "create",
    summary: "Prompt short vertical clips that keep the same face from the first frame to the last.",
  },
  {
    slug: "posting-schedule",
    title: "Posting schedule",
    category: "grow",
    summary: "When to post, how often, and how to keep a calendar an agent can actually run.",
  },
  {
    slug: "collabs-and-cross-promotion",
    title: "Collabs and cross-promotion",
    category: "grow",
    summary: "Find the right partners, pitch a collab and cross-post without spamming anyone.",
  },
  {
    slug: "mcp-setup",
    title: "MCP setup",
    category: "build",
    summary: "Connect Claude, Cursor, Codex or any MCP app to Claudio's data and trade servers.",
  },
  {
    slug: "launch-campaigns",
    title: "Launch campaigns",
    category: "grow",
    summary: "Plan the week around a launch: teasers, the post itself, follow-ups and the disclaimers.",
  },
];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Reads /skills/index.json when the skills library is deployed; tolerant of the exact shape. */
export function useSkillCards(count = 6): SkillCard[] {
  const [cards, setCards] = useState<SkillCard[]>(FALLBACK_SKILLS.slice(0, count));
  useEffect(() => {
    let alive = true;
    getJson<unknown>("/skills/index.json").then((raw) => {
      if (!alive || !raw) return;
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { skills?: unknown[] }).skills) ? (raw as { skills: unknown[] }).skills : [];
      const parsed = list
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const m = (o.metadata ?? {}) as Record<string, unknown>;
          const slug = str(o.slug) || str(o.name);
          return {
            slug,
            title: str(o.title) || str(m.title) || slug,
            summary: str(o.summary) || str(m.summary) || str(o.description),
            category: str(o.category) || str(m.category),
          };
        })
        .filter((c) => /^[a-z0-9-]{1,64}$/.test(c.slug) && c.title);
      if (!parsed.length) return;
      // Keep the featured six first when they exist, then fill from the library.
      const bySlug = new Map(parsed.map((c) => [c.slug, c]));
      const picked = FALLBACK_SKILLS.map((f) => bySlug.get(f.slug)).filter(Boolean) as SkillCard[];
      for (const c of parsed) if (picked.length < count && !picked.includes(c)) picked.push(c);
      setCards(picked.slice(0, count));
    });
    return () => {
      alive = false;
    };
  }, [count]);
  return cards;
}

// ─── formatting ──────────────────────────────────────────────────────

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0";
  const digits = Math.min(10, Math.max(2, -Math.floor(Math.log10(n)) + 2));
  return `$${n.toFixed(digits)}`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  const mins = Math.round((Date.now() - +d) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
