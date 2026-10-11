// App shell.
//  Desktop: navigation rail on the left · top bar · content · status bar (honest LIVE/SIM per chain)
//  Mobile (<768px): compact top bar (safe-area aware) · content · floating dock with a raised Launch button
// Also mounts global hosts: command palette, alerts, wallet UI, and global hotkeys.
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { AlertsHost } from "@/features/alerts/AlertsHost";
import WalletHost from "@/features/wallet/WalletHost";
import { TipLayer } from "@/features/board/TipLayer";
import { ChainMismatchBanner, useChainSync } from "@/features/wallet/ChainSync";
import { WalletConnectModal } from "@/features/wallet/WalletConnectModal";
import { useGlobalHotkeys } from "./hotkeys";
import { MobileTopBar, TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { Rail } from "./Rail";
import { useRouteChainSync } from "./controls";
import { pageTitle } from "./nav";
import { NETWORK } from "@shared/chains";
import { BRAND } from "@shared/brand";

/** Always-visible strip on testnet builds (VITE_CLAUDIO_NETWORK=testnet) so nobody mistakes test coins for real ones. */
function TestnetStrip() {
  if (NETWORK !== "testnet") return null;
  return (
    <div className="bg-warn-bg px-3 py-1 text-center text-[11px] font-bold tracking-wide text-warn">
      TESTNET — test networks only, coins and fees have no value. Mainnet launchpads aren't on testnet.
    </div>
  );
}

function PageTransition({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const reduce = useReducedMotion();
  // Opacity only: a transform here would turn `position: fixed` children of pages into
  // absolutely-positioned ones (e.g. sticky mobile trade bars).
  return (
    <motion.div
      key={location}
      className="h-full"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  const [location] = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useGlobalHotkeys();
  useChainSync();
  useRouteChainSync();

  // New page → top of the scroll container.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location]);

  // Tab title per section (token pages and docs set their own).
  useEffect(() => {
    if (location.startsWith("/t/") || location.startsWith("/docs") || location === "/privacy" || location === "/terms") return;
    const t = pageTitle(location);
    document.title = location === "/home" ? `${BRAND.full} — ${BRAND.tagline.replace(/\.$/, "")}` : `${t} · ${BRAND.full}`;
  }, [location]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
        <TestnetStrip />
        <div className="flex min-h-0 flex-1">
          {!mobile && <Rail />}
          <div className="flex min-w-0 flex-1 flex-col">
            {mobile ? <MobileTopBar /> : <TopBar />}
            <ChainMismatchBanner />
            <main
              id="main"
              ref={mainRef}
              className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
            >
              <PageTransition>{children}</PageTransition>
            </main>
            {mobile ? <TabBar /> : <StatusBar />}
          </div>
        </div>
      </div>
      <CommandPalette />
      <AlertsHost />
      <WalletHost />
      <WalletConnectModal />
      {!mobile && <TipLayer />}
    </MotionConfig>
  );
}
