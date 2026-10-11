// ─── MODULE CONTRACT: trade ──────────────────────────────────────────
// Owner: token/trade agent. Cards, token page and hotkeys call these.
// Flow: POST /api/trade/prepare → PreparedTx[] → wallet.signAndSend → toast with explorer link.

import type { TokenSnapshot } from "@shared/types";

export interface TradeQuote {
  amountIn: number; // native for buys, tokens for sells
  expectedOut: number; // tokens for buys, native for sells
  minOut: number;
  priceImpactPct: number;
  feeNative: number;
  taxPct: number;
  route: string; // e.g. "Pons curve", "PumpPortal", "Uniswap v4"
}

export interface TradeResult {
  ok: boolean;
  hashes: string[];
  error?: string;
}

export { buy, sell, quote } from "./trade-impl";
