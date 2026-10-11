// Global wallet host — render once in the Shell: <WalletHost />.
// Hosts the unlock / first-run setup sheet opened by requireUnlocked(), lock notifications,
// and background watchers (tracked-wallet alerts, PWA install capture).

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { ResponsiveSheet } from "@/components/kit";
import { toast } from "@/hooks/use-toast";
import { useWallet, type WalletAccount } from "@/lib/wallet";
import { closeWalletPrompt } from "@/lib/wallet/keystore";
import { useWalletPrompt } from "@/lib/wallet/state";
import TrackerAlerts from "@/features/tracker/TrackerAlerts";
import "@/features/settings/pwa"; // start listening for `beforeinstallprompt` as early as possible
import { CreatedStep, SetupForm, UnlockForm } from "./gate";

export { WalletMenu, WalletButton } from "./WalletMenu";

function useLockNotices() {
  useEffect(
    () =>
      useWallet.subscribe((s, prev) => {
        if (!prev.unlocked || s.unlocked) return;
        if (s.lockedReason === "idle" || s.lockedReason === "hidden") {
          toast({ title: "Wallet locked", description: `Auto-locked after ${s.autoLockMin} min of inactivity. Keys cleared from memory.` });
        } else if (s.lockedReason === "other-tab" || s.lockedReason === "changed") {
          toast({ title: "Wallet locked", description: "Your wallet was changed or locked in another tab." });
        }
      }),
    [],
  );
}

export default function WalletHost() {
  const open = useWalletPrompt((s) => s.open);
  const reason = useWalletPrompt((s) => s.reason);
  const hydrated = useWallet((s) => s.hydrated);
  const initialized = useWallet((s) => s.initialized);
  const unlocked = useWallet((s) => s.unlocked);
  const storageError = useWallet((s) => s.storageError);
  const [created, setCreated] = useState<WalletAccount[] | null>(null);
  const creating = useRef(false);
  const [, navigate] = useLocation();

  useLockNotices();

  // Unlocked elsewhere (another flow) while the sheet is open → settle waiters and close.
  useEffect(() => {
    if (open && unlocked && !creating.current && !created) closeWalletPrompt(true);
  }, [open, unlocked, created]);

  const close = (success?: boolean) => {
    creating.current = false;
    setCreated(null);
    closeWalletPrompt(success);
  };

  const step: "loading" | "created" | "setup" | "unlock" = !hydrated ? "loading" : created ? "created" : !initialized ? "setup" : "unlock";
  const title = step === "created" ? "Wallet ready" : step === "setup" ? "Create your wallet" : "Unlock wallet";
  const description =
    step === "setup"
      ? "A non-custodial trading wallet that lives in this browser."
      : step === "unlock"
        ? "Your keys are encrypted on this device."
        : undefined;

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={(o) => {
          if (!o) close();
        }}
        title={title}
        description={description}
      >
        {storageError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-[3px] border border-line border-l-2 border-l-warn p-3 text-xs leading-relaxed text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Browser storage is unavailable ({storageError}). Private browsing can block it — wallets can't be saved here.</span>
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {step === "loading" && <div className="sheen h-48 rounded-[3px] border border-line" />}
            {step === "unlock" && <UnlockForm reason={reason} onDone={() => close(true)} />}
            {step === "setup" && (
              <SetupForm
                onBeforeCreate={() => {
                  creating.current = true;
                }}
                onCreated={(a) => setCreated(a)}
                onConnected={() => close(true)}
              />
            )}
            {step === "created" && created && (
              <CreatedStep
                accounts={created}
                onDone={() => close(true)}
                onBackup={() => {
                  close(true);
                  navigate("/wallets?backup=1");
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </ResponsiveSheet>
      <TrackerAlerts />
    </>
  );
}
