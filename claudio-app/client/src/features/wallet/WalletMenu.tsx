// Wallet dropdown/drawer content: active accounts per chain family, balances, switch, lock.
// Exported for the Shell (via WalletHost.tsx) — render inside a popover or sheet.

import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Lock, LockOpen, PieChart, Plug, Plus, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddr } from "@/lib/format";
import { haptic } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import { ChainBadge, CopyAddress, ResponsiveSheet } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWallet, useActiveAccount, type WalletAccount } from "@/lib/wallet";
import { lock, openWalletPrompt, setActive } from "@/lib/wallet/keystore";
import type { ChainKind } from "@shared/chains";
import { AddressOrb, NativeBalance, ActionButton, chainsForKind, kindName } from "./ui";
import { InjectedButtons } from "./gate";

function AccountSwitcher({ kind, current }: { kind: ChainKind; current?: WalletAccount }) {
  const accounts = useWallet((s) => s.accounts);
  const list = accounts.filter((a) => a.kind === kind);
  if (list.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="-my-1 flex h-8 items-center gap-1 rounded-[3px] px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-2 ring-1 ring-inset ring-line transition-colors hover:bg-panel-2 hover:text-text"
          aria-label={`Switch ${kindName(kind)} account`}
        >
          Switch <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-[4px] border-line-2 bg-panel">
        <DropdownMenuLabel className="eyebrow">{kindName(kind)} accounts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list.map((a) => (
          <DropdownMenuItem
            key={a.id}
            className="flex min-h-[44px] items-center gap-2.5 rounded-[3px]"
            onSelect={() => {
              haptic();
              void setActive(kind, a.id);
            }}
          >
            <AddressOrb address={a.address} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.label}</span>
              <span className="num block text-[11px] text-text-3">{shortAddr(a.address)}</span>
            </span>
            {a.source === "injected" && <span className="chip chip-info">ext</span>}
            {current?.id === a.id && <Check className="h-4 w-4 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActiveCard({ kind, index }: { kind: ChainKind; index: number }) {
  const acct = useActiveAccount(kind);
  if (!acct) return null;
  const chains = chainsForKind(kind);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-[3px] border border-line p-3"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="eyebrow">{kind === "evm" ? "EVM · Robinhood, BNB (soon)" : "Solana"}</span>
        <AccountSwitcher kind={kind} current={acct} />
      </div>
      <div className="flex items-center gap-3">
        <AddressOrb address={acct.address} kind={kind} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{acct.label}</span>
            {acct.source === "injected" && <span className="chip chip-info">browser</span>}
          </div>
          <CopyAddress address={acct.address} head={5} tail={5} />
        </div>
      </div>
      <div className={cn("mt-3 grid gap-1.5", chains.length > 1 && "grid-cols-2")}>
        {chains.map((c) => (
          <div key={c} className="rounded-[3px] bg-bg px-2.5 py-2 ring-1 ring-line">
            <ChainBadge chain={c} label className="text-[10.5px]" />
            <NativeBalance chain={c} address={acct.address} showChain={false} className="mt-1 flex text-[13px] font-semibold" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function WalletMenu({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const hydrated = useWallet((s) => s.hydrated);
  const initialized = useWallet((s) => s.initialized);
  const unlocked = useWallet((s) => s.unlocked);
  const autoLockMin = useWallet((s) => s.autoLockMin);
  const accounts = useWallet((s) => s.accounts);
  const hasLocal = accounts.some((a) => a.source === "local");
  const hasInjected = accounts.some((a) => a.source === "injected");

  if (!hydrated) return <div className={cn("sheen h-40 rounded-[3px] border border-line", className)} />;

  if (!initialized && accounts.length === 0) {
    return (
      <div className={cn("grid gap-3 p-1", className)}>
        <div className="relative overflow-hidden rounded-[3px] border border-line px-4 pb-4 pt-5 text-center">
          <div className="mono-label relative">Wallet</div>
          <div className="display relative mt-2 text-[26px] text-text">Set up your trading wallet</div>
          <p className="relative mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-text-3">Keys are generated and encrypted on this device. Claudio never sees them.</p>
          <ActionButton
            className="relative mt-4 w-full"
            onClick={() => {
              onNavigate?.();
              openWalletPrompt();
            }}
          >
            <Plus /> Create wallet
          </ActionButton>
        </div>
        <InjectedButtons compact layout="list" onConnected={onNavigate} />
      </div>
    );
  }

  return (
    <div className={cn("grid gap-2 p-1", className)}>
      <div className="flex items-center justify-between gap-2 rounded-[3px] px-1.5 py-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] ring-1",
              !hasLocal ? "bg-info-bg text-info ring-info/25" : unlocked ? "bg-buy-bg text-buy ring-buy/25" : "bg-panel-3 text-text-3 ring-line-2",
            )}
          >
            {!hasLocal ? <Plug className="h-4 w-4" /> : unlocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </span>
          {hasLocal ? (
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] font-bold">{unlocked ? "Unlocked" : "Locked"}</span>
              <span className="block truncate text-[11px] text-text-3">{unlocked ? `Auto-lock ${autoLockMin}m · keys in memory` : "Keys encrypted on this device"}</span>
            </span>
          ) : (
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] font-bold">Browser wallet</span>
              <span className="block truncate text-[11px] text-text-3">Signs in your extension or phone</span>
            </span>
          )}
        </div>
        {hasLocal &&
          (unlocked ? (
            <button
              type="button"
              onClick={() => {
                haptic();
                lock("manual");
              }}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-text-2 outline-none ring-1 ring-inset ring-line-2 transition-colors hover:bg-panel-2 hover:text-text focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <Lock className="h-3.5 w-3.5" /> Lock
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                openWalletPrompt();
              }}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[3px] bg-brand px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-brand-ink outline-none transition-colors hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <LockOpen className="h-3.5 w-3.5" /> Unlock
            </button>
          ))}
      </div>

      {(["svm", "evm"] as ChainKind[]).map((k, i) => (
        <ActiveCard key={k} kind={k} index={i} />
      ))}

      {!hasInjected && (
        <details className="group rounded-[3px] border border-line px-3">
          <summary className="flex h-11 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
            <Plug className="h-3.5 w-3.5 text-text-3" /> Connect a browser wallet
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-text-3 transition group-open:rotate-180" />
          </summary>
          <div className="pb-3">
            <InjectedButtons />
          </div>
        </details>
      )}

      <div className="mt-0.5 grid grid-cols-2 gap-2 border-t border-line pt-2.5">
        <Link
          href="/wallets"
          onClick={onNavigate}
          className="btn btn-secondary h-11 gap-1.5 px-2 md:h-10"
        >
          <Wallet className="h-4 w-4 text-text-2" /> Manage <ArrowRight className="h-3.5 w-3.5 opacity-60" />
        </Link>
        <Link
          href="/portfolio"
          onClick={onNavigate}
          className="btn btn-secondary h-11 gap-1.5 px-2 md:h-10"
        >
          <PieChart className="h-4 w-4 text-text-2" /> Portfolio
        </Link>
      </div>
    </div>
  );
}

/** Ready-made top-bar wallet button: popover on desktop, bottom sheet on phones. */
export function WalletButton({ className }: { className?: string }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const evm = useActiveAccount("evm");
  const sol = useActiveAccount("svm");
  const unlocked = useWallet((s) => s.unlocked);
  const primary = sol ?? evm;
  const locked = !!primary && primary.source === "local" && !unlocked;

  const trigger = (
    <button
      type="button"
      onClick={mobile ? () => setOpen(true) : undefined}
      className={cn(
        "flex h-9 items-center gap-2 rounded-[3px] bg-panel pl-1.5 pr-2.5 text-xs font-semibold ring-1 ring-line transition hover:ring-line-2",
        className,
      )}
      aria-label="Wallet"
    >
      {primary ? <AddressOrb address={primary.address} size={22} /> : <Wallet className="ml-1 h-4 w-4 text-brand" />}
      <span className="num hidden xs:inline">{primary ? shortAddr(primary.address) : "Wallet"}</span>
      {locked && <Lock className="h-3.5 w-3.5 text-text-3" />}
    </button>
  );

  if (mobile) {
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
