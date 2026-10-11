// Launch form draft, persisted to localStorage so a half-finished coin survives reloads and tab switches.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import type { SocialProvider } from "@shared/social";

export interface DraftImage {
  uri: string;
  url: string;
  dev: boolean;
}

export interface LaunchDraft {
  name: string;
  symbol: string;
  /** Ticker follows the name until the user edits it. */
  symbolEdited: boolean;
  description: string;
  image?: DraftImage;
  twitter: string;
  telegram: string;
  website: string;
  postOnX: boolean;
  launchpadByChain: Partial<Record<ChainId, LaunchpadId>>;
  devBuyByChain: Partial<Record<ChainId, number>>;
  taxMode: "none" | "tax";
  buyTaxBps: number;
  sellTaxBps: number;
  taxDurationSec: number;
  mayhem: boolean;
  vanityEnabled: boolean;
  vanitySuffix: string;
  /** Chain the launch page is on (independent of the board's chain; Solana by default). */
  launchChain?: ChainId;
  /**
   * Who gets the creator share: the signing wallet, one of the owner's hosted agents (its Claudio-run wallet),
   * a social account that claims it later, or a split (social options are EVM-only).
   */
  feeTo: "me" | "agent" | "social" | "split";
  /** "Launch with my agent": the hosted agent's slug + name (display only; the server resolves the wallet). */
  agentSlug: string;
  agentName: string;
  /** Split mode: social accounts and their % of the creator share (the launcher keeps the rest). */
  feeShares: DraftFeeShare[];
  feeSocialProvider: SocialProvider;
  feeSocialHandle: string;
  /** Recently uploaded images (library). */
  library: DraftImage[];
}

export interface DraftFeeShare {
  provider: SocialProvider;
  handle: string;
  /** Whole percent of the creator share. */
  pct: number;
}

export function shareTotals(shares: DraftFeeShare[]) {
  const socialPct = shares.reduce((n, s) => n + (Number.isFinite(s.pct) ? s.pct : 0), 0);
  return { socialPct, launcherPct: Math.max(0, 100 - socialPct) };
}

interface DraftStore extends LaunchDraft {
  patch: (p: Partial<LaunchDraft>) => void;
  setName: (name: string) => void;
  setSymbol: (symbol: string) => void;
  addToLibrary: (img: DraftImage) => void;
  resetCoin: () => void;
}

export const TICKER_RE = /[^A-Z0-9]/g;

/** "Pepe the Frog" → "PEPETHEFROG" (A–Z0–9, uppercase, clipped). */
export function deriveTicker(name: string, max = 10): string {
  const words = name
    .normalize("NFKD")
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(TICKER_RE, ""))
    .filter(Boolean);
  if (!words.length) return "";
  const joined = words.join("");
  if (joined.length <= max) return joined;
  // Long names: first word if it's meaningful, otherwise initials.
  return words[0].length >= 3 ? words[0].slice(0, max) : words.map((w) => w[0]).join("").slice(0, max);
}

/**
 * Ticker as typed: NFKC, uppercased, spaces and a leading "$" dropped. Never truncated and other characters are kept,
 * so the field can say what's wrong (normalizeTicker in shared/platform.ts is the rule the server enforces).
 */
export function cleanTicker(v: string): string {
  return v.normalize("NFKC").toUpperCase().replace(/\s+/g, "").replace(/^\$+/, "");
}

const EMPTY_COIN: Pick<
  LaunchDraft,
  "name" | "symbol" | "symbolEdited" | "description" | "image" | "twitter" | "telegram" | "website" | "vanityEnabled"
> = {
  name: "",
  symbol: "",
  symbolEdited: false,
  description: "",
  image: undefined,
  twitter: "",
  telegram: "",
  website: "",
  vanityEnabled: false,
};

export const useLaunchDraft = create<DraftStore>()(
  persist(
    (set) => ({
      ...EMPTY_COIN,
      postOnX: true,
      launchpadByChain: { hood: "pons", sol: "pump" },
      devBuyByChain: {},
      taxMode: "none",
      buyTaxBps: 300,
      sellTaxBps: 300,
      taxDurationSec: 0,
      mayhem: false,
      vanitySuffix: "pump",
      feeTo: "me",
      agentSlug: "",
      agentName: "",
      feeSocialProvider: "x",
      feeSocialHandle: "",
      feeShares: [],
      library: [],
      patch: (p) => set(p),
      setName: (name) =>
        set((s) => (s.symbolEdited ? { name } : { name, symbol: deriveTicker(name) })),
      setSymbol: (symbol) => set({ symbol: cleanTicker(symbol), symbolEdited: symbol.length > 0 }),
      addToLibrary: (img) =>
        set((s) => ({ library: [img, ...s.library.filter((x) => x.url !== img.url)].slice(0, 12) })),
      resetCoin: () => set({ ...EMPTY_COIN }),
    }),
    {
      // Storage key kept from before the rebrand so saved drafts survive.
      name: "claudio.launch.draft.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => {
        const { patch: _p, setName: _n, setSymbol: _s, addToLibrary: _a, resetCoin: _r, ...rest } = s;
        return rest;
      },
    },
  ),
);
