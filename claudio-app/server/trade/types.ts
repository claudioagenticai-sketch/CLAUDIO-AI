// Trade route contracts (server side). A route turns a token snapshot + user intent into a quote and
// unsigned transactions. New venues plug in by adding a TradeRouteBuilder to ./routes.ts.

import type { PreparedTx, TokenSnapshot } from "@shared/types";

/** Mirrors client/src/lib/trade.ts TradeQuote (kept structurally identical; the server can't import client code). */
export interface TradeQuote {
  amountIn: number; // native for buys, tokens for sells
  expectedOut: number; // tokens for buys, native for sells
  minOut: number;
  priceImpactPct: number;
  feeNative: number;
  taxPct: number;
  route: string;
}

/** Extra, optional context returned alongside a quote. Clients that only know TradeQuote ignore these. */
export interface TradeQuoteEx extends TradeQuote {
  /** True when the numbers are an off-chain approximation (e.g. from a price snapshot). */
  estimate: boolean;
  /** Trader's token balance used for a %-sell (human units). */
  balanceTokens?: number;
  /** Buy was larger than what's left on the curve: it will partially fill and refund the rest. */
  partialFill?: boolean;
  warnings: string[];
}

export interface QuoteInput {
  token: TokenSnapshot;
  side: "buy" | "sell";
  /** Buy: native amount. Sell: percent (0–100] of the trader's balance. */
  amount: number;
  trader?: string;
  slippageBps: number;
}

export interface PrepareInput {
  token: TokenSnapshot;
  side: "buy" | "sell";
  amountNative?: number;
  pct?: number;
  trader: string;
  slippageBps: number;
  priorityFee: number;
  jitoTip: number;
  approveMax: boolean;
}

export interface PreparedTrade {
  txs: PreparedTx[];
  quote: TradeQuoteEx;
}

export interface TradeRouteBuilder {
  id: string;
  /** Human label, e.g. "Pons curve". */
  label: string;
  matches(token: TokenSnapshot): boolean;
  quote(input: QuoteInput): Promise<TradeQuoteEx>;
  prepare(input: PrepareInput): Promise<PreparedTrade>;
}

/** Error with an HTTP status + machine code that routes/trade.ts serializes as `{ error, message, site? }`. */
export class TradeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly site?: string;
  constructor(status: number, code: string, message: string, site?: string) {
    super(message);
    this.name = "TradeError";
    this.status = status;
    this.code = code;
    this.site = site;
  }
}
