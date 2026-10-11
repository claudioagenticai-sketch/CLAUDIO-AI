// Per-column board preferences that go beyond the global settings store:
// quick-buy amount override, execution preset override and new-token sound.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChainId } from "@shared/chains";
import type { TokenPhase } from "@shared/types";
import { useSettings, type ExecPreset } from "@/lib/store";

export interface ColumnPrefs {
  /** Native amount per chain; missing = use global settings.quickBuy[chain]. */
  quickBuy: Partial<Record<ChainId, number>>;
  /** Missing = use global settings.activePreset. */
  preset?: ExecPreset;
  /** Blip when a new token enters this column (after filters). */
  sound: boolean;
}

interface BoardPrefsState {
  columns: Record<TokenPhase, ColumnPrefs>;
  setColumn: (phase: TokenPhase, patch: Partial<ColumnPrefs>) => void;
  setColumnQuickBuy: (phase: TokenPhase, chain: ChainId, amount: number | undefined) => void;
}

const emptyCol = (): ColumnPrefs => ({ quickBuy: {}, sound: false });

export const useBoardPrefs = create<BoardPrefsState>()(
  persist(
    (set) => ({
      columns: { new: emptyCol(), almost: emptyCol(), migrated: emptyCol() },
      setColumn: (phase, patch) => set((s) => ({ columns: { ...s.columns, [phase]: { ...s.columns[phase], ...patch } } })),
      setColumnQuickBuy: (phase, chain, amount) =>
        set((s) => {
          const qb: Partial<Record<ChainId, number>> = { ...s.columns[phase].quickBuy };
          if (amount === undefined || !Number.isFinite(amount) || amount <= 0) delete qb[chain];
          else qb[chain] = amount;
          return { columns: { ...s.columns, [phase]: { ...s.columns[phase], quickBuy: qb } } };
        }),
    }),
    { name: "claudio.board.v1", storage: createJSONStorage(() => localStorage) },
  ),
);

/** Effective quick-buy amount for a column on a chain. */
export function useColumnAmount(phase: TokenPhase, chain: ChainId): number {
  const override = useBoardPrefs((s) => s.columns[phase]?.quickBuy?.[chain]);
  const global = useSettings((s) => s.quickBuy[chain]);
  return override ?? global ?? 0;
}

/** Effective execution preset for a column. */
export function useColumnPreset(phase: TokenPhase): ExecPreset {
  const override = useBoardPrefs((s) => s.columns[phase]?.preset);
  const global = useSettings((s) => s.activePreset);
  return override ?? global;
}

export const PHASES: TokenPhase[] = ["new", "almost", "migrated"];

export const PHASE_META: Record<TokenPhase, { title: string; short: string; hint: string }> = {
  new: { title: "New pairs", short: "New", hint: "Fresh launches, newest first" },
  almost: { title: "Almost bonded", short: "Almost", hint: "Closest to graduation first" },
  migrated: { title: "Migrated", short: "Migrated", hint: "Graduated to an AMM pool" },
};
