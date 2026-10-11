// Shell controls: chain switcher, global quick-buy input, preset toggle, wallet button.
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Lock, Zap } from "lucide-react";
import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import { DEFAULT_CHAIN } from "@shared/platform";
import { useChainState } from "@/lib/platform";
import { toast } from "@/hooks/use-toast";
import { useNativeBalance, useWallet } from "@/lib/wallet";
import { haptic, useSettings } from "@/lib/store";
import { fmtNative, shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PresetToggle } from "@/features/board/ColumnControls";
import { ChainLogo, ResponsiveSheet } from "@/components/kit";
import { CHAIN_LOGOS } from "@/lib/logos";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// Provided by the wallet module for the shell (re-exported from WalletHost).
import { WalletMenu } from "@/features/wallet/WalletHost";

// ─── Chain switcher ─────────────────────────────────────────────────
// Solana is live; Robinhood Chain and BNB Chain show greyed out with a "Soon" badge and can't be picked
// (the state comes from the platform config, see lib/platform.ts). On a token page the app's chain follows the
// token (useRouteChainSync in Shell), so the switcher, quick-buy and wallet always match what you're looking at.

function ChainOption({ chain: c, on, compact, onPick }: { chain: ChainId; on: boolean; compact: boolean; onPick: (c: ChainId) => void }) {
  const info = CHAINS[c];
  const state = useChainState(c);
  const soon = state === "coming_soon" && !on;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={soon || undefined}
      onClick={() => {
        if (!soon) return onPick(c);
        haptic();
        toast({ title: `${info.name} is coming soon`, description: "Solana is live today. We'll open this chain here first." });
      }}
      title={soon ? `${info.name} — coming soon` : info.name}
      className={cn(
        "relative z-0 flex items-center gap-1.5 font-mono font-medium uppercase tracking-[0.08em] transition-colors",
        compact ? "h-9 rounded-[2px] px-2 text-[11px]" : "h-[30px] rounded-[2px] px-2.5 text-[11.5px]",
        on ? "text-text" : soon ? "cursor-not-allowed text-text-3" : "text-text-3 hover:text-text-2",
      )}
    >
      {on && (
        <motion.span
          layoutId={compact ? "chain-pill-m" : "chain-pill"}
          className="absolute inset-0 -z-10 rounded-[2px] bg-panel-3"
          style={{ boxShadow: "inset 0 -2px 0 var(--brand)" }}
          transition={{ type: "spring", stiffness: 520, damping: 40 }}
        />
      )}
      <span
        className="inline-flex shrink-0 rounded-full"
        style={{ opacity: on ? 1 : soon ? 0.4 : 0.55, filter: on ? undefined : "grayscale(1)" }}
      >
        <ChainLogo chain={c} size={compact ? 15 : 14} />
      </span>
      <span className={cn(compact && !on && "sr-only", soon && "opacity-60")}>{info.short}</span>
      {soon && (
        <span className={cn("rounded-[2px] px-1 py-px text-[8.5px] font-medium uppercase tracking-[0.1em] text-text-3 ring-1 ring-inset ring-line-2", compact && "hidden xs:inline")}>
          Soon
        </span>
      )}
    </button>
  );
}

export function ChainSwitcher({ compact = false }: { compact?: boolean }) {
  const chain = useSettings((s) => s.chain);
  const set = useSettings((s) => s.set);
  const [location, navigate] = useLocation();
  const pick = (c: ChainId) => {
    if (c === chain) return;
    haptic();
    set({ chain: c });
    // A token page belongs to one chain: switching chains there means "show me that chain's board".
    if (location.startsWith("/t/")) navigate("/trenches");
  };
  return (
    <div
      role="radiogroup"
      aria-label="Chain"
      className="relative flex items-center rounded-[3px] border border-line p-[3px]"
    >
      {ENABLED_CHAINS.map((c) => (
        <ChainOption key={c} chain={c} on={c === chain} compact={compact} onPick={pick} />
      ))}
    </div>
  );
}

/**
 * Mount once (Shell). On /t/:chain/:address the app's chain becomes the token's chain. Anywhere else, a chain that
 * isn't open (coming soon) falls back to Solana, so a visit to a Robinhood token never leaves the board on it.
 */
export function useRouteChainSync(): void {
  const [location] = useLocation();
  const chain = useSettings((s) => s.chain);
  const state = useChainState(chain);
  useEffect(() => {
    const m = /^\/t\/([^/]+)\//.exec(location);
    const set = useSettings.getState().set;
    if (m) {
      const c = m[1] as ChainId;
      if (c in CHAINS && c !== chain) set({ chain: c });
      return;
    }
    if (state === "coming_soon" && chain !== DEFAULT_CHAIN) set({ chain: DEFAULT_CHAIN });
  }, [location, chain, state]);
}

// ─── Quick-buy amount (global, per chain) ───────────────────────────

export function QuickBuyInput() {
  const chain = useSettings((s) => s.chain);
  const quickBuy = useSettings((s) => s.quickBuy);
  const set = useSettings((s) => s.set);
  const [draft, setDraft] = useState<string | null>(null);
  const value = quickBuy[chain] ?? 0;
  const sym = CHAINS[chain].nativeSymbol;
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    if (Number.isFinite(v) && v > 0) set({ quickBuy: { ...useSettings.getState().quickBuy, [chain]: v } });
    setDraft(null);
  };
  return (
    <label
      className="flex h-9 items-center gap-1.5 rounded-[3px] border border-line pl-2.5 pr-2.5 transition-colors hover:border-line-2 focus-within:border-buy"
      data-tip="Quick-buy amount for 1-click buys"
      title={`Quick-buy amount (${sym})`}
    >
      <Zap className="h-3.5 w-3.5 text-buy" fill="currentColor" />
      <input
        inputMode="decimal"
        aria-label={`Quick-buy amount in ${sym}`}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="num w-14 bg-transparent text-[12px] font-semibold text-text outline-none"
      />
      <span className="text-[11px] text-text-3">{sym}</span>
    </label>
  );
}

export function GlobalPresetToggle() {
  const preset = useSettings((s) => s.activePreset);
  const set = useSettings((s) => s.set);
  return <PresetToggle value={preset} onChange={(p) => set({ activePreset: p })} layoutKey="global" />;
}

// ─── Wallet ─────────────────────────────────────────────────────────

function useActiveWallet(chain: ChainId) {
  const accounts = useWallet((s) => s.accounts);
  const active = useWallet((s) => s.active);
  const unlocked = useWallet((s) => s.unlocked);
  const kind = CHAINS[chain].kind;
  const account = accounts.find((a) => a.id === active[kind]) ?? accounts.find((a) => a.kind === kind);
  const { balance, loading } = useNativeBalance(chain, account?.address);
  return { account, balance, loading, unlocked, hasAny: accounts.length > 0 };
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const chain = useSettings((s) => s.chain);
  const { account, balance, loading, unlocked, hasAny } = useActiveWallet(chain);
  const [open, setOpen] = useState(false);
  const sym = CHAINS[chain].nativeSymbol;

  if (!account) {
    return (
      <Link
        href="/wallets"
        onClick={() => haptic()}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-[3px] bg-brand font-mono font-medium uppercase tracking-[0.1em] text-brand-ink transition-colors hover:bg-brand/90",
          compact ? "h-10 px-3 text-[11px]" : "h-9 px-3.5 text-[11.5px]",
        )}
      >
        {compact ? (hasAny ? "Add" : "Wallet") : hasAny ? `Add ${CHAINS[chain].kind === "svm" ? "Solana" : "EVM"} wallet` : "Set up wallet"}
      </Link>
    );
  }

  const locked = account.source === "local" && !unlocked;
  const bal = loading && balance === undefined ? "…" : balance === undefined ? "—" : fmtNative(balance);
  const trigger = (
    <button
      type="button"
      onClick={() => {
        haptic();
        if (compact) setOpen(true);
      }}
      className={cn(
        "group inline-flex shrink-0 items-center gap-2 rounded-[3px] border border-line transition-colors hover:border-line-2",
        compact ? "h-10 px-2.5" : "h-9 pl-2 pr-3",
      )}
      title={`${account.label} · ${account.address}`}
      aria-label="Wallet"
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full" style={{ background: CHAIN_LOGOS[chain] ? undefined : CHAINS[chain].color }}>
        {CHAIN_LOGOS[chain] && <ChainLogo chain={chain} size={16} />}
        {locked && (
          <span className="absolute -bottom-1 -right-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-panel-3">
            <Lock className="h-2 w-2 text-warn" />
          </span>
        )}
      </span>
      {!compact && <span className="num text-[11px] text-text-3 group-hover:text-text-2">{shortAddr(account.address, 3, 4)}</span>}
      <span className="num text-[12px] font-semibold text-text">
        {bal}
        {!compact && <span className="font-normal text-text-3"> {sym}</span>}
      </span>
    </button>
  );

  if (compact) {
    return (
      <>
        {trigger}
        <ResponsiveSheet open={open} onOpenChange={setOpen} title="Wallet">
          <WalletMenu onNavigate={() => setOpen(false)} />
        </ResponsiveSheet>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-[360px] rounded-[4px] border-line-2 bg-bg-elev p-2">
        <WalletMenu onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
