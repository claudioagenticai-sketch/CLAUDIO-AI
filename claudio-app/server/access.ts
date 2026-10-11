// Coming-soon gate with a private preview.
//
//   COMING_SOON   "false" opens the site; anything else (default) shows only the teaser to the public.
//   PREVIEW_KEY   16+ chars. Visiting /preview?key=<PREVIEW_KEY> sets an httpOnly cookie that lets that browser
//                 use the whole app while the public still sees the teaser. /preview?off=1 clears it.
//
// While closed, only these stay reachable for everyone: /api/health, /api/platform/config (the teaser shows the
// $CLAUDIO address from it), /api/auth/*, /api/admin/* (so an admin can sign in and flip switches), the relays
// (/relay/*), the public site (/ and /claudio, with /llms.txt, the .md twins, robots.txt and sitemap.xml), the public
// pages /privacy, /terms and /docs, and the machine endpoints of the online MCP server:
// /mcp/*, /oauth/*, /.well-known/*, /api/oauth/*, /api/mcp/* plus the /connect page (wallet sign-in + consent, so apps
// can connect to the read-only Data server before launch). /confirm/:id (signing a prepared trade or launch) stays
// behind the gate: it needs the trading APIs, which open with the site (or with the preview cookie). The MCP server's
// own loopback calls (server/mcp/internal.ts) pass as well.
import type { Express, NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { readCookie } from "./auth";
import { isInternalRequest } from "./mcp/internal";

const COOKIE = "claudio_preview";
const PREVIEW_TTL_MS = 30 * 24 * 3600_000;

export function comingSoon(): boolean {
  return (process.env.COMING_SOON ?? "true").trim().toLowerCase() !== "false";
}

function previewKey(): string | null {
  const k = process.env.PREVIEW_KEY?.trim();
  return k && k.length >= 16 ? k : null;
}

export function previewEnabled(): boolean {
  return previewKey() !== null;
}

function token(key: string): string {
  return createHmac("sha256", key).update("claudio-preview-v1").digest("base64url");
}

export function hasPreview(req: Request): boolean {
  const key = previewKey();
  if (!key) return false;
  const got = readCookie(req, COOKIE);
  if (!got) return false;
  const want = token(key);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** True when this request should see the coming-soon teaser instead of the app. */
export function closedFor(req: Request): boolean {
  return comingSoon() && !hasPreview(req);
}

const OPEN_API = [/^\/api\/health$/, /^\/api\/platform\/config$/, /^\/api\/auth\//, /^\/api\/admin\//, /^\/api\/oauth\//, /^\/api\/mcp\//];
// Skills library (server/skills): public while closed too.
OPEN_API.push(/^\/api\/skills(\/|$)/);
/**
 * Machine endpoints that must work while closed: the OAuth bounce and the media relay (server/relay), and the online
 * MCP server with its OAuth endpoints and the /connect consent page (server/mcp).
 */
export const OPEN_PATHS: RegExp[] = [
  /^\/relay(\/|$)/,
  /^\/mcp\/(data|trade)\/?$/,
  /^\/oauth\//,
  /^\/\.well-known\//,
  /^\/connect\/?$/,
  // Agent-readable twins of the public site (server/site.ts; /skills twins come from the skills library).
  /^\/llms(-full)?\.txt$/,
  /^\/[a-z0-9/_-]*\.md$/i,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
];
// Skills library downloads and raw Markdown (/skills.md, /skills/<slug>.md, /skills/<slug>/SKILL.md, /skills/*.zip, /skills/index.json).
OPEN_PATHS.push(/^\/skills\.md$/, /^\/skills\/[a-z0-9-]+(\.md|\.zip|\/SKILL\.md)$/, /^\/skills\/index\.json$/);

/**
 * SPA pages anyone can read while closed (app reviews, MCP directories and the docs link to them). The client shows
 * them without the teaser too (client/src/App.tsx, PUBLIC_PAGES). Keep the two lists in step.
 */
export const PUBLIC_PAGES: RegExp[] = [/^\/privacy\/?$/, /^\/terms\/?$/, /^\/docs(\/[a-z0-9-]+)?\/?$/];
// Skills library pages (/skills, /skills/:slug).
PUBLIC_PAGES.push(/^\/skills(\/[a-z0-9-]+)?\/?$/);

/**
 * The public site: / (the landing) and /claudio (his character page). Always readable, open or closed; the client
 * renders them outside the gate (client/src/App.tsx, SITE_PAGES).
 */
export const SITE_PAGES: RegExp[] = [/^\/$/, /^\/claudio\/?$/];

export function registerAccessGate(app: Express): void {
  app.get("/preview", (req, res) => {
    const key = previewKey();
    const secure = req.secure || req.get("x-forwarded-proto") === "https";
    const base = ["Path=/", "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])];
    if (req.query.off) {
      res.append("Set-Cookie", [`${COOKIE}=`, ...base, "Max-Age=0"].join("; "));
      return res.redirect(302, "/");
    }
    const given = String(req.query.key ?? "");
    if (!key || given.length !== key.length || !timingSafeEqual(Buffer.from(given), Buffer.from(key))) {
      return res.redirect(302, "/");
    }
    res.append("Set-Cookie", [`${COOKIE}=${token(key)}`, ...base, `Max-Age=${PREVIEW_TTL_MS / 1000}`].join("; "));
    res.redirect(302, "/home");
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!closedFor(req)) return next();
    if (isInternalRequest(req) || OPEN_PATHS.some((r) => r.test(req.path))) return next();
    if (req.path.startsWith("/api")) {
      if (OPEN_API.some((r) => r.test(req.path))) return next();
      return res.set("Retry-After", "3600").status(503).json({ error: "coming_soon", message: "Claudio is coming soon." });
    }
    if (req.path === "/ws") return res.status(503).send("Claudio is coming soon.");
    // Every other page (/home, /trenches, …) still gets the SPA, which shows the coming-soon teaser at that URL
    // (client/src/App.tsx). Its data APIs stay closed above, so nothing behind the gate is reachable.
    next();
  });
}
