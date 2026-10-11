// Freezes a live list while the user is interacting with it (hover on desktop, touch on phones),
// so rows never shift under the cursor. Frozen rows still receive fresh numbers; only the
// set and order of rows is locked. New arrivals are counted and revealed on resume.
import { useEffect, useMemo, useRef, useState } from "react";
import type { TokenSnapshot } from "@shared/types";

export interface Pausable {
  rows: TokenSnapshot[];
  paused: boolean;
  queued: number;
}

export function usePausable(live: TokenSnapshot[], paused: boolean, tokens: Record<string, TokenSnapshot>): Pausable {
  const [frozen, setFrozen] = useState<TokenSnapshot[] | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    // Snapshot exactly what was on screen at the moment the pause began.
    setFrozen(paused ? liveRef.current : null);
  }, [paused]);

  return useMemo<Pausable>(() => {
    if (!paused || !frozen) return { rows: live, paused: false, queued: 0 };
    const frozenKeys = new Set(frozen.map((t) => t.key));
    let queued = 0;
    for (const t of live) if (!frozenKeys.has(t.key)) queued++;
    // Keep order, refresh data (prices, holders…) from the live store when available.
    const rows = frozen.map((t) => tokens[t.key] ?? t);
    return { rows, paused: true, queued };
  }, [paused, frozen, live, tokens]);
}
