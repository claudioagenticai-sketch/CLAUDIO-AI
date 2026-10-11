// Per-token holder analytics, updated incrementally on every trade (O(1) per trade except the
// throttled top-10 scan). Balances are reconstructed from the trades we index — transfers are NOT
// indexed, so wallets that receive tokens by transfer are invisible until they sell.
//
// Definitions (see docs/research/launchpads.md §4):
//  - sniper   : first buy within the first 3 blocks of creation or the first 3s (only when we saw the creation)
//  - bundler  : ≥3 distinct wallets buying in the same block/slot → all of them tagged
//  - fresh    : "fresh (heuristic)" — first time we saw the wallet anywhere is ≤10 min before its first buy here
//  - insider  : a wallet that sells a token it never bought here while we tracked the token from creation
//               (it must have received tokens by transfer). Because we don't index transfers we never know
//               its balance, so insidersPct stays 0; the trade is still tagged "insider".
//  - whale    : holds > 2% of supply
//  - kol/smart: from server/analytics/kols.json (address → label)

import type { Holder, Trade, TraderTag } from "@shared/types";
import { isFreshAt, normAddr, sawWallet, walletLabel } from "./wallets";

interface HolderState {
  bal: number;
  boughtUsd: number;
  soldUsd: number;
  buys: number;
  sells: number;
  firstBuyTs: number;
  sniper: boolean;
  bundler: boolean;
  fresh: boolean;
  insider: boolean;
  label?: "kol" | "smart";
}

export interface AnalyticsInit {
  supply: number;
  creator: string;
  createdAt: number;
  /** Creation block/slot, 0 if unknown. */
  createBlock: number;
  /** True when we observed the creation (sniper / insider logic is only meaningful then). */
  trackedFromCreation: boolean;
  /** Curve / pool / locker / token addresses excluded from holder stats. */
  excluded?: string[];
}

export interface TradeAnalysis {
  tags: TraderTag[];
  /** Became true on this trade (emit dev-sold alert). */
  devSoldNow: boolean;
  /** Sell > 3% of supply. */
  largeSell: boolean;
  /** Share of the creator's peak balance that has been sold, 0–100. */
  creatorSoldPct: number;
}

export interface AnalyticsMetrics {
  holders: number;
  top10Pct: number;
  devHoldPct: number;
  snipersPct: number;
  snipersCount: number;
  insidersPct: number;
  bundlersPct: number;
  bundlersCount: number;
  freshWalletsPct: number;
  kolBuys: number;
  smartBuys: number;
  devSold: boolean;
}

const WHALE_SHARE = 0.02;
const LARGE_SELL_SHARE = 0.03;
const SNIPER_BLOCKS = 3;
const SNIPER_MS = 3000;
const BUNDLE_MIN_WALLETS = 3;
const MAX_TRACKED_BLOCKS = 64;

export class TokenAnalytics {
  supply: number;
  creator: string;
  createdAt: number;
  createBlock: number;
  trackedFromCreation: boolean;

  private h = new Map<string, HolderState>();
  private excluded = new Set<string>();
  private dust: number;
  private holderCount = 0;
  private held = { sniper: 0, bundler: 0, fresh: 0 };
  private sniperCount = 0;
  private bundlerCount = 0;
  private insiderCount = 0;
  private kolBuyers = 0;
  private smartBuyers = 0;
  private blockBuyers = new Map<number, Set<string>>();
  private creatorPeak = 0;
  private devSold = false;
  private top10 = 0;
  private topAt = 0;
  private topDirty = true;

  constructor(init: AnalyticsInit) {
    this.supply = init.supply > 0 ? init.supply : 1e9;
    this.creator = init.creator ? normAddr(init.creator) : "";
    this.createdAt = init.createdAt;
    this.createBlock = init.createBlock;
    this.trackedFromCreation = init.trackedFromCreation;
    this.dust = this.supply * 1e-9;
    if (init.excluded) this.addExcluded(init.excluded);
  }

  addExcluded(addrs: string[]): void {
    for (const a of addrs) if (a) this.excluded.add(normAddr(a));
    this.topDirty = true;
  }

  setCreator(creator: string): void {
    this.creator = creator ? normAddr(creator) : "";
  }

  setSupply(supply: number): void {
    if (supply > 0) {
      this.supply = supply;
      this.dust = supply * 1e-9;
      this.topDirty = true;
    }
  }

  get insiders(): number {
    return this.insiderCount;
  }

  /** Sum of all known holder balances (excludes pools/curves). */
  totalHeld(): number {
    let s = 0;
    for (const [a, st] of this.h) if (!this.excluded.has(a)) s += st.bal;
    return s;
  }

  onTrade(tr: Trade): TradeAnalysis {
    const a = normAddr(tr.trader);
    const out: TradeAnalysis = { tags: [], devSoldNow: false, largeSell: false, creatorSoldPct: 0 };
    if (!a || this.excluded.has(a)) return out;

    let s = this.h.get(a);
    if (!s) {
      s = { bal: 0, boughtUsd: 0, soldUsd: 0, buys: 0, sells: 0, firstBuyTs: 0, sniper: false, bundler: false, fresh: false, insider: false };
      this.h.set(a, s);
    }
    const isDev = !!this.creator && a === this.creator;
    const firstSeen = sawWallet(a, tr.ts);
    const amt = Number.isFinite(tr.amountToken) && tr.amountToken > 0 ? tr.amountToken : 0;

    if (tr.side === "buy") {
      if (s.firstBuyTs === 0) {
        s.firstBuyTs = tr.ts;
        if (!isDev && this.trackedFromCreation) {
          const byBlock = tr.block > 0 && this.createBlock > 0 && tr.block >= this.createBlock && tr.block - this.createBlock < SNIPER_BLOCKS;
          const byTime = this.createdAt > 0 && tr.ts >= this.createdAt - 1000 && tr.ts - this.createdAt <= SNIPER_MS;
          if (byBlock || byTime) this.flag(s, "sniper");
        }
        if (!isDev && isFreshAt(firstSeen, tr.ts)) this.flag(s, "fresh");
        const lab = walletLabel(a);
        if (lab) {
          s.label = lab.kind;
          if (lab.kind === "kol") this.kolBuyers++;
          else this.smartBuyers++;
        }
      }
      s.buys++;
      s.boughtUsd += tr.amountUsd;
      this.setBal(s, s.bal + amt);

      if (tr.block > 0) {
        let set = this.blockBuyers.get(tr.block);
        if (!set) {
          set = new Set();
          this.blockBuyers.set(tr.block, set);
          if (this.blockBuyers.size > MAX_TRACKED_BLOCKS) {
            const oldest = this.blockBuyers.keys().next().value;
            if (oldest !== undefined) this.blockBuyers.delete(oldest);
          }
        }
        set.add(a);
        if (set.size >= BUNDLE_MIN_WALLETS) {
          for (const w of set) {
            const ws = this.h.get(w);
            if (ws && !ws.bundler) this.flag(ws, "bundler");
          }
        }
      }
      if (isDev) this.creatorPeak = Math.max(this.creatorPeak, s.bal);
    } else {
      if (s.buys === 0 && !isDev && this.trackedFromCreation && !s.insider) {
        s.insider = true; // sold without ever buying → received by transfer (see header)
        this.insiderCount++;
      }
      s.sells++;
      s.soldUsd += tr.amountUsd;
      const before = s.bal;
      this.setBal(s, Math.max(0, s.bal - amt));
      if (amt > this.supply * LARGE_SELL_SHARE) out.largeSell = true;
      if (isDev) {
        const peak = Math.max(this.creatorPeak, before);
        this.creatorPeak = peak;
        // 0 = unknown share (we never saw the dev's buy, e.g. token indexed mid-life).
        out.creatorSoldPct = peak > 0 ? Math.min(100, (1 - s.bal / peak) * 100) : 0;
        // Creator sold > 50% of their peak — or sold at all when we never saw them buy (allocation unknown).
        if (!this.devSold && (peak <= 0 || s.bal < peak * 0.5)) {
          this.devSold = true;
          out.devSoldNow = true;
        }
      }
    }

    if (isDev) out.tags.push("dev");
    if (s.sniper) out.tags.push("sniper");
    if (s.bundler) out.tags.push("bundler");
    if (s.insider) out.tags.push("insider");
    if (s.fresh) out.tags.push("fresh");
    if (s.label) out.tags.push(s.label);
    if (Math.max(s.bal, tr.side === "sell" ? s.bal + amt : 0) > this.supply * WHALE_SHARE) out.tags.push("whale");
    return out;
  }

  private flag(s: HolderState, kind: "sniper" | "bundler" | "fresh"): void {
    if (s[kind]) return;
    s[kind] = true;
    this.held[kind] += s.bal; // from now on setBal keeps this aggregate in sync
    if (kind === "sniper") this.sniperCount++;
    else if (kind === "bundler") this.bundlerCount++;
  }

  private setBal(s: HolderState, next: number): void {
    const delta = next - s.bal;
    if (s.sniper) this.held.sniper += delta;
    if (s.bundler) this.held.bundler += delta;
    if (s.fresh) this.held.fresh += delta;
    const was = s.bal > this.dust;
    const is = next > this.dust;
    if (was !== is) this.holderCount += is ? 1 : -1;
    s.bal = next;
    this.topDirty = true;
  }

  private computeTop10(): number {
    const now = Date.now();
    // Large holder sets: rescan at most once per second.
    if (!this.topDirty || (this.h.size > 300 && now - this.topAt < 1000)) return this.top10;
    const top: number[] = [];
    for (const [a, s] of this.h) {
      if (s.bal <= this.dust || this.excluded.has(a)) continue;
      if (top.length < 10) {
        top.push(s.bal);
        if (top.length === 10) top.sort((x, y) => y - x);
      } else if (s.bal > top[9]) {
        top[9] = s.bal;
        top.sort((x, y) => y - x);
      }
    }
    const sum = top.reduce((x, y) => x + y, 0);
    this.top10 = (sum / this.supply) * 100;
    this.topAt = now;
    this.topDirty = false;
    return this.top10;
  }

  metrics(): AnalyticsMetrics {
    const pct = (v: number): number => Math.max(0, Math.min(100, (v / this.supply) * 100));
    const dev = this.creator ? this.h.get(this.creator) : undefined;
    return {
      holders: this.holderCount,
      top10Pct: this.computeTop10(),
      devHoldPct: dev ? pct(dev.bal) : 0,
      snipersPct: pct(this.held.sniper),
      snipersCount: this.sniperCount,
      insidersPct: 0, // no transfer indexing → balances of insiders are unknown (see header)
      bundlersPct: pct(this.held.bundler),
      bundlersCount: this.bundlerCount,
      freshWalletsPct: pct(this.held.fresh),
      kolBuys: this.kolBuyers,
      smartBuys: this.smartBuyers,
      devSold: this.devSold,
    };
  }

  /** Top holders by balance with tags and PnL (O(n log n), request-time only). */
  topHolders(limit: number, priceUsd: number): Holder[] {
    const rows: Holder[] = [];
    for (const [a, s] of this.h) {
      if (s.bal <= this.dust || this.excluded.has(a)) continue;
      const tags: Holder["tags"] = [];
      if (this.creator && a === this.creator) tags.push("dev");
      if (s.sniper) tags.push("sniper");
      if (s.bundler) tags.push("bundler");
      if (s.insider) tags.push("insider");
      if (s.fresh) tags.push("fresh");
      if (s.label) tags.push(s.label);
      if (s.bal > this.supply * WHALE_SHARE) tags.push("whale");
      rows.push({
        address: a,
        balance: s.bal,
        pct: (s.bal / this.supply) * 100,
        tags,
        boughtUsd: s.boughtUsd,
        soldUsd: s.soldUsd,
        pnlUsd: s.soldUsd + s.bal * priceUsd - s.boughtUsd,
      });
    }
    rows.sort((x, y) => y.balance - x.balance);
    return rows.slice(0, limit);
  }
}
