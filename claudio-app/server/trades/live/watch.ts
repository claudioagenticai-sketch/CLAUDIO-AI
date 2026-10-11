// Which tokens get a live trade feed right now. Reference-counted per token by holder ("hub" = at least one browser
// has the coin page open; "pin:*" = server-side pins such as $CLAUDIO or a fresh Claudio launch). When the last
// holder leaves, the token stays live for a grace period (default 60 s) so a reload / quick back-and-forth doesn't
// churn subscriptions. Capped (default 60 tokens): over the cap, unpinned tokens are evicted least-recently-viewed
// first — tokens already in grace before tokens someone is still looking at. Pins are never evicted.

export interface WatchOptions {
  graceMs: number;
  max: number;
  /** Called (synchronously) whenever the active set changes. Callers debounce. */
  onChange: () => void;
  now?: () => number;
}

interface Entry {
  holders: Set<string>;
  pins: Set<string>;
  lastViewed: number;
  graceTimer?: NodeJS.Timeout;
  graceUntil?: number;
}

export class WatchManager {
  private entries = new Map<string, Entry>();
  private now: () => number;
  evictions = 0;

  constructor(private opts: WatchOptions) {
    this.now = opts.now ?? Date.now;
  }

  setMax(max: number): void {
    this.opts.max = Math.max(1, max);
    if (this.enforceCap()) this.opts.onChange();
  }

  /** `holder` starts watching `key`. Idempotent per (key, holder). */
  acquire(key: string, holder: string): void {
    const isPin = holder.startsWith("pin:");
    let e = this.entries.get(key);
    const isNew = !e;
    if (!e) {
      e = { holders: new Set(), pins: new Set(), lastViewed: this.now() };
      this.entries.set(key, e);
    }
    if (isPin) e.pins.add(holder);
    else {
      e.holders.add(holder);
      e.lastViewed = this.now();
    }
    if (e.graceTimer) {
      clearTimeout(e.graceTimer);
      e.graceTimer = undefined;
      e.graceUntil = undefined;
    }
    const evicted = this.enforceCap(key);
    if (isNew || evicted) this.opts.onChange();
  }

  /** `holder` stops watching `key`. The token stays live for the grace period once nobody holds it. */
  release(key: string, holder: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (holder.startsWith("pin:")) e.pins.delete(holder);
    else if (e.holders.delete(holder)) e.lastViewed = this.now();
    if (e.holders.size || e.pins.size || e.graceTimer) return;
    e.graceUntil = this.now() + this.opts.graceMs;
    e.graceTimer = setTimeout(() => {
      const cur = this.entries.get(key);
      if (cur !== e || e.holders.size || e.pins.size) return;
      this.entries.delete(key);
      this.opts.onChange();
    }, this.opts.graceMs);
    e.graceTimer.unref?.();
  }

  /** Pins currently held for `key` (e.g. ["pin:claudio"]). */
  pinsOf(key: string): string[] {
    return [...(this.entries.get(key)?.pins ?? [])];
  }

  /** Keys holding a given pin holder. */
  keysPinnedBy(holder: string): string[] {
    const out: string[] = [];
    for (const [k, e] of this.entries) if (e.pins.has(holder)) out.push(k);
    return out;
  }

  isPinned(key: string): boolean {
    return (this.entries.get(key)?.pins.size ?? 0) > 0;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Keys with a live feed: held, pinned or in grace. */
  active(): string[] {
    return [...this.entries.keys()];
  }

  stats(): { active: number; viewed: number; pinned: number; grace: number; evictions: number; max: number } {
    let viewed = 0;
    let pinned = 0;
    let grace = 0;
    for (const e of this.entries.values()) {
      if (e.holders.size) viewed++;
      if (e.pins.size) pinned++;
      if (e.graceTimer) grace++;
    }
    return { active: this.entries.size, viewed, pinned, grace, evictions: this.evictions, max: this.opts.max };
  }

  clear(): void {
    for (const e of this.entries.values()) if (e.graceTimer) clearTimeout(e.graceTimer);
    this.entries.clear();
  }

  /** Evict until under the cap. Never evicts pins or `keep`. Returns true when something was evicted. */
  private enforceCap(keep?: string): boolean {
    if (this.entries.size <= this.opts.max) return false;
    const candidates = [...this.entries].filter(([k, e]) => k !== keep && e.pins.size === 0);
    // Grace (nobody watching) first, then least-recently-viewed.
    candidates.sort(([, a], [, b]) => Number(b.holders.size === 0) - Number(a.holders.size === 0) || a.lastViewed - b.lastViewed);
    let evicted = false;
    for (const [k, e] of candidates) {
      if (this.entries.size <= this.opts.max) break;
      if (e.graceTimer) clearTimeout(e.graceTimer);
      this.entries.delete(k);
      this.evictions++;
      evicted = true;
    }
    return evicted;
  }
}
