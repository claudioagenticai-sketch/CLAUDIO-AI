// ─── MODULE CONTRACT: wallet ─────────────────────────────────────────
// Owner: wallet agent. Other modules import ONLY the exports below; keep these signatures stable.
// Non-custodial: keys are generated/imported in the browser, encrypted with the user's passcode,
// and never sent to the server.

import type { ChainId, ChainKind } from "@shared/chains";
import type { PreparedTx } from "@shared/types";

export interface WalletAccount {
  id: string;
  kind: ChainKind; // "evm" accounts work on every EVM chain; "svm" on Solana
  address: string;
  label: string;
  source: "local" | "injected";
  createdAt: number;
}

export interface WalletState {
  /** Keystore exists (user has set a passcode). */
  initialized: boolean;
  /** Keys decrypted in memory. */
  unlocked: boolean;
  accounts: WalletAccount[];
  active: Partial<Record<ChainKind, string>>; // account id per kind
}

export { useWallet, getActiveAccount, signAndSend, useNativeBalance, requireUnlocked } from "./impl";
/** Additive helpers (optional for other modules). */
export { useActiveAccount, openWalletPrompt, SendError } from "./impl";

/** Result of sending prepared txs: one hash/signature per tx, in order. */
export type SendResult = { hashes: string[] };

export type { ChainId, PreparedTx };
