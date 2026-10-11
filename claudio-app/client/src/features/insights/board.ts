// Optional GMGN fields the board may carry on top of TokenSnapshot (see docs/API.md: "/api/board cards carry GMGN's
// sniper / bundler / insider / fresh / dev / social numbers"). All optional: cards show "—" when a number is unknown.
// Percentages follow the board convention (0–100), like snipersPct.
import type { TokenSnapshot } from "@shared/types";

export interface BoardInsightFields {
  botPct?: number | null;
  ratPct?: number | null;
  /** Distinct KOL / smart-money wallets holding or trading (GMGN counts; the board's kolBuys / smartBuys are our own). */
  kolCount?: number | null;
  smartCount?: number | null;
  xFollowers?: number | null;
  dexBoost?: boolean | null;
  dexAd?: boolean | null;
  cto?: boolean | null;
  rugRatio?: number | null; // 0–1
  /** Set when holder analytics are known for this card (any source); without it zeros read as "unknown". */
  analyticsAt?: number | null;
}

export type BoardToken = Omit<TokenSnapshot, keyof BoardInsightFields> & BoardInsightFields;

/**
 * Reads the GMGN enrichment the server puts on board tokens (server/insights/normalize.ts):
 * gmgnAt → analyticsAt, devRugRatio → rugRatio, dexBoost (paid amount) → boolean, KOL / smart-money wallet counts
 * arrive in kolBuys / smartBuys. Explicit insight fields win when present.
 */
export function boardExtras(t: TokenSnapshot): BoardInsightFields {
  const x = t as unknown as Omit<BoardToken, "dexBoost"> & { gmgnAt?: number; devRugRatio?: number; kolBuys?: number; smartBuys?: number; dexBoost?: number | boolean | null };
  const boost = x.dexBoost;
  return {
    botPct: x.botPct ?? null,
    ratPct: x.ratPct ?? null,
    kolCount: x.kolCount ?? (x.gmgnAt ? x.kolBuys : null) ?? null,
    smartCount: x.smartCount ?? (x.gmgnAt ? x.smartBuys : null) ?? null,
    xFollowers: x.xFollowers ?? null,
    dexBoost: typeof boost === "boolean" ? boost : typeof boost === "number" ? boost > 0 : null,
    dexAd: x.dexAd ?? null,
    cto: x.cto ?? null,
    rugRatio: x.rugRatio ?? x.devRugRatio ?? null,
    analyticsAt: x.analyticsAt ?? x.gmgnAt ?? null,
  };
}
