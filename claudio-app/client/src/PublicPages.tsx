// Pages anyone can read while the site is "coming soon": /docs, /privacy, /terms, /skills (app reviews, MCP directories and
// the relays link to them). A light frame instead of the full terminal shell. The path list lives in App.tsx (PUBLIC_PAGES),
// in step with server/access.ts. When the site is open these same pages render inside the normal shell (TerminalApp).
import { lazy, Suspense } from "react";
import { Link, Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ClaudioMark } from "@/components/kit";
import { BRAND } from "@shared/brand";

const Docs = lazy(() => import("@/pages/Docs"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Skills = lazy(() => import("@/pages/Skills"));
const Skill = lazy(() => import("@/pages/Skill"));

export default function PublicPages() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-bg px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <ClaudioMark size={30} />
            <span className="font-display text-[18px] font-bold uppercase tracking-[0.12em]">{BRAND.full}</span>
          </Link>
          <nav aria-label="Public pages" className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 md:gap-6">
            <Link href="/skills" className="hover:text-text">
              Skills
            </Link>
            <Link href="/docs" className="hover:text-text">
              Docs
            </Link>
            <Link href="/privacy" className="hover:text-text">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-text">
              Terms
            </Link>
          </nav>
        </header>
        <main id="main" className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <Suspense fallback={<div className="h-full w-full sheen" />}>
            <Switch>
              <Route path="/docs" component={Docs} />
              <Route path="/docs/:section" component={Docs} />
              <Route path="/privacy" component={Privacy} />
              <Route path="/terms" component={Terms} />
              <Route path="/skills" component={Skills} />
              <Route path="/skills/:slug" component={Skill} />
            </Switch>
          </Suspense>
        </main>
      </div>
    </QueryClientProvider>
  );
}
