// Launch records: in-memory map, mirrored to Postgres (shared/schema `launches`) when DATABASE_URL is set.
// DB failures never break a launch — they are logged and the in-memory copy stays authoritative for this process.
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { ChainId } from "@shared/chains";
import type { LaunchpadId } from "@shared/launchpads";
import { launches, type Launch } from "@shared/schema";
import type { FeeShare } from "@shared/social";
import type { LaunchRequest } from "@shared/types";
import { db } from "../db";
import type { FeeRoute, LaunchRecord, LaunchStatus } from "./types";

const MAX_MEMORY = 5_000;
const mem = new Map<string, LaunchRecord>();

/** EVM addresses are case-insensitive → store lowercase; Solana base58 is case-sensitive → as-is. */
export function normalizeCreator(addr: string): string {
  return addr.startsWith("0x") ? addr.toLowerCase() : addr;
}

interface StoredRequest extends LaunchRequest {
  // Storage key kept from before the rebrand so existing rows (and the JSONB query below) keep working.
  __claudio?: { meta: Record<string, string>; curve?: string; error?: string; shares?: FeeShare[] };
}

function toRow(r: LaunchRecord) {
  const request: StoredRequest = { ...r.request, __claudio: { meta: r.meta, curve: r.curve, error: r.error, shares: r.shares } };
  return {
    id: r.id,
    chain: r.chain,
    launchpad: r.launchpad,
    creator: r.creator,
    token: r.token ?? null,
    splitter: r.splitter ?? null,
    splitKind: r.splitKind,
    name: r.name,
    symbol: r.symbol,
    imageUri: r.imageUri ?? null,
    metadataUri: r.metadataUri ?? null,
    beneficiaryIdentity: r.beneficiaryIdentity ?? null,
    beneficiaryVault: r.beneficiaryVault ?? null,
    agentId: r.agentId ?? null,
    launchedBy: r.launchedBy ?? "human",
    feeRoute: r.feeRoute ?? null,
    txHashes: r.txHashes,
    status: r.status,
    request,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function fromRow(row: Launch): LaunchRecord {
  const stored = (row.request ?? {}) as StoredRequest;
  const { __claudio, ...request } = stored;
  return {
    id: row.id,
    chain: row.chain as ChainId,
    launchpad: row.launchpad as LaunchpadId,
    creator: row.creator,
    name: row.name,
    symbol: row.symbol,
    imageUri: row.imageUri ?? undefined,
    metadataUri: row.metadataUri ?? undefined,
    request: request as LaunchRequest,
    token: row.token ?? undefined,
    curve: __claudio?.curve,
    splitter: row.splitter ?? undefined,
    splitKind: row.splitKind,
    beneficiaryIdentity: row.beneficiaryIdentity ?? undefined,
    beneficiaryVault: row.beneficiaryVault ?? undefined,
    agentId: row.agentId ?? undefined,
    launchedBy: (row.launchedBy as LaunchRecord["launchedBy"]) ?? "human",
    feeRoute: (row.feeRoute as FeeRoute | null) ?? undefined,
    shares: __claudio?.shares,
    meta: __claudio?.meta ?? {},
    txHashes: row.txHashes ?? [],
    status: row.status as LaunchStatus,
    error: __claudio?.error,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** True if any of `r`'s creator fees go to `identityKey` (sole beneficiary or one of several shares). */
function paysIdentity(r: LaunchRecord, identityKey: string): boolean {
  return r.beneficiaryIdentity === identityKey || !!r.shares?.some((s) => s.identityKey === identityKey);
}

/** SQL twin of `paysIdentity`: shares live in request.__claudio.shares (JSONB), so no migration is needed. */
function forIdentity(identityKey: string) {
  return or(
    eq(launches.beneficiaryIdentity, identityKey),
    sql`(${launches.request} -> '__claudio' -> 'shares') @> ${JSON.stringify([{ identityKey }])}::jsonb`,
  );
}

function remember(r: LaunchRecord): void {
  mem.set(r.id, r);
  if (mem.size > MAX_MEMORY) {
    // Evict the oldest prepared-but-never-submitted records first.
    const all = Array.from(mem.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    for (const old of all) {
      if (mem.size <= MAX_MEMORY) break;
      if (old.status === "prepared") mem.delete(old.id);
    }
  }
}

export const launchStore = {
  async save(r: LaunchRecord): Promise<void> {
    r.updatedAt = Date.now();
    remember(r);
    if (!db) return;
    try {
      const row = toRow(r);
      await db
        .insert(launches)
        .values(row)
        .onConflictDoUpdate({
          target: launches.id,
          set: {
            token: row.token,
            splitter: row.splitter,
            txHashes: row.txHashes,
            status: row.status,
            request: row.request,
            agentId: row.agentId,
            launchedBy: row.launchedBy,
            feeRoute: row.feeRoute,
            updatedAt: row.updatedAt,
          },
        });
    } catch (e) {
      console.warn("[launch] db save failed:", e instanceof Error ? e.message : e);
    }
  },

  async get(id: string): Promise<LaunchRecord | undefined> {
    const hit = mem.get(id);
    if (hit) return hit;
    if (!db) return undefined;
    try {
      const rows = await db.select().from(launches).where(eq(launches.id, id)).limit(1);
      if (!rows.length) return undefined;
      const r = fromRow(rows[0]);
      remember(r);
      return r;
    } catch (e) {
      console.warn("[launch] db get failed:", e instanceof Error ? e.message : e);
      return undefined;
    }
  },

  /** Launches by creator(s), newest first. */
  /** Confirmed launches, newest first (keeper input). */
  async confirmed(limit = 500): Promise<LaunchRecord[]> {
    if (db) {
      try {
        const rows = await db.select().from(launches).where(eq(launches.status, "confirmed")).orderBy(desc(launches.createdAt)).limit(limit);
        return rows.map(fromRow);
      } catch (e) {
        console.warn("[launch] db confirmed failed:", e instanceof Error ? e.message : e);
      }
    }
    return Array.from(mem.values())
      .filter((r) => r.status === "confirmed")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /** Launches in one of `statuses` (newest first), optionally on one chain — reconciler / collector input. */
  async byStatus(statuses: LaunchStatus[], opts: { chain?: ChainId; limit?: number; since?: number } = {}): Promise<LaunchRecord[]> {
    const limit = opts.limit ?? 500;
    const since = opts.since ?? 0;
    const out = new Map<string, LaunchRecord>();
    Array.from(mem.values()).forEach((r) => {
      if (statuses.includes(r.status) && (!opts.chain || r.chain === opts.chain) && r.createdAt >= since) out.set(r.id, r);
    });
    if (db) {
      try {
        const where = and(
          inArray(launches.status, statuses),
          opts.chain ? eq(launches.chain, opts.chain) : undefined,
          since ? gte(launches.createdAt, new Date(since)) : undefined,
        );
        const rows = await db.select().from(launches).where(where).orderBy(desc(launches.createdAt)).limit(limit);
        // The in-memory copy is authoritative for this process (it may be newer than the row).
        for (const row of rows) if (!out.has(row.id)) out.set(row.id, fromRow(row));
      } catch (e) {
        console.warn("[launch] db byStatus failed:", e instanceof Error ? e.message : e);
      }
    }
    return Array.from(out.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /** Launches whose creator share goes to `identityKey`, newest first. */
  async byBeneficiary(identityKey: string, limit = 200): Promise<LaunchRecord[]> {
    if (db) {
      try {
        const rows = await db.select().from(launches).where(forIdentity(identityKey)).orderBy(desc(launches.createdAt)).limit(limit);
        return rows.map(fromRow);
      } catch (e) {
        console.warn("[launch] db byBeneficiary failed:", e instanceof Error ? e.message : e);
      }
    }
    return Array.from(mem.values())
      .filter((r) => paysIdentity(r, identityKey))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },

  /** The confirmed launch that created `token` on `chain`, if it went through Claudio. */
  async byToken(chain: ChainId, token: string): Promise<LaunchRecord | undefined> {
    const t = normalizeCreator(token);
    const hit = Array.from(mem.values()).find((r) => r.chain === chain && r.token && normalizeCreator(r.token) === t && r.status === "confirmed");
    if (hit || !db) return hit;
    try {
      const rows = await db
        .select()
        .from(launches)
        // EVM tokens are stored checksummed; compare case-insensitively (Solana base58 never starts with 0x).
        .where(and(eq(launches.chain, chain), t.startsWith("0x") ? sql`lower(${launches.token}) = ${t}` : eq(launches.token, t), eq(launches.status, "confirmed")))
        .limit(1);
      return rows[0] ? fromRow(rows[0]) : undefined;
    } catch (e) {
      console.warn("[launch] db byToken failed:", e instanceof Error ? e.message : e);
      return undefined;
    }
  },

  /** Launches aimed at `identityKey` since `since` (ms), any status: per-target abuse limit. */
  async countForBeneficiarySince(identityKey: string, since: number): Promise<number> {
    if (db) {
      try {
        const rows = await db
          .select({ id: launches.id })
          .from(launches)
          .where(and(forIdentity(identityKey), gte(launches.createdAt, new Date(since))));
        return rows.length;
      } catch (e) {
        console.warn("[launch] db count failed:", e instanceof Error ? e.message : e);
      }
    }
    return Array.from(mem.values()).filter((r) => paysIdentity(r, identityKey) && r.createdAt >= since).length;
  },

  async byCreators(creators: string[], limit = 100): Promise<LaunchRecord[]> {
    const keys = creators.map(normalizeCreator).filter(Boolean);
    if (!keys.length) return [];
    const out = new Map<string, LaunchRecord>();
    Array.from(mem.values()).forEach((r) => {
      if (keys.includes(r.creator)) out.set(r.id, r);
    });
    if (db) {
      try {
        const rows = await db
          .select()
          .from(launches)
          .where(inArray(launches.creator, keys))
          .orderBy(desc(launches.createdAt))
          .limit(limit);
        for (const row of rows) if (!out.has(row.id)) out.set(row.id, fromRow(row));
      } catch (e) {
        console.warn("[launch] db list failed:", e instanceof Error ? e.message : e);
      }
    }
    return Array.from(out.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },
};
