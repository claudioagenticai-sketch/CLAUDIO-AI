// Trade implementation behind the `@/lib/trade` contract.
// Flow: POST /api/trade/prepare → PreparedTx[] (unsigned) → wallet.signAndSend (keys never leave the browser)
//       → local history + result with hashes. Nothing is ever reported as success unless the wallet returned hashes.

import { CHAINS } from "@shared/chains";
import type { PreparedTx, TokenSnapshot } from "@shared/types";
import type { TradeQuote, TradeResult } from "./trade";
import { getActiveAccount, requireUnlocked, signAndSend } from "./wallet";
import { haptic, useSettings, type ExecSettings } from "./store";
import { useHistory } from "./history";

/** Quote with optional extras the server attaches (estimate flag, warnings, balance used for %-sells). */
export interface TradeQuoteEx extends TradeQuote {
  estimate?: boolean;
  balanceTokens?: number;
  partialFill?: boolean;
  warnings?: string[];
}

export interface RouteInfo {
  supported: boolean;
  routeId?: string;
  label?: string;
  estimateOnly: boolean;
  site: string;
  message?: string;
}

/** Server-side refusal with a machine code (e.g. "route_unsupported" + launchpad `site`). */
export class TradeApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly site?: string;
  constructor(status: number, code: string, message: string, site?: string) {
    super(message);
    this.name = "TradeApiError";
    this.status = status;
    this.code = code;
    this.site = site;
  }
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  site?: string;
}

async function api<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
  } catch {
    throw new TradeApiError(0, "network", "Can't reach the Claudio server. Check your connection.");
  }
  if (!res.ok) {
    let err: ApiErrorBody = {};
    try {
      err = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new TradeApiError(res.status, err.error ?? "http_error", err.message ?? `Request failed (${res.status})`, err.site);
  }
  return (await res.json()) as T;
}

function activePreset(): ExecSettings {
  const s = useSettings.getState();
  return s.presets[s.activePreset];
}

function traderFor(token: TokenSnapshot): string | undefined {
  return getActiveAccount(CHAINS[token.chain].kind)?.address;
}

// ─── Extra helpers for the token page / trade panel ─────────────────

export function routeInfo(token: TokenSnapshot): Promise<RouteInfo> {
  return api<RouteInfo>("GET", `/api/trade/route/${encodeURIComponent(token.key)}`);
}

export async function tokenBalance(token: TokenSnapshot, owner: string): Promise<number> {
  const r = await api<{ balance: number }>(
    "GET",
    `/api/trade/balance/${encodeURIComponent(token.key)}?owner=${encodeURIComponent(owner)}`,
  );
  return r.balance;
}

/** Like `quote`, but lets the caller pass the trader explicitly and returns the extras. */
export function quoteEx(
  token: TokenSnapshot,
  side: "buy" | "sell",
  amount: number,
  trader?: string,
  slippageBps?: number,
): Promise<TradeQuoteEx> {
  return api<TradeQuoteEx>("POST", "/api/trade/quote", {
    key: token.key,
    side,
    amount,
    trader,
    slippageBps: Math.round(slippageBps ?? activePreset().slippageBps),
  });
}

// ─── Contract exports (signatures fixed by lib/trade.ts) ────────────

/**
 * Buy: `amount` is native (ETH/SOL/BNB) to spend.
 * Sell: `amount` is a percent (0–100] of the active wallet's balance — same unit as `sell(token, pct)`.
 * Throws TradeApiError (e.g. code "route_unsupported" with `site`) when the server can't quote.
 */
export async function quote(token: TokenSnapshot, side: "buy" | "sell", amount: number): Promise<TradeQuote> {
  return quoteEx(token, side, amount, traderFor(token));
}

interface PrepareResponse {
  txs: PreparedTx[];
  quote: TradeQuoteEx;
}

async function execute(
  token: TokenSnapshot,
  side: "buy" | "sell",
  sizing: { amountNative: number } | { pct: number },
): Promise<TradeResult> {
  try {
    await requireUnlocked();
    const account = getActiveAccount(CHAINS[token.chain].kind);
    if (!account) {
      return { ok: false, hashes: [], error: `No active ${CHAINS[token.chain].kind === "svm" ? "Solana" : "EVM"} wallet. Add or select one in Wallets.` };
    }
    const preset = activePreset();
    const prepared = await api<PrepareResponse>("POST", "/api/trade/prepare", {
      key: token.key,
      side,
      ...sizing,
      trader: account.address,
      slippageBps: Math.round(preset.slippageBps),
      priorityFee: preset.priorityFee,
      jitoTip: preset.jitoTip,
      approveMax: preset.autoApprove,
    });
    if (!prepared.txs.length) return { ok: false, hashes: [], error: "Server returned no transactions." };

    const { hashes } = await signAndSend(token.chain, prepared.txs);
    if (!hashes.length) return { ok: false, hashes: [], error: "Wallet didn't return a transaction hash." };

    const q = prepared.quote;
    useHistory.getState().recordTrade({
      id: hashes[hashes.length - 1],
      key: token.key,
      chain: token.chain,
      symbol: token.symbol,
      side,
      wallet: account.address,
      amountNative: side === "buy" ? q.amountIn : q.expectedOut,
      amountToken: side === "buy" ? q.expectedOut : q.amountIn,
      priceUsd: token.priceUsd,
      ts: Date.now(),
      status: "sent",
    });
    haptic(14);
    return { ok: true, hashes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, hashes: [], error: msg || "Trade failed" };
  }
}

/** amountNative: ETH/SOL/BNB to spend. */
export async function buy(token: TokenSnapshot, amountNative: number): Promise<TradeResult> {
  if (!(amountNative > 0)) return { ok: false, hashes: [], error: "Enter an amount greater than zero." };
  return execute(token, "buy", { amountNative });
}

/** pct: 1–100 of the active wallet's token balance. */
export async function sell(token: TokenSnapshot, pct: number): Promise<TradeResult> {
  if (!(pct > 0)) return { ok: false, hashes: [], error: "Choose how much to sell." };
  return execute(token, "sell", { pct: Math.min(100, pct) });
}
