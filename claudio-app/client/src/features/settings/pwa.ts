// PWA install support. Imported early (by WalletHost) so `beforeinstallprompt` isn't missed.

import { create } from "zustand";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

interface PwaState {
  canInstall: boolean;
  installed: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export const usePwa = create<PwaState>(() => ({ canInstall: false, installed: isStandalone() }));

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    usePwa.setState({ canInstall: false, installed: true });
  });
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  usePwa.setState({ canInstall: false });
  await ev.prompt();
  const choice = await ev.userChoice;
  return choice.outcome === "accepted";
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}
