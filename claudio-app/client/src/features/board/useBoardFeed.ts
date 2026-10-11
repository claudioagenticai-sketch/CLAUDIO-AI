// Loads the REST snapshot for a chain's board and keeps a WS subscription open while mounted.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainId } from "@shared/chains";
import type { TokenSnapshot } from "@shared/types";
import { useBoard } from "@/lib/store";
import { socket } from "@/lib/ws";

function parseBoard(json: unknown): TokenSnapshot[] {
  if (Array.isArray(json)) return json as TokenSnapshot[];
  if (json && typeof json === "object" && Array.isArray((json as { tokens?: unknown }).tokens)) {
    return (json as { tokens: TokenSnapshot[] }).tokens;
  }
  return [];
}

export interface BoardFeed {
  /** True until the first snapshot for this chain has arrived (REST or WS). */
  loading: boolean;
  refreshing: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

export function useBoardFeed(chain: ChainId): BoardFeed {
  const [loadedChain, setLoadedChain] = useState<ChainId | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const chainRef = useRef<ChainId>(chain);
  chainRef.current = chain;

  // If the WS snapshot beats REST, we're not loading anymore.
  const hasTokens = useBoard((s) => {
    for (const k in s.tokens) if (s.tokens[k].chain === chain) return true;
    return false;
  });

  const load = useCallback(async (target: ChainId, signal?: AbortSignal): Promise<void> => {
    try {
      const res = await fetch(`/api/board?chain=${encodeURIComponent(target)}`, { signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const tokens = parseBoard(await res.json());
      if (chainRef.current !== target) return;
      useBoard.getState().apply({ t: "board", chain: target, tokens });
      setError(undefined);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal?.aborted && chainRef.current === target) setLoadedChain(target);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(chain, ac.signal);
    const unsub = socket.subscribe([`board:${chain}`]);
    return () => {
      ac.abort();
      unsub();
    };
  }, [chain, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(chainRef.current);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { loading: loadedChain !== chain && !hasTokens, refreshing, error, refresh };
}
