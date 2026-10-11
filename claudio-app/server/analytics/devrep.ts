// Dev reputation across chains: creator → launches / migrations / rugs.
// In-memory; the same creator address seen on several launchpads (or EVM chains) builds one record.

import type { ChainId } from "@shared/chains";
import { normAddr } from "./wallets";

export interface DevRecord {
  launches: number;
  migrations: number;
  rugs: number;
  chains: Set<ChainId>;
  /** Most recent token keys (bounded) so the store can refresh their dev stats. */
  tokens: string[];
  lastSeen: number;
}

const MAX_DEVS = 200_000;
const devs = new Map<string, DevRecord>();
const launchedKeys = new Set<string>();
const migratedKeys = new Set<string>();
const ruggedKeys = new Set<string>();

function bounded(set: Set<string>, max: number): void {
  if (set.size <= max) return;
  let n = set.size - max;
  for (const k of set) {
    set.delete(k);
    if (--n <= 0) break;
  }
}

function rec(creator: string): DevRecord | undefined {
  if (!creator) return undefined;
  const c = normAddr(creator);
  let r = devs.get(c);
  if (!r) {
    r = { launches: 0, migrations: 0, rugs: 0, chains: new Set(), tokens: [], lastSeen: Date.now() };
    devs.set(c, r);
    if (devs.size > MAX_DEVS) {
      const first = devs.keys().next().value;
      if (first !== undefined) devs.delete(first);
    }
  }
  return r;
}

export function recordLaunch(creator: string, key: string, chain: ChainId): DevRecord | undefined {
  const r = rec(creator);
  if (!r) return undefined;
  if (!launchedKeys.has(key)) {
    launchedKeys.add(key);
    bounded(launchedKeys, 500_000);
    r.launches++;
    r.chains.add(chain);
    r.tokens.push(key);
    if (r.tokens.length > 50) r.tokens.splice(0, r.tokens.length - 50);
  }
  r.lastSeen = Date.now();
  return r;
}

export function recordMigration(creator: string, key: string): DevRecord | undefined {
  const r = rec(creator);
  if (!r || migratedKeys.has(key)) return r;
  migratedKeys.add(key);
  bounded(migratedKeys, 200_000);
  r.migrations++;
  return r;
}

export function recordRug(creator: string, key: string): DevRecord | undefined {
  const r = rec(creator);
  if (!r || ruggedKeys.has(key)) return r;
  ruggedKeys.add(key);
  bounded(ruggedKeys, 200_000);
  r.rugs++;
  return r;
}

export function devRecord(creator: string): DevRecord | undefined {
  if (!creator) return undefined;
  return devs.get(normAddr(creator));
}
