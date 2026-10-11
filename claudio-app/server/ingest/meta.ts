// Token metadata JSON fetcher: rewrites ipfs:// and slow/dead public gateways to a fast gateway,
// 3s timeout, LRU cache (including negative results), global concurrency limit.
//
// Gateways (tested 2026-09-27): ipfs.io / dweb.link now return 429 "service worker only";
// gateway.pinata.cloud works but ~3.6s; ipfs.filebase.io ~0.6s for arbitrary CIDs.
// Dedicated gateways (e.g. flap.mypinata.cloud) are fast but only serve their own pins → used as `preferred`.

import type { Socials } from "@shared/types";

export const DEFAULT_GATEWAY = (process.env.IPFS_GATEWAY || "https://ipfs.filebase.io/ipfs/").replace(/\/?$/, "/");

const SLOW_GATEWAYS = [
  /^https?:\/\/ipfs\.io\/ipfs\//i,
  /^https?:\/\/dweb\.link\/ipfs\//i,
  /^https?:\/\/cloudflare-ipfs\.com\/ipfs\//i,
  /^https?:\/\/cf-ipfs\.com\/ipfs\//i,
  /^https?:\/\/gateway\.pinata\.cloud\/ipfs\//i,
  /^https?:\/\/nftstorage\.link\/ipfs\//i,
];

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})(\/.*)?$/;

/** Resolve an ipfs://, bare CID or slow-gateway URL to a fetchable https URL. */
export function resolveUri(uri: string | undefined, gateway = DEFAULT_GATEWAY): string | undefined {
  if (!uri) return undefined;
  const u = uri.trim();
  if (!u) return undefined;
  const gw = gateway.replace(/\/?$/, "/");
  if (u.startsWith("ipfs://")) return gw + u.slice(7).replace(/^ipfs\//, "");
  if (CID_RE.test(u)) return gw + u;
  for (const re of SLOW_GATEWAYS) if (re.test(u)) return gw + u.replace(re, "");
  if (u.startsWith("ar://")) return `https://arweave.net/${u.slice(5)}`;
  if (u.startsWith("https://") || u.startsWith("http://") || u.startsWith("data:image/")) return u;
  return undefined;
}

export interface TokenMeta {
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  socials: Socials;
}

const MAX_CACHE = 5000;
const cache = new Map<string, TokenMeta | null>();
const inflight = new Map<string, Promise<TokenMeta | null>>();
const MAX_CONCURRENCY = 8;
let active = 0;
const waiters: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

function str(v: unknown, max = 512): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function normTwitter(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? `https://x.com/${h}` : undefined;
}

function normTelegram(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  return /^[A-Za-z0-9_]{3,64}$/.test(h) ? `https://t.me/${h}` : undefined;
}

function normUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  return /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v) ? `https://${v}` : undefined;
}

/** Normalize a metadata JSON object from any launchpad (pump / flap / bags / clanker styles). */
export function parseMeta(j: unknown, imageGateway = DEFAULT_GATEWAY): TokenMeta {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  const ext = (o.extensions && typeof o.extensions === "object" ? o.extensions : {}) as Record<string, unknown>;
  const socials: Socials = {
    twitter: normTwitter(str(o.twitter) ?? str(ext.twitter) ?? str(o.x)),
    telegram: normTelegram(str(o.telegram) ?? str(ext.telegram)),
    website: normUrl(str(o.website) ?? str(ext.website) ?? str(o.external_url)),
    discord: normUrl(str(o.discord) ?? str(ext.discord)),
    farcaster: normUrl(str(o.farcaster)),
  };
  // Clanker style: socialMediaUrls: [{platform, url}]
  if (Array.isArray(o.socialMediaUrls)) {
    for (const item of o.socialMediaUrls) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      const platform = (str(it.platform) ?? "").toLowerCase();
      const url = str(it.url);
      if (!url) continue;
      if ((platform === "x" || platform === "twitter") && !socials.twitter) socials.twitter = normTwitter(url);
      else if (platform === "telegram" && !socials.telegram) socials.telegram = normTelegram(url);
      else if (platform === "website" && !socials.website) socials.website = normUrl(url);
      else if (platform === "discord" && !socials.discord) socials.discord = normUrl(url);
      else if (platform === "farcaster" && !socials.farcaster) socials.farcaster = normUrl(url);
    }
  }
  for (const k of Object.keys(socials) as (keyof Socials)[]) if (!socials[k]) delete socials[k];
  return {
    name: str(o.name, 64),
    symbol: str(o.symbol, 16),
    image: resolveUri(str(o.image, 1024) ?? str(o.image_uri, 1024) ?? str(o.logo, 1024), imageGateway),
    description: str(o.description, 2048),
    socials,
  };
}

async function fetchJsonOnce(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > 64 * 1024) throw new Error("metadata too large");
  return JSON.parse(text) as unknown;
}

/**
 * Fetch + normalize metadata JSON. `preferredGateway` is tried first for IPFS URIs (e.g. Flap's own pinata),
 * then the default gateway. Never throws; returns null on failure (cached for the process lifetime).
 */
export async function fetchMeta(uri: string, opts: { preferredGateway?: string; timeoutMs?: number } = {}): Promise<TokenMeta | null> {
  const key = uri.trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const running = inflight.get(key);
  if (running) return running;

  const p = (async (): Promise<TokenMeta | null> => {
    const urls: string[] = [];
    if (opts.preferredGateway) {
      const u = resolveUri(key, opts.preferredGateway);
      if (u) urls.push(u);
    }
    const d = resolveUri(key);
    if (d && !urls.includes(d)) urls.push(d);
    if (!urls.length) return null;
    await acquire();
    try {
      for (const url of urls) {
        if (url.startsWith("data:")) continue;
        try {
          const j = await fetchJsonOnce(url, opts.timeoutMs ?? 3000);
          return parseMeta(j, opts.preferredGateway ?? DEFAULT_GATEWAY);
        } catch {
          /* try next gateway */
        }
      }
      return null;
    } finally {
      release();
    }
  })();

  inflight.set(key, p);
  try {
    const meta = await p;
    cache.set(key, meta);
    if (cache.size > MAX_CACHE) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
    return meta;
  } finally {
    inflight.delete(key);
  }
}
