// Fixed-size rolling windows (5m / 1h / 24h volume, buy/sell counts, price change) and candle series.

import type { Candle } from "@shared/types";

const MIN = 60_000;
const HOUR = 3_600_000;
const MIN_SLOTS = 61; // 60 full minutes + current
const HOUR_SLOTS = 25;

export interface WindowStats {
  volume5mUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buys5m: number;
  sells5m: number;
  change5mPct: number;
  change1hPct: number;
}

/** Minute-bucket ring (1h) + hour-bucket ring (24h). All updates O(1); reads O(60). */
export class RollingWindows {
  private minStamp = new Float64Array(MIN_SLOTS).fill(-1);
  private minVol = new Float64Array(MIN_SLOTS);
  private minBuys = new Uint32Array(MIN_SLOTS);
  private minSells = new Uint32Array(MIN_SLOTS);
  private minClose = new Float64Array(MIN_SLOTS);
  private hourStamp = new Float64Array(HOUR_SLOTS).fill(-1);
  private hourVol = new Float64Array(HOUR_SLOTS);
  private firstPrice = 0;
  private firstTs = 0;

  add(ts: number, usd: number, side: "buy" | "sell", priceUsd: number): void {
    const m = Math.floor(ts / MIN);
    const i = m % MIN_SLOTS;
    if (this.minStamp[i] !== m) {
      if (this.minStamp[i] > m) return; // older than our ring → ignore for windows
      this.minStamp[i] = m;
      this.minVol[i] = 0;
      this.minBuys[i] = 0;
      this.minSells[i] = 0;
      this.minClose[i] = 0;
    }
    if (Number.isFinite(usd) && usd > 0) this.minVol[i] += usd;
    if (side === "buy") this.minBuys[i]++;
    else this.minSells[i]++;
    if (priceUsd > 0) this.minClose[i] = priceUsd;

    const hIdx = Math.floor(ts / HOUR);
    const j = hIdx % HOUR_SLOTS;
    if (this.hourStamp[j] !== hIdx) {
      if (this.hourStamp[j] < hIdx) {
        this.hourStamp[j] = hIdx;
        this.hourVol[j] = 0;
      }
    }
    if (this.hourStamp[j] === hIdx && Number.isFinite(usd) && usd > 0) this.hourVol[j] += usd;

    if (priceUsd > 0 && (this.firstTs === 0 || ts < this.firstTs)) {
      this.firstTs = ts;
      this.firstPrice = priceUsd;
    }
  }

  /** Close price of the latest minute bucket at or before `minute` (searching back ≤ 60 min). */
  private closeAtOrBefore(minute: number, floorMinute: number): number {
    for (let m = minute; m >= floorMinute; m--) {
      const i = ((m % MIN_SLOTS) + MIN_SLOTS) % MIN_SLOTS;
      if (this.minStamp[i] === m && this.minClose[i] > 0) return this.minClose[i];
    }
    return 0;
  }

  compute(now: number, priceUsd: number): WindowStats {
    const nowMin = Math.floor(now / MIN);
    let v5 = 0;
    let v60 = 0;
    let b5 = 0;
    let s5 = 0;
    for (let k = 0; k < 60; k++) {
      const m = nowMin - k;
      const i = ((m % MIN_SLOTS) + MIN_SLOTS) % MIN_SLOTS;
      if (this.minStamp[i] !== m) continue;
      v60 += this.minVol[i];
      if (k < 5) {
        v5 += this.minVol[i];
        b5 += this.minBuys[i];
        s5 += this.minSells[i];
      }
    }
    const nowHour = Math.floor(now / HOUR);
    let v24 = 0;
    for (let k = 0; k < 24; k++) {
      const h = nowHour - k;
      const j = ((h % HOUR_SLOTS) + HOUR_SLOTS) % HOUR_SLOTS;
      if (this.hourStamp[j] === h) v24 += this.hourVol[j];
    }
    const ref = (mins: number): number => {
      const p = this.closeAtOrBefore(nowMin - mins, nowMin - 60);
      if (p > 0) return p;
      // Token younger than the window → change since first trade.
      return this.firstTs > now - mins * MIN ? this.firstPrice : 0;
    };
    const chg = (ago: number): number => {
      const r = ref(ago);
      return r > 0 && priceUsd > 0 ? (priceUsd / r - 1) * 100 : 0;
    };
    return {
      volume5mUsd: v5,
      volume1hUsd: v60,
      volume24hUsd: Math.max(v24, v60),
      buys5m: b5,
      sells5m: s5,
      change5mPct: chg(5),
      change1hPct: chg(60),
    };
  }
}

/** Incremental OHLCV series at a fixed resolution (seconds). Open = previous close for gapless charts. */
export class CandleSeries {
  readonly data: Candle[] = [];
  constructor(readonly resSec: number, readonly max: number) {}

  add(tsMs: number, price: number, volUsd: number): void {
    if (!(price > 0) || !Number.isFinite(price)) return;
    const t = Math.floor(tsMs / 1000 / this.resSec) * this.resSec;
    const v = Number.isFinite(volUsd) && volUsd > 0 ? volUsd : 0;
    const last = this.data[this.data.length - 1];
    if (!last || t > last.t) {
      const o = last ? last.c : price;
      this.data.push({ t, o, h: Math.max(o, price), l: Math.min(o, price), c: price, v });
      if (this.data.length > this.max) this.data.splice(0, this.data.length - this.max);
      return;
    }
    // Same or older bucket (late/backfilled trade): binary search and merge. Close only moves on the latest bucket.
    let lo = 0;
    let hi = this.data.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = this.data[mid];
      if (c.t === t) {
        c.h = Math.max(c.h, price);
        c.l = Math.min(c.l, price);
        c.v += v;
        if (mid === this.data.length - 1) c.c = price;
        return;
      }
      if (c.t < t) lo = mid + 1;
      else hi = mid - 1;
    }
    if (lo === 0 && this.data.length >= this.max) return; // older than what we keep
    this.data.splice(lo, 0, { t, o: price, h: price, l: price, c: price, v });
    if (this.data.length > this.max) this.data.shift();
  }

  /** Aggregate to a coarser resolution (must be a multiple of resSec). */
  aggregate(resSec: number, limit: number): Candle[] {
    if (resSec <= this.resSec) return this.data.slice(-limit).map((c) => ({ ...c }));
    const out: Candle[] = [];
    for (const c of this.data) {
      const t = Math.floor(c.t / resSec) * resSec;
      const last = out[out.length - 1];
      if (last && last.t === t) {
        last.h = Math.max(last.h, c.h);
        last.l = Math.min(last.l, c.l);
        last.c = c.c;
        last.v += c.v;
      } else out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    }
    return out.slice(-limit);
  }
}
