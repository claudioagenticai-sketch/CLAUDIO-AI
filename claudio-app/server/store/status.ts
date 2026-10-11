// Per-chain feed status. Several sources can feed a chain (e.g. HOOD poller + optional WS heads);
// the chain is "live" when any live source reported healthy recently, "simulated" whenever the simulator
// is publishing on that chain (even if a live source also runs — honesty over pride), else "offline".

import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import type { ChainStatus } from "@shared/types";
import { nativeUsdOf } from "../ingest/prices";

interface SourceState {
  live: boolean;
  reason?: string;
  at: number;
}

interface ChainState {
  latencyMs: number;
  lastBlock: number;
  lastEventAt: number;
  gas?: string;
  sources: Map<string, SourceState>;
}

/** ChainStatus plus human-readable detail (extra fields are ignored by older clients). */
export type ChainStatusEx = ChainStatus & { detail?: string; sources?: Record<string, { live: boolean; reason?: string }> };

const chains = new Map<ChainId, ChainState>();
const simulating = new Set<ChainId>();

function state(chain: ChainId): ChainState {
  let s = chains.get(chain);
  if (!s) {
    s = { latencyMs: 0, lastBlock: 0, lastEventAt: 0, sources: new Map() };
    chains.set(chain, s);
  }
  return s;
}

export function setSource(chain: ChainId, source: string, live: boolean, reason?: string): void {
  state(chain).sources.set(source, { live, reason, at: Date.now() });
}

export function updateChainStats(chain: ChainId, patch: { latencyMs?: number; lastBlock?: number; lastEventAt?: number; gas?: string }): void {
  const s = state(chain);
  if (patch.latencyMs !== undefined) s.latencyMs = Math.round(patch.latencyMs);
  if (patch.lastBlock !== undefined && patch.lastBlock > s.lastBlock) s.lastBlock = patch.lastBlock;
  if (patch.lastEventAt !== undefined) s.lastEventAt = Math.max(s.lastEventAt, patch.lastEventAt);
  if (patch.gas !== undefined) s.gas = patch.gas;
}

export function markEvent(chain: ChainId, at = Date.now()): void {
  const s = state(chain);
  if (at > s.lastEventAt) s.lastEventAt = at;
}

export function setSimulating(chain: ChainId, on: boolean): void {
  if (on) simulating.add(chain);
  else simulating.delete(chain);
}

export function isSimulating(chain: ChainId): boolean {
  return simulating.has(chain);
}

/** True if any real source for this chain is currently healthy. */
export function isChainLive(chain: ChainId): boolean {
  const s = chains.get(chain);
  if (!s) return false;
  for (const src of s.sources.values()) if (src.live) return true;
  return false;
}

export function chainStatus(chain: ChainId): ChainStatusEx {
  const s = state(chain);
  const live = isChainLive(chain);
  const source: ChainStatus["source"] = simulating.has(chain) ? "simulated" : live ? "live" : "offline";
  const sources: Record<string, { live: boolean; reason?: string }> = {};
  const reasons: string[] = [];
  for (const [name, src] of s.sources) {
    sources[name] = { live: src.live, reason: src.reason };
    if (!src.live && src.reason) reasons.push(`${name}: ${src.reason}`);
  }
  let detail: string | undefined;
  if (source === "simulated") detail = live ? "Simulator running alongside live feed (SIMULATOR=on)" : "No live source — simulated data";
  else if (source === "offline") detail = reasons.join("; ") || "No source configured";
  return {
    chain,
    source,
    latencyMs: s.latencyMs,
    lastBlock: s.lastBlock,
    lastEventAt: s.lastEventAt,
    gas: s.gas,
    nativeUsd: nativeUsdOf(chain),
    detail,
    sources,
  };
}

export function allChainStatuses(): ChainStatusEx[] {
  return ENABLED_CHAINS.filter((c) => CHAINS[c].enabled).map(chainStatus);
}
