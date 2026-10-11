// Local trade/launch history (per browser). Trade + launch modules write; portfolio/creator read.
// Stored in localStorage — it's a convenience cache, the chain is the source of truth.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";

export interface HistoryTrade {
  id: string; // tx hash
  key: string; // token key
  chain: ChainId;
  symbol: string;
  side: "buy" | "sell";
  wallet: string;
  amountNative: number; // spent (buy) / received (sell) — estimate at send time
  amountToken: number; // received (buy) / sold (sell) — estimate at send time
  priceUsd: number;
  ts: number;
  status: "sent" | "confirmed" | "failed";
}

export interface HistoryLaunch {
  id: string; // server launch id
  chain: ChainId;
  launchpad: LaunchpadId;
  name: string;
  symbol: string;
  creator: string;
  token?: string;
  splitter?: string;
  hashes: string[];
  ts: number;
}

interface HistoryState {
  trades: HistoryTrade[];
  launches: HistoryLaunch[];
  recordTrade: (t: HistoryTrade) => void;
  updateTrade: (id: string, patch: Partial<HistoryTrade>) => void;
  recordLaunch: (l: HistoryLaunch) => void;
  updateLaunch: (id: string, patch: Partial<HistoryLaunch>) => void;
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      trades: [],
      launches: [],
      recordTrade: (t) => set((s) => ({ trades: [t, ...s.trades].slice(0, 2000) })),
      updateTrade: (id, patch) => set((s) => ({ trades: s.trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      recordLaunch: (l) => set((s) => ({ launches: [l, ...s.launches] })),
      updateLaunch: (id, patch) => set((s) => ({ launches: s.launches.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
    }),
    { name: "claudio.history.v1", storage: createJSONStorage(() => localStorage) },
  ),
);
