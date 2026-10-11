// Creator dashboard data: merges the local launch history with the server's record, per-launchpad risk notes.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import { useHistory, type HistoryLaunch } from "@/lib/history";
import { useWallet } from "@/lib/wallet";
import { launchApi, type LaunchStatus, type PublicLaunch } from "@/features/launch/api";

export interface CreatorLaunch {
  id: string;
  chain: ChainId;
  launchpad: LaunchpadId;
  name: string;
  symbol: string;
  creator: string;
  imageUri?: string;
  token?: string;
  splitter?: string;
  curve?: string;
  hashes: string[];
  status: LaunchStatus | "local";
  error?: string;
  ts: number;
  /** Known to the server (fees + harvest available). */
  server: boolean;
}

export function tokenKey(chain: ChainId, token: string): string {
  return `${chain}:${token.startsWith("0x") ? token.toLowerCase() : token}`;
}

/** ipfs:// → https gateway for <img>. */
export function displayImage(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

function fromHistory(h: HistoryLaunch): CreatorLaunch {
  return {
    id: h.id,
    chain: h.chain,
    launchpad: h.launchpad,
    name: h.name,
    symbol: h.symbol,
    creator: h.creator,
    token: h.token,
    splitter: h.splitter,
    hashes: h.hashes,
    status: "local",
    ts: h.ts,
    server: false,
  };
}

function fromServer(p: PublicLaunch, local?: HistoryLaunch): CreatorLaunch {
  return {
    id: p.id,
    chain: p.chain,
    launchpad: p.launchpad,
    name: p.name,
    symbol: p.symbol,
    creator: p.creator,
    imageUri: p.imageUri,
    token: p.token ?? local?.token,
    splitter: p.splitter ?? local?.splitter,
    curve: p.curve,
    hashes: p.txHashes.length ? p.txHashes : local?.hashes ?? [],
    status: p.status,
    error: p.error,
    ts: p.createdAt,
    server: true,
  };
}

export function useCreatorLaunches() {
  const local = useHistory((s) => s.launches);
  const accounts = useWallet((s) => s.accounts);
  const creators = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach((a) => set.add(a.address));
    local.forEach((l) => set.add(l.creator));
    return Array.from(set).slice(0, 8).sort();
  }, [accounts, local]);

  const q = useQuery({
    queryKey: ["launch", "mine", creators.join(",")],
    queryFn: () => launchApi.mine(creators),
    enabled: creators.length > 0,
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const launches = useMemo(() => {
    const byId = new Map<string, CreatorLaunch>();
    const localById = new Map<string, HistoryLaunch>();
    local.forEach((l) => localById.set(l.id, l));
    (q.data?.launches ?? []).forEach((p) => byId.set(p.id, fromServer(p, localById.get(p.id))));
    local.forEach((l) => {
      if (!byId.has(l.id)) byId.set(l.id, fromHistory(l));
    });
    return Array.from(byId.values()).sort((a, b) => b.ts - a.ts);
  }, [q.data, local]);

  return { launches, creators, query: q };
}

/** What can go wrong with the 70/30 split after launch, per launchpad. */
export const SPLIT_RISK: Partial<Record<LaunchpadId, { level: "locked" | "watch" | "risk"; text: string; events: string[] }>> = {
  pons: {
    level: "risk",
    text: "Pons' Safe can propose a new creatorFeeRecipient and execute it after 3 days (used ~11× recently for CTOs). Your splitter never gives the role away, but future fees could be redirected. When a change is proposed, harvest immediately — balances already credited in the escrow stay claimable by your splitter.",
    events: ["CreatorFeeRecipientChangeProposed"],
  },
  genius: {
    level: "risk",
    text: "Pons V2 fork: the owner Safe can redirect the creator fee recipient after a 3-day notice.",
    events: ["CreatorFeeRecipientChangeProposed"],
  },
  pump: {
    level: "watch",
    text: "The split is written once and the admin is revoked, so you can't change it — but pump.fun's CTO process (admin_cto) can reset it on non-Mayhem coins. Mayhem coins can't be CTO'd.",
    events: ["AdminCtoEvent", "ResetFeeSharingConfigEvent"],
  },
  clanker: {
    level: "locked",
    text: "Reward bps have no setter. Each slot's admin can only change its own recipient; Clanker's owner can only change modules for new deploys. Fees wait in the FeeLocker until claimed.",
    events: [],
  },
  bags: { level: "watch", text: "Bags admin can rewrite claimers (an EOA on Robinhood).", events: ["claimers updated"] },
  flap: { level: "watch", text: "Flap admin roles can rewire tax recipients.", events: ["setTokenBeneficiary", "updateTaxTokenAddresses"] },
  trench: { level: "watch", text: "Trench's owner EOA can upgrade the proxies.", events: [] },
  dyor: { level: "risk", text: "Dyor owner / upgrades can override the fee recipient.", events: [] },
  heaven: { level: "risk", text: "Heaven's admin can override the fee receiver and reclassify creator fees.", events: [] },
};
