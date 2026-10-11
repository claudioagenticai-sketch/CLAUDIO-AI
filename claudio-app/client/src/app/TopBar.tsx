// Desktop top bar (section title · chain · search · trading controls) + compact mobile top bar.
import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { BRAND } from "@shared/brand";
import { ClaudioMark, Wordmark } from "@/components/kit";
import { haptic, useUI } from "@/lib/store";
import { ChainSwitcher, GlobalPresetToggle, QuickBuyInput, WalletButton } from "./controls";
import { pageTitle } from "./nav";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/home" className="flex shrink-0 items-center gap-2.5" aria-label={`${BRAND.full} home`}>
      <ClaudioMark size={compact ? 30 : 32} />
      <Wordmark size={13} className={compact ? "hidden xs:inline-flex" : undefined} />
    </Link>
  );
}

export function TopBar() {
  const [location] = useLocation();
  const setPalette = useUI((s) => s.setPalette);
  return (
    <header className="relative z-30 flex h-topbar shrink-0 items-center gap-4 border-b border-line bg-chrome px-4 backdrop-blur">
      <div className="flex min-w-0 shrink-0 items-center gap-4">
        <h1 className="hidden min-w-[96px] items-center gap-2 font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] text-text xl:flex">
          <span className="text-brand" aria-hidden>
            /
          </span>
          {pageTitle(location)}
        </h1>
        <ChainSwitcher />
      </div>

      <button
        type="button"
        onClick={() => setPalette(true)}
        className="mx-auto flex h-9 min-w-[40px] max-w-[440px] flex-1 items-center gap-2.5 rounded-[3px] border border-line bg-bg px-3 text-left text-[12.5px] text-text-3 transition-colors hover:border-line-2 hover:text-text-2"
        aria-label="Search (⌘K)"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden truncate lg:inline">Search tokens, paste a contract address…</span>
        <kbd className="num ml-auto hidden shrink-0 rounded-[2px] border border-line-2 px-1.5 py-0.5 text-[10px] text-text-3 lg:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <QuickBuyInput />
        <GlobalPresetToggle />
        <span className="mx-1 h-full w-px self-stretch bg-line" aria-hidden />
        <WalletButton />
      </div>
    </header>
  );
}

export function MobileTopBar() {
  const setPalette = useUI((s) => s.setPalette);
  return (
    <header className="safe-top relative z-30 shrink-0 border-b border-line bg-chrome backdrop-blur">
      <div className="flex h-[54px] items-center gap-2 px-3">
        <Logo compact />
        <div className="flex min-w-0 flex-1 justify-center">
          <ChainSwitcher compact />
        </div>
        <button
          type="button"
          onClick={() => {
            haptic();
            setPalette(true);
          }}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] border border-line text-text-2 active:bg-panel-2"
          aria-label="Search"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
        <WalletButton compact />
      </div>
    </header>
  );
}
