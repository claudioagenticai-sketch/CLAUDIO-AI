// Optional watchlist sharing with connected AI apps. The watchlist itself stays in this browser (lib/store); when the
// user switches sharing on (/connect), a copy is kept on the server for get_my_portfolio / claudio://watchlist.
// The flag lives in localStorage so every tab of the app keeps the copy in sync.
import { useSettings } from "@/lib/store";
import { connectApi } from "./api";

const FLAG = "claudio.mcp.shareWatchlist";

export function watchlistSharing(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function setWatchlistSharing(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    /* private mode: sharing just won't follow later changes */
  }
}

/** Pushes the local watchlist now (used when sharing is switched on). */
export function pushWatchlist(): Promise<{ ok: true; count: number }> {
  return connectApi.shareWatchlist(useSettings.getState().watchlist);
}

/**
 * While sharing is on, mirrors watchlist changes to the server (debounced 1.5 s). Returns an unsubscribe function.
 * Safe to call anywhere: signed-out pushes just fail quietly.
 */
export function startWatchlistSync(): () => void {
  let timer: number | undefined;
  const unsub = useSettings.subscribe((s, prev) => {
    if (s.watchlist === prev.watchlist || !watchlistSharing()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void pushWatchlist().catch(() => undefined);
    }, 1500);
  });
  return () => {
    window.clearTimeout(timer);
    unsub();
  };
}
