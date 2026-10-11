// Standalone mini-app for the pages AI apps send people to: /connect (sign in + allow an app, manage MCP keys) and
// /confirm/:id (review and sign a trade or launch an assistant prepared). It deliberately lives outside the terminal
// Shell so /connect keeps working while the site is in coming-soon mode (App.tsx routes it before that check).
import { lazy, Suspense, type ReactNode } from "react";
import { Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClaudioMark, Wordmark } from "@/components/kit/brand";
import WalletHost from "@/features/wallet/WalletHost";
import { WalletConnectModal } from "@/features/wallet/WalletConnectModal";

const ConnectPage = lazy(() => import("./ConnectPage"));
const ConfirmPage = lazy(() => import("./ConfirmPage"));

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-bg text-text">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5" aria-label="Claudio home">
            <ClaudioMark size={30} />
            <Wordmark size={14} />
          </a>
          <a href="/docs" className="inline-flex h-10 items-center font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text">
            Docs
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 md:pt-10">{children}</main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="panel p-6 text-center">
      <h1 className="display text-[32px] text-text">Nothing here</h1>
      <p className="mt-2 text-sm text-text-3">
        This link isn't a Claudio connect or confirm page. <a className="text-brand" href="/connect">Connect an app</a>
      </p>
    </div>
  );
}

export default function McpApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250}>
        <Frame>
          <Suspense fallback={<div className="panel sheen h-[320px]" />}>
            <Switch>
              <Route path="/connect" component={ConnectPage} />
              <Route path="/confirm/:id" component={ConfirmPage} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </Frame>
        <WalletHost />
        <WalletConnectModal />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
