// Wallets — manage the non-custodial keystore: accounts, balances, import/export, deposit, security.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  Clock,
  Download,
  ExternalLink,
  KeyRound,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { Age, ChainBadge, ChainLogo, CopyAddress } from "@/components/kit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CHAINS, type ChainKind } from "@shared/chains";
import { requireUnlocked, useWallet, type WalletAccount } from "@/lib/wallet";
import {
  disconnectInjected,
  generateAccount,
  lock,
  msUntilAutoLock,
  openWalletPrompt,
  removeAccount,
  renameAccount,
  resetWallet,
  setActive,
  setAutoLockMinutes,
} from "@/lib/wallet/keystore";
import { useEvmChainsLabel } from "@/lib/platform";
import { useDiscovery } from "@/lib/wallet/discovery";
import { AddressOrb, Card, NativeBalance, Page, PageHeader, ActionButton, chainsForKind, kindName, useCountdown } from "@/features/wallet/ui";
import { InjectedButtons } from "@/features/wallet/gate";
import { PillChoice } from "@/features/settings/fields";
import { ChangePasscodeSheet, DepositSheet, ExportSheet, ImportSheet } from "@/features/wallet/sheets";

const AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60, 240];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

/** Runs `fn` after making sure the vault is unlocked; swallows "cancelled". */
async function withUnlock(fn: () => Promise<void>, reason: string): Promise<void> {
  try {
    await requireUnlocked(reason);
  } catch {
    return;
  }
  try {
    await fn();
  } catch (e) {
    toast({ title: "Wallet", description: errMsg(e), variant: "destructive" });
  }
}

// ─── Inline rename ──────────────────────────────────────────────────

function InlineLabel({ account }: { account: WalletAccount }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(account.label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setVal(account.label), [account.label]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  const save = () => {
    setEditing(false);
    const v = val.trim();
    if (v && v !== account.label) void renameAccount(account.id, v);
    else setVal(account.label);
  };
  if (editing) {
    return (
      <input
        ref={ref}
        value={val}
        maxLength={32}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setVal(account.label);
            setEditing(false);
          }
        }}
        className="h-8 w-full max-w-[220px] rounded-[3px] border border-brand bg-bg px-2 text-sm font-bold outline-none ring-1 ring-brand"
        aria-label="Account label"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex min-h-[32px] max-w-full items-center gap-1.5 truncate text-left text-[15px] font-semibold tracking-tight transition-colors hover:text-text-2"
      title="Rename"
    >
      <span className="truncate">{account.label}</span>
      <Pencil className="h-3 w-3 shrink-0 text-text-3 opacity-60 group-hover:opacity-100" />
    </button>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────

function fmtLock(m: number): string {
  return m >= 60 ? `${m / 60}h` : `${m}m`;
}

/** Eyebrow label with a hairline running to the right edge. */
function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3", className)}>
      <h2 className="mono-label flex items-center gap-3 !text-text-2">
        <span className="shrink-0">{children}</span>
        <span className="h-px min-w-0 flex-1 bg-line" aria-hidden />
      </h2>
    </div>
  );
}

const actionCls =
  "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[3px] px-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-text-2 transition-colors hover:bg-panel-2 hover:text-text md:h-9 [&>svg]:h-3.5 [&>svg]:w-3.5";

// ─── Account card ───────────────────────────────────────────────────

function AccountCard({
  account,
  isActive,
  backedUp,
  onDeposit,
  onExport,
  onRemove,
  index,
}: {
  account: WalletAccount;
  isActive: boolean;
  backedUp: boolean;
  onDeposit: () => void;
  onExport: () => void;
  onRemove: () => void;
  index: number;
}) {
  const reduce = useReducedMotion();
  const local = account.source === "local";
  const chains = chainsForKind(account.kind);
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className={cn("overflow-hidden rounded-[4px]", isActive ? "panel-accent" : "panel transition-colors hover:border-line-2")}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <AddressOrb address={account.address} kind={account.kind} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <InlineLabel account={account} />
            {isActive && (
              <span className="chip text-text">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Active
              </span>
            )}
            {!local && <span className="chip chip-info">Browser</span>}
            {local && !backedUp && <span className="chip chip-warn">Not backed up</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-3">
            <CopyAddress address={account.address} head={6} tail={6} />
            <span aria-hidden>·</span>
            <Age from={account.createdAt} className="text-text-3" />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="-mr-1.5 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] text-text-3 transition-colors hover:bg-panel-2 hover:text-text md:h-9 md:w-9"
              aria-label="More"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-[4px] border-line-2 bg-panel">
            <DropdownMenuItem className="min-h-[40px] rounded-[3px]" onSelect={() => window.open(explorerFor(account), "_blank", "noopener,noreferrer")}>
              <ExternalLink className="mr-2 h-4 w-4" /> View on explorer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-[40px] rounded-[3px] text-sell focus:bg-sell-bg focus:text-sell" onSelect={onRemove}>
              <Trash2 className="mr-2 h-4 w-4" /> {local ? "Remove account" : "Disconnect"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("grid gap-2 px-4", chains.length > 1 && "grid-cols-2")}>
        {chains.map((c) => (
          <div key={c} className="rounded-[3px] px-3 py-2.5 ring-1 ring-inset ring-line">
            <ChainBadge chain={c} label className="text-[10.5px]" />
            <NativeBalance chain={c} address={account.address} showChain={false} className="mt-1 flex text-[15px] font-medium" />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1 border-t border-line p-1.5">
        {!isActive && (
          <button
            type="button"
            onClick={() => {
              haptic();
              void setActive(account.kind, account.id);
            }}
            className={actionCls}
          >
            <Star /> Use
          </button>
        )}
        <button type="button" onClick={onDeposit} className={actionCls}>
          <ArrowDownToLine /> Deposit
        </button>
        {local && (
          <button type="button" onClick={onExport} className={actionCls}>
            <KeyRound /> Export
          </button>
        )}
      </div>
    </motion.li>
  );
}

function explorerFor(a: WalletAccount): string {
  return a.kind === "evm" ? CHAINS.hood.explorerAddress(a.address) : CHAINS.sol.explorerAddress(a.address);
}

// ─── Column per chain family ────────────────────────────────────────

function AccountColumn({
  kind,
  onCreate,
  onImport,
  onDeposit,
  onExport,
  onRemove,
}: {
  kind: ChainKind;
  onCreate: () => void;
  onImport: () => void;
  onDeposit: (a: WalletAccount) => void;
  onExport: (a: WalletAccount) => void;
  onRemove: (a: WalletAccount) => void;
}) {
  const accounts = useWallet((s) => s.accounts);
  const activeId = useWallet((s) => s.active[kind]);
  const backedUp = useWallet((s) => s.backedUp);
  const list = accounts.filter((a) => a.kind === kind);
  const evmChains = useEvmChainsLabel();
  return (
    <section className="min-w-0">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 -space-x-1.5">
            {chainsForKind(kind).map((c) => (
              <span key={c} className="inline-flex rounded-full bg-bg p-0.5 ring-1 ring-line-2">
                <ChainLogo chain={c} size={20} />
              </span>
            ))}
          </div>
          <div className="min-w-0">
            <h3 className="flex items-baseline gap-2">
              <span className="display text-[24px] text-text">{kindName(kind)}</span>
              <span className="num text-xs font-medium text-text-3">{list.length}</span>
            </h3>
            <p className="truncate text-xs text-text-3">{kind === "evm" ? evmChains : "Solana mainnet"}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onImport}
            className="btn btn-ghost h-9 gap-1.5 px-2.5 text-[11px] ring-1 ring-inset ring-line"
          >
            <Download className="h-3.5 w-3.5" /> Import
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="btn btn-secondary h-9 gap-1.5 px-2.5 text-[11px]"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
      </header>
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-[3px] border border-dashed border-line-2 px-6 py-8 text-center">
          <div className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-text-2">No {kindName(kind)} accounts</div>
          <div className="max-w-xs text-xs leading-relaxed text-text-3">Create a fresh one or import an existing key.</div>
        </div>
      ) : (
        <ul className="grid gap-3">
          <AnimatePresence initial={false}>
            {list.map((a, i) => (
              <AccountCard
                key={a.id}
                index={i}
                account={a}
                isActive={a.id === activeId}
                backedUp={a.source === "injected" || !!backedUp[a.id]}
                onDeposit={() => onDeposit(a)}
                onExport={() => onExport(a)}
                onRemove={() => onRemove(a)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

// ─── Vault status ───────────────────────────────────────────────────

function VaultBar() {
  const initialized = useWallet((s) => s.initialized);
  const unlocked = useWallet((s) => s.unlocked);
  const autoLockMin = useWallet((s) => s.autoLockMin);
  const accounts = useWallet((s) => s.accounts);
  const backedUp = useWallet((s) => s.backedUp);
  const left = useCountdown(msUntilAutoLock, [unlocked, autoLockMin]);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const local = accounts.filter((a) => a.source === "local");
  const backed = local.filter((a) => backedUp[a.id]).length;
  const browser = accounts.length - local.length;

  const tone = !initialized ? "info" : unlocked ? "open" : "shut";
  return (
    <div className="panel mb-8 flex flex-col gap-4 p-4 md:flex-row md:items-center md:gap-6 md:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span
          className={cn(
            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] ring-1 [&>svg]:h-5 [&>svg]:w-5",
            tone === "open" && "bg-buy-bg text-buy ring-buy/25",
            tone === "shut" && "text-text-2 ring-line-2",
            tone === "info" && "bg-info-bg text-info ring-info/25",
          )}
        >
          {tone === "info" ? <Plug /> : tone === "open" ? <LockOpen /> : <Lock />}
          {tone === "open" && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse-dot rounded-full bg-buy ring-2 ring-panel" />}
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[12px] font-medium uppercase tracking-[0.12em]">{!initialized ? "Browser wallet only" : unlocked ? "Vault unlocked" : "Vault locked"}</div>
          <div className="text-xs leading-relaxed text-text-3">
            {!initialized ? (
              "No Claudio vault on this device yet — your connected wallet signs every trade."
            ) : unlocked ? (
              <>
                Auto-locks in{" "}
                <span className="num font-semibold text-text-2">
                  {mm}:{String(ss).padStart(2, "0")}
                </span>{" "}
                · after {fmtLock(autoLockMin)} idle
              </>
            ) : (
              "Keys are encrypted at rest. Unlock to trade or manage accounts."
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 md:flex md:gap-7">
        {[
          { k: "Accounts", v: String(accounts.length), warn: false },
          { k: "Backed up", v: `${backed}/${local.length}`, warn: backed < local.length },
          { k: "Browser", v: String(browser), warn: false },
        ].map((x) => (
          <div key={x.k} className="rounded-[3px] px-3 py-2 ring-1 ring-inset ring-line md:p-0 md:ring-0">
            <dt className="eyebrow">{x.k}</dt>
            <dd className={cn("num mt-0.5 text-[15px] font-medium", x.warn ? "text-warn" : "text-text")}>{x.v}</dd>
          </div>
        ))}
      </dl>

      <div className="md:pl-1">
        {initialized ? (
          unlocked ? (
            <ActionButton
              tone="ghost"
              className="w-full md:w-auto"
              onClick={() => {
                haptic();
                lock("manual");
              }}
            >
              <Lock /> Lock now
            </ActionButton>
          ) : (
            <ActionButton className="w-full md:w-auto" onClick={() => openWalletPrompt()}>
              <LockOpen /> Unlock
            </ActionButton>
          )
        ) : (
          <ActionButton className="w-full md:w-auto" onClick={() => openWalletPrompt()}>
            <Plus /> Create Claudio wallet
          </ActionButton>
        )}
      </div>
    </div>
  );
}

// ─── Security cards ─────────────────────────────────────────────────

const PROTECTIONS = [
  { t: "Keys never leave this device", d: "Generated and signed in your browser. The Claudio server only ever receives signed transactions." },
  { t: "Encrypted at rest", d: "AES-256-GCM vault in IndexedDB. Key derived from your passcode with 600k PBKDF2-SHA256 rounds." },
  { t: "Wiped from memory on lock", d: "Locking (or auto-lock) drops every decrypted key and the vault key." },
  { t: "No recovery", d: "Nobody — including us — can reset your passcode. Export and store your keys offline." },
];

function SecurityExplainer() {
  return (
    <Card title="How your keys are protected" icon={<ShieldCheck />}>
      <ul className="grid gap-3.5">
        {PROTECTIONS.map((i) => (
          <li key={i.t} className="flex gap-2.5">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-buy ring-1 ring-inset ring-buy/40">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span>
              <span className="block text-[13px] font-semibold">{i.t}</span>
              <span className="block text-xs leading-relaxed text-text-3">{i.d}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BrowserWallets() {
  const accounts = useWallet((s) => s.accounts);
  const injected = accounts.filter((a) => a.source === "injected");
  const hasAny = useDiscovery((st) => st.evm.length + st.svm.length) > 0;
  return (
    <Card title="Browser wallets" icon={<Plug />}>
      {injected.length > 0 && (
        <ul className="mb-3 grid gap-2">
          {injected.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 rounded-[3px] p-2 pl-2.5 ring-1 ring-inset ring-line">
              <AddressOrb address={a.address} size={28} kind={a.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{a.label}</div>
                <CopyAddress address={a.address} />
              </div>
              <button
                type="button"
                onClick={() => void disconnectInjected(a.kind)}
                className="h-9 rounded-[3px] px-2.5 text-xs font-semibold text-text-3 transition-colors hover:bg-sell-bg hover:text-sell"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-3 text-xs leading-relaxed text-text-3">
        {hasAny
          ? "Sign with Phantom, Solflare or Backpack (or MetaMask and Rabby for EVM) instead of the built-in keystore."
          : "No wallet in this browser yet. Pick one below: on a phone it opens Claudio inside the wallet app."}
      </p>
      <InjectedButtons compact layout="list" />
    </Card>
  );
}

function AutoLockCard({ onChangePass }: { onChangePass: () => void }) {
  const initialized = useWallet((s) => s.initialized);
  const autoLockMin = useWallet((s) => s.autoLockMin);
  return (
    <Card title="Auto-lock" icon={<Clock />}>
      <div className="mono-label mb-2">Lock after idle</div>
      <PillChoice value={autoLockMin} options={AUTOLOCK_OPTIONS} onChange={(m) => setAutoLockMinutes(m)} format={fmtLock} ariaLabel="Auto-lock after idle" />
      <p className="mt-2 text-[11px] leading-relaxed text-text-3">Also locks when the app has been in the background longer than this.</p>
      {initialized && (
        <ActionButton tone="soft" className="mt-4 w-full" onClick={onChangePass}>
          <KeyRound /> Change passcode
        </ActionButton>
      )}
    </Card>
  );
}

function DangerZone() {
  const initialized = useWallet((s) => s.initialized);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!initialized) return null;
  return (
    <section id="danger" className="mt-8 flex scroll-mt-6 flex-col gap-4 rounded-[4px] border border-sell/35 border-l-2 border-l-sell p-4 md:flex-row md:items-center md:gap-6 md:p-5">
      <div className="min-w-0 flex-1">
        <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-sell">Danger zone</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-text-3">
          Permanently deletes the encrypted vault from this browser. Only do this if you've exported every key or forgot your passcode and
          want to start over.
        </p>
      </div>
      <ActionButton tone="danger" className="w-full shrink-0 md:w-auto" onClick={() => setOpen(true)}>
        <Trash2 /> Reset wallet on this device
      </ActionButton>
      <AlertDialog
        open={open}
        onOpenChange={(o: boolean) => {
          setOpen(o);
          if (!o) setTyped("");
        }}
      >
        <AlertDialogContent className="rounded-[4px] border-line-2 bg-bg-elev">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete wallet from this device?</AlertDialogTitle>
            <AlertDialogDescription>
              All local accounts and their keys will be erased. Funds in accounts you haven't backed up will be lost forever. Type{" "}
              <b className="text-text">DELETE</b> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            className="num h-12 w-full rounded-[3px] border border-line-2 bg-bg px-3 text-base tracking-widest outline-none transition-colors focus:border-sell focus:ring-1 focus:ring-sell"
            placeholder="DELETE"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-10">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={typed !== "DELETE"}
              className="h-11 bg-sell text-sell-ink hover:bg-sell md:h-10"
              onClick={() => {
                void resetWallet().then(() => toast({ title: "Wallet erased", description: "The vault was deleted from this device." }));
              }}
            >
              Erase everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ─── Onboarding (no wallet yet) ─────────────────────────────────────

function Choice({
  title,
  body,
  badge,
  accent,
  children,
}: {
  step?: number;
  icon?: ReactNode;
  title: string;
  body: string;
  badge?: ReactNode;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col p-4 md:p-5", accent ? "panel-accent" : "panel")}>
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {badge}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-text-3">{body}</p>
      <div className="mt-auto pt-5">{children}</div>
    </div>
  );
}

function Onboarding({ onImport }: { onImport: (k: ChainKind) => void }) {
  const evmChains = useEvmChainsLabel();
  return (
    <div className="enter">
      <section className="max-w-2xl">
        <div className="flex items-baseline gap-2.5">
          <span className="section-num">01</span>
          <h2 className="display-section text-text">Set up a trading wallet</h2>
        </div>
        <p className="lede mt-3">
          Create an encrypted trading wallet with one Solana account, plus one EVM account for {evmChains}. Trades sign
          instantly without pop-ups — or plug in Phantom instead. Setup takes about a minute.
        </p>
      </section>

      <SectionLabel className="mt-6">Choose how to start</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-3">
        <Choice
          step={1}
          accent
          icon={<Plus />}
          title="Create a Claudio wallet"
          badge={<span className="chip chip-brand">Recommended</span>}
          body="A Solana account (and an EVM one for later), encrypted with a passcode you choose. Trades sign instantly in the app — no wallet pop-ups."
        >
          <ActionButton className="h-12 w-full" onClick={() => openWalletPrompt()}>
            <Plus /> Create wallet
          </ActionButton>
        </Choice>
        <Choice
          step={2}
          icon={<Download />}
          title="Import a private key"
          body="Bring an existing trading key. You'll set a passcode first; the key is encrypted into your vault and never leaves this device."
        >
          <div className="grid grid-cols-2 gap-2">
            <ActionButton tone="soft" onClick={() => onImport("svm")}>
              Solana key
            </ActionButton>
            <ActionButton tone="soft" onClick={() => onImport("evm")}>
              EVM key
            </ActionButton>
          </div>
        </Choice>
        <Choice
          step={3}
          icon={<Plug />}
          title="Connect a wallet"
          body="Sign with Phantom, Solflare or Backpack — or a phone wallet — instead of the built-in keystore. MetaMask and Rabby work for EVM."
        >
          <InjectedButtons compact layout="list" />
        </Choice>
      </div>

      <SectionLabel className="mt-10">How your keys are protected</SectionLabel>
      <ul className="grid gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {PROTECTIONS.map((i) => (
          <li key={i.t} className="bg-bg-elev p-4 md:p-5">
            <div className="text-[13.5px] font-semibold">{i.t}</div>
            <div className="mt-1 text-xs leading-relaxed text-text-3">{i.d}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function Wallets() {
  const hydrated = useWallet((s) => s.hydrated);
  const initialized = useWallet((s) => s.initialized);
  const unlocked = useWallet((s) => s.unlocked);
  const accounts = useWallet((s) => s.accounts);
  const backedUp = useWallet((s) => s.backedUp);
  const search = useSearch();
  const backupFocus = new URLSearchParams(search).get("backup") === "1";

  const [importKind, setImportKind] = useState<ChainKind | null>(null);
  const [exporting, setExporting] = useState<WalletAccount | null>(null);
  const [depositing, setDepositing] = useState<WalletAccount | null>(null);
  const [removing, setRemoving] = useState<WalletAccount | null>(null);
  const [changePass, setChangePass] = useState(false);

  const notBackedUp = accounts.filter((a) => a.source === "local" && !backedUp[a.id]);

  useEffect(() => {
    if (window.location.hash === "#danger") document.getElementById("danger")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hydrated]);

  const create = (kind: ChainKind) =>
    withUnlock(async () => {
      const a = await generateAccount(kind);
      haptic(12);
      toast({ title: "Account created", description: `${a.label} · back it up from Export.` });
    }, `Create a ${kindName(kind)} account`);

  const openImport = (kind: ChainKind) => void withUnlock(async () => setImportKind(kind), "Import a key");

  const confirmRemove = async () => {
    const a = removing;
    setRemoving(null);
    if (!a) return;
    if (a.source === "injected") {
      await removeAccount(a.id);
      return;
    }
    await withUnlock(async () => {
      await removeAccount(a.id);
      toast({ title: "Account removed", description: a.label });
    }, "Remove an account");
  };

  if (!hydrated) {
    return (
      <Page>
        <div className="sheen h-64 rounded-[4px] border border-line bg-bg-elev" />
      </Page>
    );
  }

  const noWallet = !initialized && accounts.length === 0;

  return (
    <Page>
      <PageHeader title="Wallets" icon={<Wallet />} subtitle="Non-custodial · keys are generated, encrypted and used only on this device" />

      {noWallet ? (
        <Onboarding onImport={openImport} />
      ) : (
        <>
          <AnimatePresence>
            {notBackedUp.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    "mb-4 flex flex-col gap-3 rounded-[4px] border border-l-2 border-l-warn p-4 sm:flex-row sm:items-center",
                    backupFocus ? "border-warn ring-1 ring-warn" : "border-line",
                  )}
                >
                  <AlertTriangle className="h-5 w-5 shrink-0 text-warn" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-bold text-warn">
                      {notBackedUp.length === 1 ? "1 account isn't backed up" : `${notBackedUp.length} accounts aren't backed up`}
                    </div>
                    <div className="text-xs leading-relaxed text-text-2">
                      If this browser's data is cleared, these keys — and any funds — are gone. Export each key and store it offline.
                    </div>
                  </div>
                  <ActionButton tone="soft" className="shrink-0" onClick={() => setExporting(notBackedUp[0])}>
                    <KeyRound /> Back up {notBackedUp[0].label}
                  </ActionButton>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <VaultBar />

          <SectionLabel>Accounts</SectionLabel>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-6">
            {(["svm", "evm"] as ChainKind[]).map((k) => (
              <AccountColumn
                key={k}
                kind={k}
                onCreate={() => void create(k)}
                onImport={() => openImport(k)}
                onDeposit={setDepositing}
                onExport={setExporting}
                onRemove={setRemoving}
              />
            ))}
          </div>

          <SectionLabel className="mt-10">Security</SectionLabel>
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AutoLockCard onChangePass={() => void withUnlock(async () => setChangePass(true), "Change passcode")} />
            <BrowserWallets />
            <div className="md:col-span-2 xl:col-span-1">
              <SecurityExplainer />
            </div>
          </div>
          <DangerZone />
        </>
      )}

      <ImportSheet open={importKind !== null} onOpenChange={(o) => !o && setImportKind(null)} defaultKind={importKind ?? "svm"} />
      <ExportSheet account={exporting} onOpenChange={(o) => !o && setExporting(null)} />
      <DepositSheet account={depositing} onOpenChange={(o) => !o && setDepositing(null)} />
      <ChangePasscodeSheet open={changePass} onOpenChange={setChangePass} />

      <AlertDialog open={!!removing} onOpenChange={(o: boolean) => !o && setRemoving(null)}>
        <AlertDialogContent className="rounded-[4px] border-line-2 bg-bg-elev">
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.source === "injected" ? "Disconnect browser wallet?" : `Remove ${removing?.label}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.source === "injected"
                ? "Claudio will stop using this browser wallet as a signer. Your funds stay in that wallet."
                : "The key is deleted from this device's vault. Unless you've exported it, any funds in this account become unrecoverable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removing && removing.source === "local" && !backedUp[removing.id] && (
            <div className="flex items-start gap-2 rounded-[3px] border border-line border-l-2 border-l-sell p-3 text-xs text-sell">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> This account has never been exported.
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-10">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-sell text-sell-ink hover:bg-sell md:h-10" onClick={() => void confirmRemove()}>
              {removing?.source === "injected" ? "Disconnect" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
