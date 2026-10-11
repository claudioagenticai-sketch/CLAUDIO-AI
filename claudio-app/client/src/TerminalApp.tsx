import { lazy, Suspense, useEffect } from "react";
import { Redirect, Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { wireSocket } from "@/lib/store";
import Shell from "@/app/Shell";
import { ClerkCallback, SocialAuthProvider } from "@/features/social/auth";
import { startWatchlistSync } from "@/features/mcp/watchlistSync";

// Route-level code splitting keeps the first paint light on phones.
const Home = lazy(() => import("@/pages/Home"));
const Trenches = lazy(() => import("@/pages/Trenches"));
const Token = lazy(() => import("@/pages/Token"));
const Launch = lazy(() => import("@/pages/Launch"));
const Portfolio = lazy(() => import("@/pages/Portfolio"));
const Wallets = lazy(() => import("@/pages/Wallets"));
const Tracker = lazy(() => import("@/pages/Tracker"));
const Settings = lazy(() => import("@/pages/Settings"));
const Creator = lazy(() => import("@/pages/Creator"));
const Claim = lazy(() => import("@/pages/Claim"));
const Agents = lazy(() => import("@/pages/Agents"));
const Agent = lazy(() => import("@/pages/Agent"));
const AgentConsole = lazy(() => import("@/pages/AgentConsole"));
const Admin = lazy(() => import("@/pages/Admin"));
const Docs = lazy(() => import("@/pages/Docs"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const Terms = lazy(() => import("@/pages/Terms"));
const Skills = lazy(() => import("@/pages/Skills"));
const Skill = lazy(() => import("@/pages/Skill"));
const Cloud = lazy(() => import("@/pages/Cloud"));
const CloudWorkspace = lazy(() => import("@/pages/CloudWorkspace"));
const Generate = lazy(() => import("@/pages/Generate"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function PageFallback() {
  return <div className="h-full w-full sheen" />;
}

export default function TerminalApp() {
  useEffect(() => wireSocket(), []);
  // Keeps the copy of the watchlist that connected AI apps read in sync (only when sharing is on, see /connect).
  useEffect(() => startWatchlistSync(), []);
  return (
    <SocialAuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250}>
          <Shell>
            <Suspense fallback={<PageFallback />}>
              <Switch>
                <Route path="/home" component={Home} />
                <Route path="/trenches" component={Trenches} />
                <Route path="/t/:chain/:address" component={Token} />
                <Route path="/launch" component={Launch} />
                <Route path="/portfolio" component={Portfolio} />
                <Route path="/wallets" component={Wallets} />
                <Route path="/tracker" component={Tracker} />
                <Route path="/creator" component={Creator} />
                <Route path="/settings" component={Settings} />
                <Route path="/claim" component={Claim} />
                <Route path="/agents" component={Agents} />
                <Route path="/a/:slug/console" component={AgentConsole} />
                <Route path="/a/:slug" component={Agent} />
                <Route path="/cloud" component={Cloud} />
                <Route path="/cloud/:slug" component={CloudWorkspace} />
                <Route path="/generate" component={Generate} />
                <Route path="/admin" component={Admin} />
                <Route path="/docs" component={Docs} />
                <Route path="/docs/:section" component={Docs} />
                <Route path="/privacy" component={Privacy} />
                <Route path="/terms" component={Terms} />
                <Route path="/skills" component={Skills} />
                <Route path="/skills/:slug" component={Skill} />
                <Route path="/sso-callback" component={ClerkCallback} />
                <Route path="/board">
                  <Redirect to="/trenches" />
                </Route>
                <Route component={NotFound} />
              </Switch>
            </Suspense>
          </Shell>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </SocialAuthProvider>
  );
}
