// Native token USD prices (ETH / SOL / BNB). Coinbase spot every 30s, Binance as fallback.
// Values stay at the last good price on failure; 0 means "never fetched" (USD fields then read 0, never guessed).

import type { ChainId } from "@shared/chains";
import { errMsg, ilog, ilogThrottled } from "./log";

type Sym = "ETH" | "SOL" | "BNB";
const SYMS: Sym[] = ["ETH", "SOL", "BNB"];

const SYMBOL_OF: Record<ChainId, Sym | "USD"> = { hood: "ETH", base: "ETH", sol: "SOL", bsc: "BNB", arc: "USD" };

const prices: Record<Sym, number> = { ETH: 0, SOL: 0, BNB: 0 };
const updatedAt: Record<Sym, number> = { ETH: 0, SOL: 0, BNB: 0 };
const listeners = new Set<() => void>();

export function nativeUsdOf(chain: ChainId): number {
  const s = SYMBOL_OF[chain];
  return s === "USD" ? 1 : prices[s];
}

export function priceUpdatedAt(chain: ChainId): number {
  const s = SYMBOL_OF[chain];
  return s === "USD" ? Date.now() : updatedAt[s];
}

export function onPricesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as unknown;
}

async function fromCoinbase(sym: Sym): Promise<number> {
  const j = (await fetchJson(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`)) as { data?: { amount?: string } };
  const n = Number(j?.data?.amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`coinbase ${sym}: bad amount`);
  return n;
}

async function fromBinance(sym: Sym): Promise<number> {
  const j = (await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`)) as { price?: string };
  const n = Number(j?.price);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`binance ${sym}: bad price`);
  return n;
}

async function refreshOne(sym: Sym): Promise<boolean> {
  try {
    prices[sym] = await fromCoinbase(sym);
  } catch (e1) {
    try {
      prices[sym] = await fromBinance(sym);
    } catch (e2) {
      ilogThrottled("prices", `fail:${sym}`, `${sym} price fetch failed (coinbase: ${errMsg(e1)}; binance: ${errMsg(e2)})`, 5 * 60_000);
      return false;
    }
  }
  updatedAt[sym] = Date.now();
  return true;
}

export async function refreshPrices(): Promise<void> {
  const results = await Promise.all(SYMS.map(refreshOne));
  if (results.some(Boolean)) {
    listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* listener errors never break the price loop */
      }
    });
  }
}

let started = false;
export function startPrices(): void {
  if (started) return;
  started = true;
  void refreshPrices().then(() => ilog("prices", `ETH $${prices.ETH.toFixed(2)} · SOL $${prices.SOL.toFixed(2)} · BNB $${prices.BNB.toFixed(2)}`));
  setInterval(() => void refreshPrices(), 30_000).unref();
}
