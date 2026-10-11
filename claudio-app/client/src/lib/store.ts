// Global client state (zustand).
//  - useBoard: live tokens + trades pushed by the server over WS
//  - useSettings: user preferences, persisted to localStorage
//  - useUI: ephemeral UI state (active chain, open sheets, command palette)

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import type { ChainStatus, ServerMsg, TokenAlert, TokenPhase, TokenSnapshot, Trade } from "@shared/types";
import { socket } from "./ws";

// ─── Board ──────────────────────────────────────────────────────────

const MAX_TRADES_PER_TOKEN = 200;

interface BoardState {
  tokens: Record<string, TokenSnapshot>;
  trades: Record<string, Trade[]>; // by token key, newest first
  status: Record<string, ChainStatus>;
  alerts: { key: string; alert: TokenAlert }[];
  apply: (msg: ServerMsg) => void;
}

export const useBoard = create<BoardState>((set) => ({
  tokens: {},
  trades: {},
  status: {},
  alerts: [],
  apply: (msg) =>
    set((s) => {
      switch (msg.t) {
        case "board": {
          const tokens = { ...s.tokens };
          for (const k of Object.keys(tokens)) if (tokens[k].chain === msg.chain) delete tokens[k];
          for (const tk of msg.tokens) tokens[tk.key] = tk;
          return { tokens };
        }
        case "token":
          return { tokens: { ...s.tokens, [msg.token.key]: msg.token } };
        case "tokens": {
          const tokens = { ...s.tokens };
          for (const tk of msg.tokens) tokens[tk.key] = tk;
          return { tokens };
        }
        case "remove": {
          const tokens = { ...s.tokens };
          for (const k of msg.keys) delete tokens[k];
          return { tokens };
        }
        case "trade":
        case "trades": {
          const list = msg.t === "trade" ? [msg.trade] : msg.trades;
          const trades = { ...s.trades };
          for (const tr of list) {
            const prev = trades[tr.key] ?? [];
            if (prev.some((p) => p.id === tr.id)) continue;
            trades[tr.key] = [tr, ...prev].slice(0, MAX_TRADES_PER_TOKEN);
          }
          return { trades };
        }
        case "status": {
          const status = { ...s.status };
          for (const c of msg.chains) status[c.chain] = c;
          return { status };
        }
        case "alert":
          return { alerts: [{ key: msg.key, alert: msg.alert }, ...s.alerts].slice(0, 100) };
        default:
          return {};
      }
    }),
}));

let wired = false;
/** Call once at app start. */
export function wireSocket() {
  if (wired) return;
  wired = true;
  socket.onMessage((m) => useBoard.getState().apply(m));
  socket.connect();
  socket.subscribe(["status"]);
}

/** Tokens for a board column, sorted for display. */
export function selectColumn(tokens: Record<string, TokenSnapshot>, chain: ChainId, phase: TokenPhase): TokenSnapshot[] {
  const list = Object.values(tokens).filter((t) => t.chain === chain && t.phase === phase);
  if (phase === "new") list.sort((a, b) => b.createdAt - a.createdAt);
  else if (phase === "almost") list.sort((a, b) => b.bondingPct - a.bondingPct);
  else list.sort((a, b) => (b.migratedAt ?? 0) - (a.migratedAt ?? 0));
  return list;
}

// ─── Settings ───────────────────────────────────────────────────────

export type ExecPreset = "P1" | "P2" | "P3";

export interface ExecSettings {
  slippageBps: number;
  priorityFee: number; // SOL priority fee (SOL) / EVM extra gwei
  jitoTip: number; // SOL
  mevProtect: boolean;
  autoApprove: boolean;
}

export interface ColumnFilters {
  launchpads: LaunchpadId[]; // empty = all
  minMcap?: number;
  maxMcap?: number;
  minLiquidity?: number;
  minHolders?: number;
  maxTop10Pct?: number;
  maxDevPct?: number;
  maxSnipersPct?: number;
  maxBundlersPct?: number;
  maxInsidersPct?: number;
  maxAgeMin?: number;
  requireSocials?: boolean;
  requireTwitter?: boolean;
  dexPaidOnly?: boolean;
  stockPairedOnly?: boolean;
  launchedHereOnly?: boolean;
  hideDevSold?: boolean;
  maxTaxBps?: number;
  includeKeywords?: string;
  excludeKeywords?: string;
}

export interface SettingsState {
  chain: ChainId;
  quickBuy: Record<ChainId, number>; // native amount per 1-click buy
  quickBuyPresets: Record<ChainId, number[]>;
  sellPresets: number[]; // percentages
  activePreset: ExecPreset;
  presets: Record<ExecPreset, ExecSettings>;
  filters: Record<TokenPhase, ColumnFilters>;
  pauseOnHover: boolean;
  soundAlerts: boolean;
  haptics: boolean;
  compact: boolean;
  blockedDevs: string[];
  blockedKeywords: string[];
  watchlist: string[]; // token keys
  referralCode?: string;
  set: (patch: Partial<Omit<SettingsState, "set" | "setFilters" | "toggleWatch">>) => void;
  setFilters: (phase: TokenPhase, patch: Partial<ColumnFilters>) => void;
  toggleWatch: (key: string) => void;
}

const defaultExec: ExecSettings = { slippageBps: 1500, priorityFee: 0.001, jitoTip: 0.001, mevProtect: true, autoApprove: true };

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      chain: "sol",
      quickBuy: { hood: 0.01, sol: 0.1, bsc: 0.05, base: 0.01, arc: 10 },
      quickBuyPresets: {
        hood: [0.005, 0.01, 0.05, 0.1, 0.5],
        sol: [0.05, 0.1, 0.5, 1, 2],
        bsc: [0.01, 0.05, 0.1, 0.5, 1],
        base: [0.005, 0.01, 0.05, 0.1, 0.5],
        arc: [5, 10, 50, 100, 500],
      },
      sellPresets: [25, 50, 75, 100],
      activePreset: "P1",
      presets: {
        P1: { ...defaultExec },
        P2: { ...defaultExec, slippageBps: 2500, priorityFee: 0.003, jitoTip: 0.003 },
        P3: { ...defaultExec, slippageBps: 4900, priorityFee: 0.01, jitoTip: 0.01 },
      },
      filters: { new: { launchpads: [] }, almost: { launchpads: [] }, migrated: { launchpads: [] } },
      pauseOnHover: true,
      soundAlerts: false,
      haptics: true,
      compact: false,
      blockedDevs: [],
      blockedKeywords: [],
      watchlist: [],
      set: (patch) => set(patch),
      setFilters: (phase, patch) => set((s) => ({ filters: { ...s.filters, [phase]: { ...s.filters[phase], ...patch } } })),
      toggleWatch: (key) =>
        set((s) => ({ watchlist: s.watchlist.includes(key) ? s.watchlist.filter((k) => k !== key) : [...s.watchlist, key] })),
    }),
    { name: "claudio.settings.v1", storage: createJSONStorage(() => localStorage) },
  ),
);

// ─── UI ─────────────────────────────────────────────────────────────

export type SheetId = null | "launch" | "wallets" | "settings" | "filters" | "trade";

interface UIState {
  paletteOpen: boolean;
  sheet: SheetId;
  sheetData?: unknown;
  /** Mobile board: which column is visible. */
  mobileColumn: TokenPhase;
  setPalette: (open: boolean) => void;
  openSheet: (id: SheetId, data?: unknown) => void;
  setMobileColumn: (c: TokenPhase) => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  sheet: null,
  mobileColumn: "new",
  setPalette: (paletteOpen) => set({ paletteOpen }),
  openSheet: (sheet, sheetData) => set({ sheet, sheetData }),
  setMobileColumn: (mobileColumn) => set({ mobileColumn }),
}));

/** Light haptic tap on supporting phones. */
export function haptic(ms = 8) {
  if (useSettings.getState().haptics && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  }
}
