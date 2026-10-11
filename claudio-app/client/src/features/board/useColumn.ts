// Column data: store → selectColumn → filters → cap. Plus helpers shared by desktop/mobile boards.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { ChainId } from "@shared/chains";
import type { TokenPhase, TokenSnapshot } from "@shared/types";
import { selectColumn, useBoard, useSettings } from "@/lib/store";
import { playBlip } from "@/features/alerts/sound";
import { makeFilter } from "./filters";

export const MAX_CARDS = 60;

function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ms) return;
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

export interface ColumnData {
  rows: TokenSnapshot[];
  /** After filters (before the render cap). */
  total: number;
  /** Before filters. */
  raw: number;
  tokens: Record<string, TokenSnapshot>;
}

export function useColumn(chain: ChainId, phase: TokenPhase): ColumnData {
  const tokens = useBoard((s) => s.tokens);
  const filters = useSettings((s) => s.filters[phase]);
  const blockedDevs = useSettings((s) => s.blockedDevs);
  const blockedKeywords = useSettings((s) => s.blockedKeywords);
  // Age filters need a clock; only tick when one is set.
  const tick = useTick(filters?.maxAgeMin ? 5000 : 0);

  return useMemo<ColumnData>(() => {
    const all = selectColumn(tokens, chain, phase);
    const pred = makeFilter(filters ?? { launchpads: [] }, { blockedDevs, blockedKeywords, now: Date.now() });
    const filtered = all.filter(pred);
    return { rows: filtered.slice(0, MAX_CARDS), total: filtered.length, raw: all.length, tokens };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, chain, phase, filters, blockedDevs, blockedKeywords, tick]);
}

/** Blip when a new key shows up in the (filtered) column. Resets when `resetKey` changes. */
export function useArrivalSound(rows: TokenSnapshot[], enabled: boolean, resetKey: string): void {
  const seen = useRef<Set<string> | null>(null);
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current !== resetKey || seen.current === null) {
      lastReset.current = resetKey;
      seen.current = rows.length ? new Set(rows.map((r) => r.key)) : null;
      return;
    }
    let fresh = false;
    for (const r of rows) {
      if (!seen.current.has(r.key)) {
        seen.current.add(r.key);
        fresh = true;
      }
    }
    if (seen.current.size > 2000) seen.current = new Set(rows.map((r) => r.key));
    if (fresh && enabled) playBlip("new", 600);
  }, [rows, enabled, resetKey]);
}

/** Navigate to the token page; meta/ctrl/middle-click opens a new tab. */
export function useOpenToken(): (t: TokenSnapshot, newTab: boolean) => void {
  const [, setLocation] = useLocation();
  const nav = useRef(setLocation);
  nav.current = setLocation;
  return useCallback((t: TokenSnapshot, newTab: boolean) => {
    const href = `/t/${t.chain}/${t.address}`;
    if (newTab) window.open(href, "_blank", "noopener");
    else nav.current(href);
  }, []);
}
