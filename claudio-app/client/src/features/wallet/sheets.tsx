// Sheets used by the Wallets page: import, export (re-auth + reveal), deposit, change passcode.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { ResponsiveSheet } from "@/components/kit";
import { CHAINS, type ChainId, type ChainKind } from "@shared/chains";
import { useWallet, type WalletAccount } from "@/lib/wallet";
import { MIN_PASSCODE } from "@/lib/wallet/crypto";
import { parseImport } from "@/lib/wallet/keys";
import { changePasscode, exportSecret, importAccount, markBackedUp } from "@/lib/wallet/keystore";
import { AddressOrb, PasscodeInput, ActionButton, Segmented, StrengthMeter, chainsForKind, kindName } from "./ui";
import { TargetRings } from "./gate";

/** Small uppercase field label used across the wallet sheets. */
function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn("eyebrow mb-1.5 block", className)}>{children}</label>;
}

/** Tinted notice row (warn / danger / info). */
function Notice({ tone, icon, children }: { tone: "warn" | "danger" | "info"; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[3px] border p-3 text-xs leading-relaxed [&>svg]:mt-0.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
        tone === "danger" && "border-sell/25 bg-sell-bg text-sell",
        tone === "warn" && "border-warn/25 bg-warn-bg text-warn",
        tone === "info" && "border-line bg-panel-2 text-text-3 [&>svg]:text-info",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

// ─── Import ─────────────────────────────────────────────────────────

export function ImportSheet({ open, onOpenChange, defaultKind = "svm" }: { open: boolean; onOpenChange: (o: boolean) => void; defaultKind?: ChainKind }) {
  const [kind, setKind] = useState<ChainKind>(defaultKind);
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSecret("");
      setLabel("");
      setErr(null);
    } else setKind(defaultKind);
  }, [open, defaultKind]);

  // Preview the address locally (nothing leaves the browser).
  const preview = useMemo(() => {
    if (!secret.trim()) return null;
    try {
      return { address: parseImport(kind, secret).address, error: null as string | null };
    } catch (e) {
      return { address: null, error: e instanceof Error ? e.message : "Invalid key" };
    }
  }, [kind, secret]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const a = await importAccount(kind, secret, label);
      setSecret("");
      haptic(12);
      toast({ title: "Account imported", description: `${a.label} · ${a.address.slice(0, 6)}…${a.address.slice(-4)}` });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Import account" description="Paste a private key. It's encrypted into your vault and never leaves this device.">
      <div className="grid gap-3 pb-2">
        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k);
            setErr(null);
          }}
          options={[
            { value: "svm", label: "Solana" },
            { value: "evm", label: "EVM" },
          ]}
          className="w-full"
        />
        <div>
          <FieldLabel>Private key</FieldLabel>
          <PasscodeInput
            value={secret}
            onChange={setSecret}
            placeholder={kind === "evm" ? "0x… (64 hex chars)" : "base58 or [12,34,…] byte array"}
            autoComplete="new-password"
            invalid={!!preview?.error}
            onEnter={() => preview?.address && void submit()}
          />
          <div className="mt-1.5 min-h-[20px] text-xs">
            {preview?.error && <span className="text-sell">{preview.error}</span>}
            {preview?.address && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-buy">
                <Check className="h-3.5 w-3.5 shrink-0" /> <span className="num break-all">{preview.address}</span>
              </span>
            )}
          </div>
        </div>
        <div>
          <FieldLabel>Label (optional)</FieldLabel>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={32}
            placeholder={kind === "evm" ? "e.g. Sniper 2" : "e.g. Phantom main"}
            className="h-12 w-full rounded-[3px] border border-line-2 bg-bg px-3 text-base outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand md:text-sm"
          />
        </div>
        <Notice tone="info" icon={<ShieldAlert />}>
          Only import keys for wallets you use for trading. Seed phrases aren't accepted — export the private key from your wallet app.
        </Notice>
        {err && <p className="text-xs text-sell">{err}</p>}
        <ActionButton className="h-12 w-full" onClick={submit} busy={busy} disabled={!preview?.address}>
          <KeyRound /> Import {kindName(kind)} key
        </ActionButton>
      </div>
    </ResponsiveSheet>
  );
}

// ─── Export ─────────────────────────────────────────────────────────

const REVEAL_MS = 60_000;

export function ExportSheet({ account, onOpenChange }: { account: WalletAccount | null; onOpenChange: (o: boolean) => void }) {
  const open = !!account;
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const unlocked = useWallet((s) => s.unlocked);
  const hideTimer = useRef<number | undefined>(undefined);

  const clear = () => {
    setSecret(null);
    setRevealed(false);
    setPass("");
    setCopied(false);
    window.clearTimeout(hideTimer.current);
  };

  // Drop the secret from React state when the sheet closes, the account changes, or the wallet locks.
  useEffect(() => {
    if (!open) {
      clear();
      setErr(null);
      setSaved(false);
    }
  }, [open, account?.id]);
  const prevUnlocked = useRef(unlocked);
  useEffect(() => {
    if (prevUnlocked.current && !unlocked) clear();
    prevUnlocked.current = unlocked;
  }, [unlocked]);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  if (!account) return null;

  const submit = async () => {
    if (!pass) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await exportSecret(account.id, pass);
      setPass("");
      setSecret(s);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(clear, REVEAL_MS);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't export");
      setPass("");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      haptic(10);
      toast({ title: "Key copied", description: "Paste it somewhere safe. We'll try to clear the clipboard in 30s." });
      window.setTimeout(() => {
        // Best effort — browsers only allow this while the page has focus.
        if (document.hasFocus()) void navigator.clipboard.writeText("").catch(() => undefined);
      }, 30_000);
    } catch {
      toast({ title: "Copy failed", description: "Select the key and copy it manually.", variant: "destructive" });
    }
  };

  const confirmSaved = () => {
    setSaved(true);
    void markBackedUp(account.id);
    haptic(12);
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={`Export ${account.label}`} description={`${kindName(account.kind)} private key`}>
      <div className="grid gap-3 pb-2">
        <Notice tone="danger" icon={<AlertTriangle />}>
          Anyone with this key controls this wallet's funds. <b>Claudio will never ask for it</b> — no support agent, bot or website should either.
          Don't screenshot it on a synced device.
        </Notice>

        <AnimatePresence mode="wait" initial={false}>
          {!secret ? (
            <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid gap-2">
              <FieldLabel className="mb-0">Confirm your passcode</FieldLabel>
              <PasscodeInput value={pass} onChange={setPass} autoFocus invalid={!!err} onEnter={submit} />
              <div className="min-h-[18px] text-xs text-sell">{err}</div>
              <ActionButton className="h-12 w-full" busy={busy} disabled={!pass} onClick={submit}>
                <Eye /> Reveal key
              </ActionButton>
            </motion.div>
          ) : (
            <motion.div key="secret" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid gap-3">
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                className="group relative min-h-[88px] w-full overflow-hidden rounded-[3px] border border-dashed border-line-2 bg-bg p-3.5 text-left"
                aria-label={revealed ? "Hide key" : "Reveal key"}
              >
                <div
                  className={cn(
                    "num break-all text-[13px] leading-relaxed text-text transition-[filter] duration-300",
                    revealed ? "select-all" : "select-none blur-md",
                  )}
                  translate="no"
                  data-private
                >
                  {secret}
                </div>
                {!revealed && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="inline-flex items-center gap-2 rounded-[3px] bg-bg px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-text ring-1 ring-inset ring-line-2">
                      <Eye className="h-4 w-4" /> Tap to reveal
                    </span>
                  </span>
                )}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <ActionButton tone="soft" onClick={() => setRevealed((r) => !r)}>
                  {revealed ? <EyeOff /> : <Eye />} {revealed ? "Hide" : "Show"}
                </ActionButton>
                <ActionButton tone="soft" onClick={copy}>
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                </ActionButton>
              </div>
              <p className="text-xs text-text-3">
                {account.kind === "evm"
                  ? "Hex private key — import into MetaMask / Rabby via “Import account → Private key”."
                  : "Base58 secret key — import into Phantom / Backpack via “Add account → Import private key”."}{" "}
                Auto-hides in 60s.
              </p>
              <ActionButton onClick={confirmSaved} disabled={saved} className={cn("h-12 w-full", saved && "bg-buy-bg bg-none text-buy shadow-none disabled:opacity-100")}>
                {saved ? (
                  <>
                    <Check /> Marked as backed up
                  </>
                ) : (
                  "I've saved it somewhere safe"
                )}
              </ActionButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ResponsiveSheet>
  );
}

// ─── Deposit ────────────────────────────────────────────────────────

export function DepositSheet({ account, onOpenChange }: { account: WalletAccount | null; onOpenChange: (o: boolean) => void }) {
  const chains = account ? chainsForKind(account.kind) : [];
  const [chain, setChain] = useState<ChainId>(chains[0] ?? "hood");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (account) setChain(chainsForKind(account.kind)[0] ?? "hood");
    setCopied(false);
  }, [account?.id]);
  if (!account) return null;
  const c = CHAINS[chain];
  const groups = account.address.match(/.{1,4}/g) ?? [account.address];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      haptic(10);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <ResponsiveSheet open={!!account} onOpenChange={onOpenChange} title="Deposit" description={`Send ${c.nativeSymbol} or tokens on ${c.name} to ${account.label}`}>
      <div className="grid gap-4 pb-2">
        {chains.length > 1 && (
          <Segmented value={chain} onChange={setChain} options={chains.map((id) => ({ value: id, label: CHAINS[id].name }))} className="w-full" />
        )}
        <div className="relative overflow-hidden rounded-[4px] border border-line-2 bg-bg p-5">
          <TargetRings className="absolute -bottom-24 -right-16 h-52 w-52 text-line-2" />
          <div className="relative mb-4 flex items-center gap-2.5">
            <AddressOrb address={account.address} kind={account.kind} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{account.label}</span>
              <span className="eyebrow">Deposit address</span>
            </span>
            <span className="chip shrink-0 font-semibold" style={{ color: c.color }}>
              {c.short}
            </span>
          </div>
          <div className="num relative flex flex-wrap gap-x-2 gap-y-1 text-lg leading-snug sm:text-xl" translate="no">
            {groups.map((g, i) => (
              <span key={i} className={i % 2 ? "text-text-2" : "text-text"}>
                {g}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton onClick={copy} className="h-12">
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy address"}
          </ActionButton>
          <a
            href={c.explorerAddress(account.address)}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-secondary h-12"
          >
            <ExternalLink className="h-4 w-4" /> Explorer
          </a>
        </div>
        <Notice tone="warn" icon={<AlertTriangle />}>
          {account.kind === "evm"
            ? `Only send assets on ${c.name} (chain id ${c.evmChainId}). The same address works on every EVM chain, but funds sent on another network stay on that network.`
            : "Only send SOL and SPL tokens on Solana mainnet."}
        </Notice>
      </div>
    </ResponsiveSheet>
  );
}

// ─── Change passcode ────────────────────────────────────────────────

export function ChangePasscodeSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setCur("");
      setNext("");
      setConfirm("");
      setErr(null);
    }
  }, [open]);
  const ok = cur.length > 0 && next.length >= MIN_PASSCODE && next === confirm;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await changePasscode(cur, next);
      toast({ title: "Passcode changed", description: "Your vault was re-encrypted with a new key." });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't change passcode");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Change passcode" description="Re-encrypts your vault with a fresh salt and key.">
      <div className="grid gap-2 pb-2">
        <FieldLabel className="mb-0">Current passcode</FieldLabel>
        <PasscodeInput value={cur} onChange={setCur} autoFocus />
        <FieldLabel className="mb-0 mt-3">New passcode</FieldLabel>
        <PasscodeInput value={next} onChange={setNext} autoComplete="new-password" placeholder={`${MIN_PASSCODE}+ characters`} />
        <StrengthMeter value={next} />
        <PasscodeInput
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          placeholder="Repeat new passcode"
          invalid={confirm.length > 0 && confirm !== next}
          onEnter={submit}
        />
        <div className="min-h-[18px] text-xs text-sell">{err}</div>
        <ActionButton className="h-12 w-full" busy={busy} disabled={!ok} onClick={submit}>
          Update passcode
        </ActionButton>
      </div>
    </ResponsiveSheet>
  );
}
