// Unlock + first-run setup flows shown inside WalletHost's sheet.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, HardDrive, KeyRound, Lock, PlugZap, ShieldCheck, Unlock as UnlockIcon } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/store";
import { useEvmChainsLabel } from "@/lib/platform";
import { BrandMark, CopyAddress } from "@/components/kit";
import { walletLogo } from "@/lib/logos";
import type { WalletAccount } from "@/lib/wallet";
import { MIN_PASSCODE, hasWebCrypto, passcodeStrength } from "@/lib/wallet/crypto";
import { connectInjected, createVault, unlock, unlockCooldown } from "@/lib/wallet/keystore";
import { isUserRejection } from "@/lib/wallet/injected";
import { startDiscovery, useDiscovery, type DiscoveredWallet } from "@/lib/wallet/discovery";
import { POPULAR_WALLETS, isMobileDevice } from "@/lib/wallet/popular";
import { AddressOrb, PasscodeInput, ActionButton, StrengthMeter, kindName, useCountdown } from "./ui";

function useShake() {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const shake = () => {
    haptic(30);
    if (reduce) return;
    void controls.start({ x: [0, -12, 11, -8, 6, -3, 0], transition: { duration: 0.42 } });
  };
  return { controls, shake };
}

/** Retired ornament (concentric rings). Kept as a no-op so older call sites compile; renders nothing. */
export function TargetRings(_props: { className?: string; rings?: number }) {
  return null;
}

function LockHero({ unlocked }: { unlocked?: boolean }) {
  return (
    <div className="relative mx-auto mb-5 flex h-28 w-28 items-center justify-center">
      <TargetRings className="absolute inset-0 h-full w-full text-line-2" />
      <div className="brackets relative flex h-14 w-14 items-center justify-center rounded-[3px] ring-1 ring-inset ring-line-2">
        {unlocked ? <UnlockIcon className="h-6 w-6 text-brand" /> : <Lock className="h-6 w-6 text-brand" />}
      </div>
    </div>
  );
}

// ─── Unlock ─────────────────────────────────────────────────────────

export function UnlockForm({ reason, onDone }: { reason?: string; onDone: () => void }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const { controls, shake } = useShake();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tick, setTick] = useState(0);
  const cooldown = useCountdown(unlockCooldown, [tick]);
  const [, navigate] = useLocation();

  const submit = async () => {
    if (!pass || busy || cooldown > 0) return;
    setBusy(true);
    setErr(null);
    try {
      await unlock(pass);
      setPass("");
      haptic(12);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unlock failed");
      setPass("");
      shake();
      setTick((t) => t + 1);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-2">
      <LockHero />
      <p className="mx-auto mb-5 max-w-[320px] text-center text-sm leading-relaxed text-text-2">
        {reason ? (
          <>
            Unlock to <span className="text-text">{reason.charAt(0).toLowerCase() + reason.slice(1)}</span>
          </>
        ) : (
          "Enter your passcode to decrypt your keys on this device."
        )}
      </p>
      <motion.div animate={controls}>
        <PasscodeInput
          ref={inputRef}
          value={pass}
          onChange={(v) => {
            setPass(v);
            if (err) setErr(null);
          }}
          autoFocus
          invalid={!!err}
          onEnter={submit}
          disabled={cooldown > 0}
        />
      </motion.div>
      <div className="mt-2 min-h-[20px] px-1 text-xs" aria-live="polite">
        {cooldown > 0 ? (
          <span className="text-warn">Too many attempts — wait {Math.ceil(cooldown / 1000)}s</span>
        ) : err ? (
          <span className="text-sell">{err}</span>
        ) : busy ? (
          <span className="text-text-3">Decrypting vault (600k PBKDF2 rounds)…</span>
        ) : null}
      </div>
      <ActionButton className="mt-2 h-12 w-full text-base" onClick={submit} busy={busy} disabled={!pass || cooldown > 0}>
        Unlock
      </ActionButton>
      <button
        type="button"
        className="mx-auto mt-2 flex h-10 items-center px-3 text-xs font-medium text-text-3 underline-offset-4 hover:text-text-2 hover:underline"
        onClick={() => setForgot((f) => !f)}
        aria-expanded={forgot}
      >
        Forgot passcode?
      </button>
      <AnimatePresence initial={false}>
        {forgot && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1 rounded-[3px] border border-line p-3.5 text-xs leading-relaxed text-text-2">
              Claudio never sees your passcode or keys, so nobody can reset it for you. If you exported your keys, you can wipe this wallet
              and import them again under a new passcode.
              <button
                type="button"
                className="mt-2 block font-semibold text-sell hover:underline"
                onClick={() => {
                  onDone();
                  navigate("/wallets#danger");
                }}
              >
                Go to reset →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Setup ──────────────────────────────────────────────────────────

const WALLET_ROW =
  "min-w-0 justify-start gap-2.5 border-line bg-panel-2 px-3 font-semibold normal-case tracking-normal text-text hover:border-line-2 hover:bg-panel-3";

function Tag({ children }: { children: string }) {
  return (
    <span className="ml-auto shrink-0 rounded-[2px] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-text-3 ring-1 ring-inset ring-line-2">{children}</span>
  );
}

/**
 * Every wallet found in this browser (EIP-6963 for EVM, Wallet Standard for Solana, WalletConnect when configured),
 * then Phantom, Solflare, Backpack and MetaMask if they weren't found: on a phone those open Claudio inside the
 * wallet's own browser, on a computer they link to the install page.
 */
export function InjectedButtons({
  onConnected,
  compact,
  layout = "grid",
}: {
  onConnected?: () => void;
  compact?: boolean;
  /** "grid": two columns when there is more than one wallet · "list": one wallet per row. */
  layout?: "grid" | "list";
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const evm = useDiscovery((s) => s.evm);
  const svm = useDiscovery((s) => s.svm);
  const select = useDiscovery((s) => s.select);
  useEffect(() => startDiscovery(), []);
  const all: DiscoveredWallet[] = [...svm, ...evm];
  const mobile = isMobileDevice();
  const found = all.filter((w) => w.id !== "walletconnect").map((w) => w.name.toLowerCase());
  const others = POPULAR_WALLETS.filter((p) => !found.some((n) => n.includes(p.id)));
  const go = async (w: DiscoveredWallet) => {
    const key = `${w.kind}:${w.id}`;
    setBusy(key);
    setErr(null);
    try {
      select(w.kind, w.id);
      await connectInjected(w.kind);
      onConnected?.();
    } catch (e) {
      setErr(isUserRejection(e) ? "Connection rejected" : e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setBusy(null);
    }
  };
  const grid = (n: number) => cn("grid gap-2", layout === "grid" && n > 1 && "grid-cols-2");
  const row = cn(WALLET_ROW, compact && "h-11 text-[13px] md:h-10");
  return (
    <div>
      {all.length > 0 && (
        <div className={grid(all.length)}>
          {all.map((w) => (
            <ActionButton
              key={`${w.kind}:${w.id}`}
              tone="ghost"
              busy={busy === `${w.kind}:${w.id}`}
              onClick={() => go(w)}
              className={row}
              data-wallet={`${w.kind}:${w.id}`}
            >
              <BrandMark src={w.icon ?? walletLogo(w.name)} alt="" size={18} className="rounded-md" fallback={<PlugZap />} />
              <span className="truncate">{w.name}</span>
              <Tag>{w.kind === "evm" ? "EVM" : "SOL"}</Tag>
            </ActionButton>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <>
          <p className={cn("mb-2 text-xs text-text-3", all.length > 0 && "mt-3")}>
            {all.length > 0 ? "Other wallets" : mobile ? "Open Claudio in your wallet app" : "No wallet in this browser yet"}
          </p>
          <div className={grid(others.length)}>
            {others.map((p) => (
              <a
                key={p.id}
                href={mobile ? p.browse(window.location.href) : p.install}
                target={mobile ? undefined : "_blank"}
                rel="noopener noreferrer"
                onClick={() => haptic()}
                className={cn(
                  "inline-flex h-11 items-center rounded-[3px] border text-[13px] transition-colors md:h-10 [&>svg]:h-4 [&>svg]:w-4",
                  row,
                )}
                data-wallet-link={p.id}
              >
                <BrandMark src={p.logo} alt="" size={18} className="rounded-md" fallback={<PlugZap />} />
                <span className="truncate">{p.name}</span>
                <Tag>{mobile ? "Open" : "Get"}</Tag>
              </a>
            ))}
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs text-sell">{err}</p>}
    </div>
  );
}

export function SetupForm({ onBeforeCreate, onCreated, onConnected }: { onBeforeCreate: () => void; onCreated: (a: WalletAccount[]) => void; onConnected: () => void }) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { controls, shake } = useShake();
  const strength = passcodeStrength(pass);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const canCreate = pass.length >= MIN_PASSCODE && confirm === pass && ack && strength.score >= 2 && !busy;
  const cryptoOk = hasWebCrypto();

  const submit = async () => {
    if (!canCreate) {
      if (strength.score < 2 && pass.length >= MIN_PASSCODE) setErr("Pick a stronger passcode");
      else if (mismatch) setErr("Passcodes don't match");
      else if (!ack) setErr("Please confirm you understand");
      shake();
      return;
    }
    setBusy(true);
    setErr(null);
    onBeforeCreate();
    try {
      const accounts = await createVault(pass);
      setPass("");
      setConfirm("");
      haptic(16);
      onCreated(accounts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create wallet");
      shake();
    } finally {
      setBusy(false);
    }
  };

  const points = [
    { icon: <KeyRound />, title: "Keys made on this device", body: "Generated in your browser. Claudio's servers never see them." },
    { icon: <ShieldCheck />, title: "Encrypted with your passcode", body: "AES-256-GCM, key derived with 600,000 PBKDF2 rounds." },
    { icon: <HardDrive />, title: "You are your own bank", body: "No recovery. Export and back up your keys after setup." },
  ];

  return (
    <div className="pb-2">
      <ul className="mb-5 divide-y divide-line overflow-hidden rounded-[3px] border border-line">
        {points.map((p, i) => (
          <motion.li
            key={p.title}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
            className="flex items-start gap-3 px-3.5 py-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center text-text-3 [&>svg]:h-4 [&>svg]:w-4">{p.icon}</span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold">{p.title}</span>
              <span className="block text-xs leading-relaxed text-text-3">{p.body}</span>
            </span>
          </motion.li>
        ))}
      </ul>

      {!cryptoOk && (
        <div className="mb-3 flex items-start gap-2 rounded-[3px] border border-line border-l-2 border-l-sell p-3 text-xs text-sell">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Secure crypto is unavailable. Open Claudio over HTTPS (or localhost) to create a wallet.
        </div>
      )}

      <motion.div animate={controls} className="grid gap-2">
        <label className="eyebrow" htmlFor="new-passcode">
          Create passcode
        </label>
        <PasscodeInput id="new-passcode" value={pass} onChange={setPass} autoFocus autoComplete="new-password" placeholder={`${MIN_PASSCODE}+ characters`} />
        <StrengthMeter value={pass} />
        <PasscodeInput
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          placeholder="Repeat passcode"
          invalid={mismatch}
          onEnter={submit}
        />
      </motion.div>

      <button
        type="button"
        onClick={() => setAck((a) => !a)}
        className={cn(
          "mt-3 flex min-h-[44px] w-full items-start gap-3 rounded-[3px] border p-3 text-left text-xs leading-relaxed transition-colors",
          ack ? "border-brand/40 bg-brand-bg text-text" : "border-line text-text-2 hover:border-line-2 hover:bg-panel-2",
        )}
        aria-pressed={ack}
      >
        <span
          className={cn(
            "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border transition-colors",
            ack ? "border-brand bg-brand text-brand-ink" : "border-line-2 bg-bg",
          )}
        >
          {ack && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        I understand Claudio cannot recover my passcode or keys. If I lose them, my funds are gone.
      </button>

      <div className="min-h-[20px] px-1 pt-1 text-xs text-sell" aria-live="polite">
        {err}
      </div>
      <ActionButton className="mt-1 h-12 w-full text-base" onClick={submit} busy={busy} disabled={!cryptoOk}>
        {busy ? "Encrypting…" : "Create wallet"}
      </ActionButton>

      <div className="eyebrow my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" /> or use a browser wallet <span className="h-px flex-1 bg-line" />
      </div>
      <InjectedButtons onConnected={onConnected} />
    </div>
  );
}

export function CreatedStep({ accounts, onBackup, onDone }: { accounts: WalletAccount[]; onBackup: () => void; onDone: () => void }) {
  const reduce = useReducedMotion();
  const evmChains = useEvmChainsLabel(true);
  useEffect(() => haptic(20), []);
  return (
    <div className="pb-2">
      <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center">
        <TargetRings className="absolute inset-0 h-full w-full text-buy/30" rings={3} />
        <motion.div
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="relative flex h-12 w-12 items-center justify-center rounded-[3px] bg-buy text-buy-ink"
        >
          <Check className="h-6 w-6" strokeWidth={3} />
        </motion.div>
      </div>
      <p className="mb-4 text-center text-sm text-text-2">Your Solana and EVM accounts were created and encrypted on this device.</p>
      <div className="divide-y divide-line overflow-hidden rounded-[3px] border border-line">
        {accounts.map((a, i) => (
          <motion.div
            key={a.id}
            initial={reduce ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
            className="flex items-center gap-3 px-3.5 py-3"
          >
            <AddressOrb address={a.address} kind={a.kind} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{a.label}</div>
              <div className="text-[11px] text-text-3">{kindName(a.kind)} · {a.kind === "evm" ? evmChains : "Solana"}</div>
            </div>
            <CopyAddress address={a.address} />
          </motion.div>
        ))}
      </div>
      <div className="mt-4 flex items-start gap-2.5 rounded-[3px] border border-line border-l-2 border-l-warn p-3 text-xs leading-relaxed text-warn">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Back up now.</b> Clearing browser data, uninstalling the app or losing this device deletes these keys forever.
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <ActionButton tone="soft" onClick={onDone}>
          Later
        </ActionButton>
        <ActionButton onClick={onBackup}>
          <KeyRound /> Back up keys
        </ActionButton>
      </div>
    </div>
  );
}
