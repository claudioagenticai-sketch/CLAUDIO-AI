// Reactive (public) wallet state. Contains NO secrets — only addresses, labels and flags.
// Decrypted keys live exclusively in keystore.ts' module-scoped Map.

import { create } from "zustand";
import type { ChainKind } from "@shared/chains";
import type { WalletAccount, WalletState } from "./index";

export type LockReason = "idle" | "hidden" | "manual" | "other-tab" | "changed" | "reset";

export interface WalletStore extends WalletState {
  /** Public account list loaded from IndexedDB. */
  hydrated: boolean;
  /** IndexedDB unavailable (private mode, blocked storage). */
  storageError?: string;
  /** Account ids the user has exported/backed up (or imported from elsewhere). */
  backedUp: Record<string, boolean>;
  autoLockMin: number;
  lockedReason?: LockReason;
  lockedAt?: number;
  unlockedAt?: number;
}

export const DEFAULT_AUTOLOCK_MIN = 15;
export const AUTOLOCK_KEY = "claudio.wallet.autolock";

function readAutoLock(): number {
  try {
    const n = Number(localStorage.getItem(AUTOLOCK_KEY));
    return Number.isFinite(n) && n >= 1 && n <= 240 ? n : DEFAULT_AUTOLOCK_MIN;
  } catch {
    return DEFAULT_AUTOLOCK_MIN;
  }
}

export const useWallet = create<WalletStore>(() => ({
  initialized: false,
  unlocked: false,
  accounts: [],
  active: {},
  hydrated: false,
  backedUp: {},
  autoLockMin: typeof window === "undefined" ? DEFAULT_AUTOLOCK_MIN : readAutoLock(),
}));

// ─── Unlock / setup prompt (rendered by features/wallet/WalletHost) ─

export interface PromptStore {
  open: boolean;
  reason?: string;
}

export const useWalletPrompt = create<PromptStore>(() => ({ open: false }));

/** Active account for a chain family (snapshot, non-reactive). */
export function getActiveAccount(kind: ChainKind): WalletAccount | undefined {
  const s = useWallet.getState();
  const id = s.active[kind];
  return s.accounts.find((a) => a.id === id && a.kind === kind);
}

/** Reactive variant of getActiveAccount for components. */
export function useActiveAccount(kind: ChainKind): WalletAccount | undefined {
  return useWallet((s) => s.accounts.find((a) => a.id === s.active[kind] && a.kind === kind));
}
