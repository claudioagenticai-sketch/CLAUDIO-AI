import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { BRAND } from "@shared/brand";
import ComingSoon from "@/pages/ComingSoon";

const TerminalApp = lazy(() => import("./TerminalApp"));
const PublicPages = lazy(() => import("./PublicPages"));
// The public site (/ and /claudio): own header and footer, never gated (it is the public face while closed too).
const SitePages = lazy(() => import("./SitePages"));

/** Served by SitePages whether the site is open or closed. Keep in step with server/access.ts SITE_PAGES. */
const SITE_PAGES: RegExp[] = [/^\/$/, /^\/claudio\/?$/];

/** Readable while closed (same list as server/access.ts PUBLIC_PAGES and PublicPages.tsx). */
const PUBLIC_PAGES: RegExp[] = [/^\/privacy\/?$/, /^\/terms\/?$/, /^\/docs(\/[a-z0-9-]+)?\/?$/];
// Skills library (/skills, /skills/:slug).
PUBLIC_PAGES.push(/^\/skills(\/[a-z0-9-]+)?\/?$/);

// /connect (OAuth consent + MCP keys) and /confirm/:id (sign a prepared trade/launch) run outside the terminal shell.
const McpApp = lazy(() => import("@/features/mcp/McpApp"));

const path = () => (typeof window !== "undefined" ? window.location.pathname : "/");
/** /connect works even while the site is closed: AI apps send people here to sign in (OAuth) — it only needs /api/auth. */
const isConnect = () => path() === "/connect" || path().startsWith("/connect/");
const isConfirm = () => path().startsWith("/confirm/");

/**
 * The server decides per visitor whether the site is open (COMING_SOON env, or the /preview cookie), and reports it
 * on /api/health. Until that answer arrives we render nothing (it's one tiny request); if it fails we fall back to the
 * compiled-in BRAND.comingSoon.
 */
export default function App() {
  if (isConnect()) {
    return (
      <Suspense fallback={null}>
        <McpApp />
      </Suspense>
    );
  }
  return <GatedApp />;
}

function GatedApp() {
  const [closed, setClosed] = useState<boolean | null>(null);
  const [location] = useLocation();

  useEffect(() => {
    let alive = true;
    fetch("/api/health", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((h: { comingSoon?: boolean }) => alive && setClosed(h.comingSoon ?? BRAND.comingSoon))
      .catch(() => alive && setClosed(BRAND.comingSoon));
    return () => {
      alive = false;
    };
  }, []);

  if (SITE_PAGES.some((r) => r.test(location))) {
    return (
      <Suspense fallback={null}>
        <SitePages />
      </Suspense>
    );
  }
  if (closed === null) return null;
  if (closed) {
    if (PUBLIC_PAGES.some((r) => r.test(location))) {
      return (
        <Suspense fallback={null}>
          <PublicPages />
        </Suspense>
      );
    }
    return <ComingSoon />;
  }

  // /confirm/:id signs real transactions, so it follows the same gate as trading (open site or preview access).
  if (isConfirm()) {
    return (
      <Suspense fallback={null}>
        <McpApp />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <TerminalApp />
    </Suspense>
  );
}
