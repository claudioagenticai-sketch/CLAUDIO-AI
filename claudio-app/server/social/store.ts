// Social identities, auth links and claim audit trail. Postgres when DATABASE_URL is set, memory otherwise
// (same pattern as server/launch/store.ts: a DB failure is logged, never fatal).
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { socialClaims, socialIdentities, socialLinks, type SocialClaimRow, type SocialIdentityRow } from "@shared/schema";
import type { SocialProvider } from "@shared/social";
import { db } from "../db";
import { identityHash, identityKey } from "./identity";

export type IdentityRecord = Omit<SocialIdentityRow, "createdAt" | "updatedAt" | "verifiedAt"> & {
  verifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
};
export type ClaimRecord = Omit<SocialClaimRow, "createdAt" | "updatedAt"> & { createdAt: number; updatedAt: number };
export type AuthProviderId = "auth0" | "clerk";

const memIdentities = new Map<string, IdentityRecord>();
const memLinks = new Map<string, { authProvider: AuthProviderId; authSubject: string; identityKey: string; linkedAt: number }>();
const memClaims = new Map<string, ClaimRecord>();

function warn(what: string, e: unknown) {
  console.error(`[social] ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
}

function fromIdentityRow(r: SocialIdentityRow): IdentityRecord {
  return { ...r, verifiedAt: r.verifiedAt ? r.verifiedAt.getTime() : null, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() };
}

export const socialStore = {
  /** Insert or refresh display fields. Never un-sets opt-out or verification. */
  async upsertIdentity(input: {
    provider: SocialProvider;
    providerUserId: string;
    handle?: string;
    displayName?: string;
    avatarUrl?: string;
    verified?: boolean;
  }): Promise<IdentityRecord> {
    const key = identityKey(input);
    const now = Date.now();
    const prev = await this.getIdentity(key);
    const rec: IdentityRecord = {
      key,
      provider: input.provider,
      providerUserId: input.providerUserId,
      idHash: identityHash(key),
      handle: input.handle ?? prev?.handle ?? null,
      displayName: input.displayName ?? prev?.displayName ?? null,
      avatarUrl: input.avatarUrl ?? prev?.avatarUrl ?? null,
      optedOut: prev?.optedOut ?? false,
      verifiedAt: input.verified ? prev?.verifiedAt ?? now : prev?.verifiedAt ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    memIdentities.set(key, rec);
    if (db) {
      const row = {
        ...rec,
        verifiedAt: rec.verifiedAt ? new Date(rec.verifiedAt) : null,
        createdAt: new Date(rec.createdAt),
        updatedAt: new Date(rec.updatedAt),
      };
      await db
        .insert(socialIdentities)
        .values(row)
        .onConflictDoUpdate({ target: socialIdentities.key, set: { handle: row.handle, displayName: row.displayName, avatarUrl: row.avatarUrl, verifiedAt: row.verifiedAt, updatedAt: row.updatedAt } })
        .catch((e) => warn("upsertIdentity", e));
    }
    return rec;
  },

  async getIdentity(key: string): Promise<IdentityRecord | null> {
    if (db) {
      try {
        const [row] = await db.select().from(socialIdentities).where(eq(socialIdentities.key, key)).limit(1);
        if (row) return fromIdentityRow(row);
      } catch (e) {
        warn("getIdentity", e);
      }
    }
    return memIdentities.get(key) ?? null;
  },

  async setOptedOut(key: string, optedOut: boolean): Promise<void> {
    const rec = memIdentities.get(key);
    if (rec) memIdentities.set(key, { ...rec, optedOut, updatedAt: Date.now() });
    if (db) await db.update(socialIdentities).set({ optedOut, updatedAt: new Date() }).where(eq(socialIdentities.key, key)).catch((e) => warn("setOptedOut", e));
  },

  async link(authProvider: AuthProviderId, authSubject: string, key: string): Promise<void> {
    const id = `${authProvider}|${authSubject}|${key}`;
    if (!memLinks.has(id)) memLinks.set(id, { authProvider, authSubject, identityKey: key, linkedAt: Date.now() });
    if (db) {
      await db
        .insert(socialLinks)
        .values({ id: nanoid(16), authProvider, authSubject, identityKey: key })
        .onConflictDoUpdate({ target: [socialLinks.authProvider, socialLinks.authSubject, socialLinks.identityKey], set: { lastSeenAt: new Date() } })
        .catch((e) => warn("link", e));
    }
  },

  async recordClaim(c: Omit<ClaimRecord, "id" | "createdAt" | "updatedAt" | "status" | "txHash">): Promise<ClaimRecord> {
    const now = Date.now();
    const rec: ClaimRecord = { ...c, id: nanoid(16), status: "signed", txHash: null, createdAt: now, updatedAt: now };
    memClaims.set(rec.id, rec);
    if (db) await db.insert(socialClaims).values({ ...rec, createdAt: new Date(now), updatedAt: new Date(now) }).catch((e) => warn("recordClaim", e));
    return rec;
  },

  async updateClaim(id: string, patch: Partial<Pick<ClaimRecord, "status" | "txHash">>): Promise<void> {
    const rec = memClaims.get(id);
    if (rec) memClaims.set(id, { ...rec, ...patch, updatedAt: Date.now() });
    if (db) await db.update(socialClaims).set({ ...patch, updatedAt: new Date() }).where(eq(socialClaims.id, id)).catch((e) => warn("updateClaim", e));
  },

  async getClaim(id: string): Promise<ClaimRecord | null> {
    if (db) {
      try {
        const [row] = await db.select().from(socialClaims).where(eq(socialClaims.id, id)).limit(1);
        if (row) return { ...row, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() };
      } catch (e) {
        warn("getClaim", e);
      }
    }
    return memClaims.get(id) ?? null;
  },

  /** Claims signed for an identity (newest first), e.g. for the guardian's review queue. */
  async claimsFor(key: string, authProvider?: AuthProviderId, authSubject?: string): Promise<ClaimRecord[]> {
    if (db) {
      try {
        const where = authProvider && authSubject
          ? and(eq(socialClaims.identityKey, key), eq(socialClaims.authProvider, authProvider), eq(socialClaims.authSubject, authSubject))
          : eq(socialClaims.identityKey, key);
        const rows = await db.select().from(socialClaims).where(where).orderBy(desc(socialClaims.createdAt)).limit(50);
        return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() }));
      } catch (e) {
        warn("claimsFor", e);
      }
    }
    return [...memClaims.values()].filter((c) => c.identityKey === key).sort((a, b) => b.createdAt - a.createdAt);
  },

  /** Claims submitted but not yet final (bind delay running): the guardian's review queue. */
  async pendingClaims(): Promise<ClaimRecord[]> {
    if (db) {
      try {
        const rows = await db.select().from(socialClaims).where(eq(socialClaims.status, "pending")).orderBy(desc(socialClaims.createdAt)).limit(200);
        return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), updatedAt: r.updatedAt.getTime() }));
      } catch (e) {
        warn("pendingClaims", e);
      }
    }
    return [...memClaims.values()].filter((c) => c.status === "pending");
  },
};
