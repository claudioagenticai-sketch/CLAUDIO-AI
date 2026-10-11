// Handle → stable provider id, at LAUNCH time. The vault is keyed by the id, so whoever owns the account when the
// token launches is who can claim, even if the handle is later renamed or re-registered by someone else.
//
// No API keys needed: every social is looked up from public, indexed profile data (the same data link previews
// use). Official APIs are used first when their optional keys are set. Because a wrong id would send fees to the
// wrong vault, the id must come from a source that states it explicitly, and X is cross-checked against two
// independent mirrors when both answer.
//
// Only socials someone can later SIGN IN with (SIGN_IN_VIA) are targetable — otherwise fees would be stuck.
// LinkedIn has no public lookup (auth wall, and its sign-in id is app-scoped), so it's sign-in only.
import { SIGN_IN_VIA, type SocialProvider } from "@shared/social";
import { enabledAuthProviders } from "./auth";
import type { SocialIdentity } from "./identity";

export interface ResolvedAccount extends SocialIdentity {
  displayName?: string;
  avatarUrl?: string;
  /** Extra signals shown to the launcher so they can check it's the right account. */
  followers?: number;
  verified?: boolean;
}

export class ResolveError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const cache = new Map<string, { at: number; value: ResolvedAccount }>();
const TTL_MS = 10 * 60_000;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const env = (n: string) => process.env[n]?.trim() || undefined;

function cleanHandle(h: string): string {
  return h
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.|open\.)?(x|twitter|github|twitch|tiktok|huggingface|spotify)\.(com|co|tv)\/(user\/|@)?/i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0];
}

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(8_000) });
    return { status: res.status, text: await res.text().catch(() => "") };
  } catch {
    return { status: 0, text: "" };
  }
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T | null }> {
  const r = await get(url, { accept: "application/json", ...headers });
  try {
    return { status: r.status, body: JSON.parse(r.text) as T };
  } catch {
    return { status: r.status, body: null };
  }
}

const notFound = (provider: string, handle: string) => new ResolveError(404, "not_found", `@${handle} doesn't exist on ${provider}`);
const unavailable = (provider: string) =>
  new ResolveError(503, "lookup_unavailable", `${provider} lookup is unavailable right now — try again in a minute`);

// ─── X ──────────────────────────────────────────────────────────────────────────────────────────

async function xOfficial(handle: string, token: string): Promise<ResolvedAccount | null> {
  const { status, body } = await getJson<{ data?: { id: string; username: string; name?: string; profile_image_url?: string; verified?: boolean; public_metrics?: { followers_count?: number } } }>(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=name,profile_image_url,public_metrics,verified`,
    { authorization: `Bearer ${token}` },
  );
  const d = body?.data;
  if (status === 200 && d) {
    return { provider: "x", providerUserId: d.id, handle: d.username, displayName: d.name, avatarUrl: d.profile_image_url, verified: d.verified, followers: d.public_metrics?.followers_count };
  }
  if (status === 200 || status === 404) throw notFound("X", handle);
  return null; // rate-limited / out of credit: fall back to public mirrors
}

async function xFx(handle: string): Promise<ResolvedAccount | null | "missing"> {
  const { status, body } = await getJson<{ code?: number; user?: { id: string; screen_name: string; name?: string; avatar_url?: string; followers?: number; verification?: { verified?: boolean } } }>(
    `https://api.fxtwitter.com/${encodeURIComponent(handle)}`,
  );
  const u = body?.user;
  if (u?.id && /^\d+$/.test(u.id)) {
    return {
      provider: "x",
      providerUserId: u.id,
      handle: u.screen_name,
      displayName: u.name,
      avatarUrl: u.avatar_url?.replace("_normal.", "_200x200."),
      followers: u.followers,
      verified: u.verification?.verified,
    };
  }
  return status === 404 || body?.code === 404 ? "missing" : null;
}

async function xVx(handle: string): Promise<ResolvedAccount | null | "missing"> {
  const { status, body } = await getJson<{ id?: number | string; screen_name?: string; name?: string; profile_image_url?: string; followers_count?: number }>(
    `https://api.vxtwitter.com/${encodeURIComponent(handle)}`,
  );
  if (body?.id != null && /^\d+$/.test(String(body.id))) {
    return {
      provider: "x",
      providerUserId: String(body.id),
      handle: body.screen_name ?? handle,
      displayName: body.name,
      avatarUrl: body.profile_image_url?.replace("_normal.", "_200x200."),
      followers: body.followers_count,
    };
  }
  return status === 404 ? "missing" : null;
}

async function resolveX(handle: string): Promise<ResolvedAccount> {
  const token = env("X_BEARER_TOKEN");
  if (token) {
    const r = await xOfficial(handle, token);
    if (r) return r;
  }
  const [fx, vx] = await Promise.all([xFx(handle), xVx(handle)]);
  const fxOk = fx && fx !== "missing" ? fx : null;
  const vxOk = vx && vx !== "missing" ? vx : null;
  // Two independent mirrors disagreeing on the id means one is wrong: refuse rather than guess.
  if (fxOk && vxOk && fxOk.providerUserId !== vxOk.providerUserId) throw unavailable("X");
  // One mirror down is fine; one saying "no such account" while the other finds it is not.
  if (fxOk) return vx === "missing" ? Promise.reject(unavailable("X")) : fxOk;
  if (vxOk) return fx === "missing" ? Promise.reject(unavailable("X")) : vxOk;
  if (fx === "missing" || vx === "missing") throw notFound("X", handle);
  throw unavailable("X");
}

// ─── GitHub ─────────────────────────────────────────────────────────────────────────────────────

async function resolveGithub(handle: string): Promise<ResolvedAccount> {
  const headers: Record<string, string> = { "user-agent": "claudio" };
  if (env("GITHUB_TOKEN")) headers.authorization = `Bearer ${env("GITHUB_TOKEN")}`;
  const { status, body: u } = await getJson<{ id?: number; login?: string; name?: string; avatar_url?: string; followers?: number; type?: string }>(
    `https://api.github.com/users/${encodeURIComponent(handle)}`,
    headers,
  );
  if (status === 403 || status === 429) throw new ResolveError(429, "github_rate_limited", "GitHub lookup rate-limited, try again shortly");
  if (!u?.id || !u.login) throw status === 404 ? notFound("GitHub", handle) : unavailable("GitHub");
  if (u.type && u.type !== "User") throw new ResolveError(400, "not_a_user", `@${u.login} is a GitHub ${u.type.toLowerCase()}, not a person who can sign in`);
  return { provider: "github", providerUserId: String(u.id), handle: u.login, displayName: u.name ?? undefined, avatarUrl: u.avatar_url, followers: u.followers };
}

// ─── Twitch ─────────────────────────────────────────────────────────────────────────────────────

let twitchToken: { value: string; exp: number } | null = null;
async function twitchOfficial(handle: string): Promise<ResolvedAccount | null> {
  const id = env("TWITCH_CLIENT_ID");
  const secret = env("TWITCH_CLIENT_SECRET");
  if (!id || !secret) return null;
  if (!twitchToken || twitchToken.exp < Date.now()) {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!j?.access_token) return null;
    twitchToken = { value: j.access_token, exp: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
  }
  const { status, body } = await getJson<{ data?: { id: string; login: string; display_name?: string; profile_image_url?: string }[] }>(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(handle)}`,
    { "client-id": id, authorization: `Bearer ${twitchToken.value}` },
  );
  if (status !== 200) return null;
  const u = body?.data?.[0];
  if (!u) throw notFound("Twitch", handle);
  return { provider: "twitch", providerUserId: u.id, handle: u.login, displayName: u.display_name, avatarUrl: u.profile_image_url };
}

async function resolveTwitch(handle: string): Promise<ResolvedAccount> {
  const official = await twitchOfficial(handle);
  if (official) return official;
  // DecAPI: public Twitch username → id / avatar proxy. Plain-text answers; errors are sentences.
  const [id, avatar] = await Promise.all([
    get(`https://decapi.me/twitch/id/${encodeURIComponent(handle)}`),
    get(`https://decapi.me/twitch/avatar/${encodeURIComponent(handle)}`),
  ]);
  const uid = id.text.trim();
  if (id.status === 200 && /^\d+$/.test(uid)) {
    const av = avatar.text.trim();
    return { provider: "twitch", providerUserId: uid, handle: handle.toLowerCase(), avatarUrl: /^https:\/\//.test(av) ? av : undefined };
  }
  if (/invalid|not found|does not exist/i.test(uid)) throw notFound("Twitch", handle);
  throw unavailable("Twitch");
}

// ─── Spotify ────────────────────────────────────────────────────────────────────────────────────

function metaContent(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i");
  return html.match(re)?.[1]?.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
}

async function resolveSpotify(handle: string): Promise<ResolvedAccount> {
  // Spotify's sign-in id IS the user id in open.spotify.com/user/<id>. Its link-preview render (what chat apps see)
  // is server-side, 404s for unknown ids and carries the profile name + picture; the browser render doesn't.
  const r = await get(`https://open.spotify.com/user/${encodeURIComponent(handle)}`, { "user-agent": "facebookexternalhit/1.1", "accept-language": "en" });
  if (r.status === 404) throw notFound("Spotify", handle);
  if (r.status !== 200) throw unavailable("Spotify");
  const canonical = r.text.match(/<link rel="canonical" href="https:\/\/open\.spotify\.com\/user\/([^"?/]+)"/)?.[1];
  const title = metaContent(r.text, "og:title");
  if (!canonical || !title || /Web Player/i.test(title)) throw notFound("Spotify", handle);
  const image = metaContent(r.text, "og:image");
  const id = decodeURIComponent(canonical);
  return { provider: "spotify", providerUserId: id, handle: id, displayName: title, avatarUrl: image?.startsWith("https://i.scdn.co/") ? image : undefined };
}

// ─── Hugging Face ───────────────────────────────────────────────────────────────────────────────

async function resolveHuggingface(handle: string): Promise<ResolvedAccount> {
  const { status, body: u } = await getJson<{ _id?: string; user?: string; fullname?: string; avatarUrl?: string; numFollowers?: number; isPro?: boolean }>(
    `https://huggingface.co/api/users/${encodeURIComponent(handle)}/overview`,
  );
  if (status === 404 || status === 401) throw notFound("Hugging Face", handle);
  if (!u?._id || !/^[0-9a-f]{24}$/i.test(u._id)) throw unavailable("Hugging Face");
  const avatar = u.avatarUrl?.startsWith("/") ? `https://huggingface.co${u.avatarUrl}` : u.avatarUrl;
  return { provider: "huggingface", providerUserId: u._id, handle: u.user ?? handle, displayName: u.fullname, avatarUrl: avatar, followers: u.numFollowers };
}

// ─── TikTok (handle-keyed) ──────────────────────────────────────────────────────────────────────

async function resolveTiktok(handle: string): Promise<ResolvedAccount> {
  const r = await get(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, { "user-agent": BROWSER_UA, "accept-language": "en" });
  if (r.status !== 200) throw unavailable("TikTok");
  const blob = r.text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!blob) throw unavailable("TikTok");
  type Detail = { statusCode?: number; userInfo?: { user?: { uniqueId?: string; nickname?: string; avatarLarger?: string; verified?: boolean }; stats?: { followerCount?: number } } };
  let d: Detail | undefined;
  try {
    d = (JSON.parse(blob) as { __DEFAULT_SCOPE__?: Record<string, Detail> }).__DEFAULT_SCOPE__?.["webapp.user-detail"];
  } catch {
    throw unavailable("TikTok");
  }
  const u = d?.userInfo?.user;
  if (!u?.uniqueId) throw d?.statusCode ? notFound("TikTok", handle) : unavailable("TikTok");
  const name = u.uniqueId.toLowerCase();
  // Keyed by username: the sign-in (Clerk) only exposes an app-scoped open_id that no public page shows.
  return { provider: "tiktok", providerUserId: name, handle: u.uniqueId, displayName: u.nickname, avatarUrl: u.avatarLarger, verified: u.verified, followers: d?.userInfo?.stats?.followerCount };
}

// ─── Discord (optional bot token; no public username lookup exists) ─────────────────────────────

async function resolveDiscord(input: string): Promise<ResolvedAccount> {
  const token = env("DISCORD_BOT_TOKEN");
  if (!token) throw new ResolveError(501, "discord_unconfigured", "Discord accounts can't be looked up on this server");
  if (!/^\d{17,20}$/.test(input)) throw new ResolveError(400, "bad_handle", "Enter the Discord user id (17–20 digits): Discord has no public username lookup");
  const { status, body: u } = await getJson<{ id?: string; username?: string; global_name?: string; avatar?: string | null; bot?: boolean }>(
    `https://discord.com/api/v10/users/${input}`,
    { authorization: `Bot ${token}` },
  );
  if (status === 404 || status === 400) throw new ResolveError(404, "not_found", "No Discord user with that id");
  if (!u?.id) throw unavailable("Discord");
  if (u.bot) throw new ResolveError(400, "not_a_user", "That's a bot account");
  const avatarUrl = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : undefined;
  return { provider: "discord", providerUserId: u.id, handle: u.username, displayName: u.global_name ?? undefined, avatarUrl };
}

// ─── Registry ───────────────────────────────────────────────────────────────────────────────────

const RESOLVERS: Partial<Record<SocialProvider, (h: string) => Promise<ResolvedAccount>>> = {
  x: resolveX,
  tiktok: resolveTiktok,
  github: resolveGithub,
  twitch: resolveTwitch,
  spotify: resolveSpotify,
  huggingface: resolveHuggingface,
  discord: resolveDiscord,
};

/** Providers a launcher can target by handle right now: publicly resolvable AND claimable through a sign-in. */
export function resolvableProviders(): SocialProvider[] {
  const enabledAuth = enabledAuthProviders();
  return (Object.keys(RESOLVERS) as SocialProvider[]).filter((p) => {
    const via = SIGN_IN_VIA[p];
    if (!via || !enabledAuth.includes(via)) return false;
    return p !== "discord" || !!env("DISCORD_BOT_TOKEN");
  });
}

export async function resolveHandle(provider: SocialProvider, rawHandle: string): Promise<ResolvedAccount> {
  const handle = cleanHandle(rawHandle);
  if (!/^[A-Za-z0-9_.-]{1,39}$/.test(handle)) throw new ResolveError(400, "bad_handle", "That doesn't look like a valid handle");
  const fn = RESOLVERS[provider];
  if (!fn || !resolvableProviders().includes(provider)) {
    throw new ResolveError(400, "unsupported_provider", `Launching for ${provider} accounts isn't supported (no public lookup, or no way to claim)`);
  }
  const ck = `${provider}:${handle.toLowerCase()}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fn(handle);
  cache.set(ck, { at: Date.now(), value });
  if (cache.size > 5_000) cache.clear();
  return value;
}
