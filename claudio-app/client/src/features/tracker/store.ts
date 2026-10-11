// Tracked wallets (public addresses only), persisted to localStorage.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChainKind } from "@shared/chains";
import { kindOfAddress, normAddr } from "@/lib/wallet/keys";

export interface TrackedWallet {
  address: string;
  kind: ChainKind;
  label: string;
  emoji: string;
  alerts: boolean; // toast when this wallet trades
  addedAt: number;
}

interface TrackerState {
  wallets: TrackedWallet[];
  add: (w: { address: string; label?: string; emoji?: string }) => TrackedWallet;
  remove: (address: string) => void;
  update: (address: string, patch: Partial<Pick<TrackedWallet, "label" | "emoji" | "alerts">>) => void;
}

export const TRACKER_EMOJIS = ["🐋", "🦈", "🐸", "🧠", "🎯", "🔥", "💎", "🤖", "👑", "🥷", "🦊", "🐂", "🐻", "🚀", "⚡", "👀"];

export const useTracker = create<TrackerState>()(
  persist(
    (set, get) => ({
      wallets: [],
      add: ({ address, label, emoji }) => {
        const addr = address.trim();
        const kind = kindOfAddress(addr);
        if (!kind) throw new Error("Not a valid Solana or EVM address");
        const key = normAddr(addr);
        if (get().wallets.some((w) => normAddr(w.address) === key)) throw new Error("Already tracking this wallet");
        const w: TrackedWallet = {
          address: addr,
          kind,
          label: (label ?? "").trim().slice(0, 24) || `Wallet ${get().wallets.length + 1}`,
          emoji: emoji ?? TRACKER_EMOJIS[get().wallets.length % TRACKER_EMOJIS.length],
          alerts: false,
          addedAt: Date.now(),
        };
        set((s) => ({ wallets: [w, ...s.wallets] }));
        return w;
      },
      remove: (address) => set((s) => ({ wallets: s.wallets.filter((w) => normAddr(w.address) !== normAddr(address)) })),
      update: (address, patch) =>
        set((s) => ({
          wallets: s.wallets.map((w) =>
            normAddr(w.address) === normAddr(address)
              ? { ...w, ...patch, label: patch.label !== undefined ? patch.label.trim().slice(0, 24) || w.label : w.label }
              : w,
          ),
        })),
    }),
    { name: "claudio.tracker.v1", storage: createJSONStorage(() => localStorage) },
  ),
);

/** normalized address → wallet, for O(1) matching against trades. */
export function trackedIndex(wallets: TrackedWallet[]): Map<string, TrackedWallet> {
  return new Map(wallets.map((w) => [normAddr(w.address), w]));
}
