// Tiny structured-ish logger for ingest/analytics (same format as server/vite.ts `log`, without importing vite).

export function ilog(source: string, message: string): void {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${time} [${source}] ${message}`);
}

/** Log at most once per `everyMs` per key (for noisy error paths). */
const lastLogged = new Map<string, number>();
export function ilogThrottled(source: string, key: string, message: string, everyMs = 60_000): void {
  const now = Date.now();
  const prev = lastLogged.get(key) ?? 0;
  if (now - prev < everyMs) return;
  lastLogged.set(key, now);
  if (lastLogged.size > 2000) lastLogged.clear();
  ilog(source, message);
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0].slice(0, 300);
  return String(e).slice(0, 300);
}
