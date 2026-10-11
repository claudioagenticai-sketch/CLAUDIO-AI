// Programmatic launch planning shared by the human route (/api/launch/plan) and the agent protocol
// (/api/v1/launch/plan, agents workstream). Owner: platform/launch workstream.
//
//   planLaunchFor(request, ctx) → validates the request, enforces the admin switches (403 launchpad_closed; agent
//   launches also need allow_agents), routes the creator share (ctx.creatorShareTo, e.g. a hosted agent's escrow),
//   builds + simulates the transactions through the adapter and stores the launch record (agent_id, launched_by,
//   fee_route). Nothing is signed or sent here.
import { nanoid } from "nanoid";
import { z } from "zod";
import { getAddress, type Hex } from "viem";
import { CHAINS, CHAIN_ORDER, type ChainId } from "@shared/chains";
import { LAUNCHPADS, LAUNCHPAD_ORDER, deploymentOf, type LaunchpadId } from "@shared/launchpads";
import { PLATFORM_FEE_WALLET_SOL, normalizeCoinName, normalizeTicker } from "@shared/platform";
import { MAX_FEE_SHARES, SOCIAL_PROVIDERS, SOCIAL_PROVIDER_LABEL, type FeeShare, type FeeShareTarget, type SocialBeneficiary } from "@shared/social";
import type { LaunchPlan, LaunchRequest } from "@shared/types";
import { pool } from "../db";
import { IS_TESTNET } from "../network";
import { escrowForAgent } from "../hosted";
import { assertLaunchOpen } from "../platform/switches";
import { socialFactory, vaultAddress } from "../social/attest";
import { ResolveError, resolveHandle } from "../social/resolve";
import { socialStore } from "../social/store";
import { isSolAddress, launchEnv } from "./env";
import { adapterFor, socialLaunchpads } from "./registry";
import { prepareShareSplitter, shareLabel, pct } from "./shares";
import { launchStore, normalizeCreator } from "./store";
import { LaunchError, type FeeRoute, type LaunchRecord } from "./types";

export interface LaunchContext {
  launchedBy: "human" | "agent";
  /** Agent the launch belongs to (hosted: creator share → its escrow; external: → its own wallet). */
  agentId?: string;
  agentSlug?: string;
  agentName?: string;
  /** Solana address that must receive the creator share instead of request.creator. */
  creatorShareTo?: string;
  /** Signed-in wallet that asked for the plan (audit only). */
  actor?: string;
  ip?: string;
}

export interface PlannedLaunch {
  id: string;
  plan: LaunchPlan;
  createdAt: number;
  beneficiary?: Awaited<ReturnType<typeof resolveSocialTarget>>["public"];
  shares?: FeeShare[];
}

// ─── Request validation ─────────────────────────────────────────────

const urlish = z
  .string()
  .trim()
  .max(512)
  .refine((v) => /^(https?:\/\/|ipfs:\/\/)/i.test(v), "must be an http(s):// or ipfs:// URI");
const social = z.string().trim().max(256).optional();

export const launchRequestSchema = z.object({
  chain: z.enum(CHAIN_ORDER as [ChainId, ...ChainId[]]),
  launchpad: z.enum(LAUNCHPAD_ORDER as [LaunchpadId, ...LaunchpadId[]]),
  name: z.string().trim().min(1).max(64),
  symbol: z.string().trim().min(1).max(16).regex(/^\S+$/, "ticker cannot contain spaces"),
  description: z.string().max(2048).optional(),
  imageUri: urlish,
  metadataUri: urlish.optional(),
  socials: z.object({ twitter: social, telegram: social, website: social, discord: social, farcaster: social }).default({}),
  creator: z.string().trim().min(32).max(64),
  devBuyNative: z.number().finite().min(0).max(10_000),
  slippageBps: z.number().int().min(0).max(5000),
  tax: z
    .object({
      buyBps: z.number().int().min(0).max(10_000),
      sellBps: z.number().int().min(0).max(10_000),
      durationSec: z.number().int().min(0).optional(),
    })
    .optional(),
  vanitySalt: z.string().trim().max(128).optional(),
  mayhemMode: z.boolean().optional(),
  quoteToken: z.string().trim().max(64).optional(),
  beneficiary: z.object({ provider: z.enum(SOCIAL_PROVIDERS), handle: z.string().trim().min(1).max(64) }).optional(),
  feeShares: z
    .array(z.object({ provider: z.enum(SOCIAL_PROVIDERS), handle: z.string().trim().min(1).max(64), bps: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(MAX_FEE_SHARES)
    .optional(),
  agentSlug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i, "invalid agent slug").optional(),
});

/** Parses an untrusted body into a LaunchRequest (throws ZodError). */
export function parseLaunchRequest(body: unknown): LaunchRequest {
  return launchRequestSchema.parse(body) as LaunchRequest;
}

/** ipfs://… or an http(s) gateway URL of the form …/ipfs/<cid>. */
export function isPinnedUri(uri: string | undefined): boolean {
  if (!uri) return false;
  if (/^ipfs:\/\/[A-Za-z0-9]{20,}/.test(uri)) return true;
  try {
    const u = new URL(uri);
    return (u.protocol === "https:" || u.protocol === "http:") && /\/ipfs\/[A-Za-z0-9]{20,}/.test(u.pathname);
  } catch {
    return false;
  }
}

function isLocalHost(uri: string): boolean {
  try {
    const h = new URL(uri).hostname;
    return h === "localhost" || h === "0.0.0.0" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || h.endsWith(".local");
  } catch {
    return false;
  }
}

/**
 * Metadata written on-chain must be permanent. Mainnet + production: image + metadata must be pinned (PINATA_JWT).
 * Mainnet + dev: unpinned URLs are allowed only when publicly reachable (never localhost). Testnet: anything.
 */
export function assertPermanentUris(request: LaunchRequest): void {
  if (IS_TESTNET) return;
  const production = process.env.NODE_ENV === "production";
  for (const [label, uri] of [["metadata", request.metadataUri], ["image", request.imageUri]] as const) {
    if (!uri || isPinnedUri(uri)) continue;
    if (production) {
      throw new LaunchError(
        503,
        "pinning_required",
        launchEnv.pinataJwt()
          ? `The coin ${label} must be pinned to IPFS — upload the image again so it is pinned.`
          : "Image/metadata pinning isn't configured (PINATA_JWT), so coins can't be launched on mainnet right now.",
      );
    }
    if (isLocalHost(uri)) {
      throw new LaunchError(400, "uri_not_public", `The coin ${label} URL (${new URL(uri).host}) isn't reachable from the internet — set PINATA_JWT to pin it.`);
    }
  }
}

/** pump.fun field rules: NFKC, ticker A–Z0–9 ≤ 13, name ≤ 32 bytes — rejected, never truncated. */
function normalizePumpFields(request: LaunchRequest): LaunchRequest {
  const name = normalizeCoinName(request.name);
  if (!name.ok) throw new LaunchError(400, "bad_name", name.error);
  const symbol = normalizeTicker(request.symbol);
  if (!symbol.ok) throw new LaunchError(400, "bad_ticker", symbol.error);
  return { ...request, name: name.value, symbol: symbol.value };
}

// ─── Launching "for" a social account (EVM) ─────────────────────────

const MAX_LAUNCHES_PER_TARGET_24H = 20;

/** Resolves one social target to its stable identity and this chain's SocialVault (checks opt-out + abuse limits). */
async function resolveSocialTarget(request: LaunchRequest, b: { provider: FeeShareTarget["provider"]; handle: string }) {
  let acct;
  try {
    acct = await resolveHandle(b.provider, b.handle);
  } catch (e) {
    if (e instanceof ResolveError) throw new LaunchError(e.status, e.code, e.message);
    throw e;
  }
  const rec = await socialStore.upsertIdentity(acct);
  const name = acct.handle ? "@" + acct.handle : rec.key;
  if (rec.optedOut) throw new LaunchError(403, "opted_out", `${name} has opted out of launches in their name`);
  const recent = await launchStore.countForBeneficiarySince(rec.key, Date.now() - 24 * 3600_000);
  if (recent >= MAX_LAUNCHES_PER_TARGET_24H) {
    throw new LaunchError(429, "target_rate_limited", `Too many launches for ${name} today — try again tomorrow`);
  }
  const vault = await vaultAddress(request.chain, rec.idHash as Hex);
  if (!vault) throw new LaunchError(502, "vault_unavailable", "Couldn't compute the social vault address");
  if (vault.toLowerCase() === request.creator.toLowerCase()) throw new LaunchError(400, "bad_beneficiary", "Invalid beneficiary");
  return {
    key: rec.key,
    vault,
    label: `${name} (${SOCIAL_PROVIDER_LABEL[acct.provider]})`,
    public: {
      identityKey: rec.key,
      provider: acct.provider,
      handle: acct.handle,
      displayName: acct.displayName,
      avatarUrl: acct.avatarUrl,
      followers: acct.followers,
      vault,
    },
  };
}

/**
 * Where the creator side of the fees goes when it isn't (only) the launcher (EVM only):
 *  • one social account taking all of it → that account's SocialVault is the fee recipient (no extra contract);
 *  • otherwise → a ShareSplitter paying the launcher and each account its bps, created by the first launch tx.
 */
async function prepareFeeRouting(request: LaunchRequest) {
  const targets: FeeShareTarget[] = request.feeShares?.length
    ? request.feeShares
    : request.beneficiary
      ? [{ ...(request.beneficiary as SocialBeneficiary), bps: 10_000 }]
      : [];
  if (!targets.length) return undefined;
  if (CHAINS[request.chain].kind !== "evm") {
    throw new LaunchError(501, "social_unsupported_chain", `Sharing fees with social accounts isn't available on ${CHAINS[request.chain].name} yet`);
  }
  if (!socialLaunchpads().includes(request.launchpad)) {
    throw new LaunchError(501, "social_unsupported_launchpad", `${LAUNCHPADS[request.launchpad].name} can't route fees to a social account yet`);
  }
  if (!socialFactory(request.chain)) {
    throw new LaunchError(501, "social_not_deployed", `Social fee vaults aren't deployed on ${CHAINS[request.chain].name} yet`);
  }
  const socialBps = targets.reduce((n, t) => n + t.bps, 0);
  if (socialBps > 10_000) throw new LaunchError(400, "bad_shares", "Social shares add up to more than 100% of the creator fees");
  const seen = new Set<string>();
  const resolved: (Awaited<ReturnType<typeof resolveSocialTarget>> & { bps: number })[] = [];
  for (const t of targets) {
    const r = await resolveSocialTarget(request, t);
    if (seen.has(r.key)) throw new LaunchError(400, "duplicate_share", `${r.label} is listed twice`);
    seen.add(r.key);
    resolved.push({ ...r, bps: t.bps });
  }

  if (resolved.length === 1 && resolved[0].bps === 10_000) {
    const r = resolved[0];
    return { feeRecipient: { address: r.vault, identityKey: r.key, label: r.label }, beneficiary: r.public, first: r };
  }

  const launcherBps = 10_000 - socialBps;
  const shares: FeeShare[] = [
    ...(launcherBps > 0 ? [{ kind: "launcher" as const, address: getAddress(request.creator), bps: launcherBps }] : []),
    ...resolved.map((r) => ({
      kind: "social" as const,
      address: r.vault,
      bps: r.bps,
      identityKey: r.key,
      provider: r.public.provider,
      handle: r.public.handle,
      displayName: r.public.displayName,
      avatarUrl: r.public.avatarUrl,
      followers: r.public.followers,
    })),
  ];
  let setup;
  try {
    setup = await prepareShareSplitter(request.chain, getAddress(request.creator), shares);
  } catch (e) {
    throw new LaunchError(501, "shares_unavailable", (e as Error).message);
  }
  return {
    feeRecipient: { address: setup.splitter, identityKey: resolved[0].key, label: `fee-share splitter (${shareLabel(shares)})` },
    beneficiary: resolved[0].public,
    first: resolved[0],
    shares,
    setup,
  };
}

// ─── Hosted agents ──────────────────────────────────────────────────

export interface HostedAgentRoute {
  agentId: string;
  agentSlug: string;
  agentName: string;
  escrow: string;
}

/**
 * Resolves `slug` to a hosted agent owned by `ownerWallet` and its escrow wallet (creator-share recipient).
 * 409 when the agents table / agent isn't there, 403 when not the owner, 503 when hosted agents are unavailable.
 */
export async function hostedAgentRoute(slug: string, ownerWallet: string): Promise<HostedAgentRoute> {
  if (!pool) throw new LaunchError(503, "hosted_unavailable", "Hosted agents are unavailable (no database)");
  let row: { id: string; owner_wallet: string | null; mode: string; name?: string | null } | undefined;
  try {
    const r = await pool.query(`SELECT id, owner_wallet, mode FROM agents WHERE slug = $1 LIMIT 1`, [slug]);
    row = r.rows[0];
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42703") throw new LaunchError(409, "agent_unavailable", "Agents aren't available on this server yet");
    throw e;
  }
  if (!row) throw new LaunchError(409, "agent_unavailable", `No agent named "${slug}"`);
  if (!row.owner_wallet || row.owner_wallet !== ownerWallet) {
    throw new LaunchError(403, "not_agent_owner", "Only the agent's owner can launch with it — sign in with the owner wallet");
  }
  if (row.mode !== "hosted") {
    throw new LaunchError(409, "agent_not_hosted", "Only hosted agents can receive launch rewards here (external agents launch through the agent API)");
  }
  let name = slug;
  try {
    const n = await pool.query(`SELECT name, status FROM agents WHERE id = $1`, [row.id]);
    if (n.rows[0]?.name) name = String(n.rows[0].name);
    if (n.rows[0]?.status === "banned" || n.rows[0]?.status === "quarantined") {
      throw new LaunchError(403, "agent_suspended", `${name} is ${n.rows[0].status} and can't launch coins`);
    }
  } catch (e) {
    if (e instanceof LaunchError) throw e; // name/status columns are optional
  }
  const escrow = await escrowForAgent(String(row.id));
  if (!escrow) throw new LaunchError(503, "hosted_unavailable", "Hosted agents are unavailable right now — the agent wallet can't be created");
  if (!isSolAddress(escrow)) throw new LaunchError(503, "hosted_unavailable", "The agent wallet address is invalid");
  return { agentId: String(row.id), agentSlug: slug, agentName: name, escrow };
}

// ─── Planning ───────────────────────────────────────────────────────

/** The planned on-chain route of the creator fees, recorded on the launch and verified on confirm. */
function feeRouteOf(plan: LaunchPlan, ctx: LaunchContext): FeeRoute {
  return {
    creator: {
      address: plan.split.creator,
      bps: plan.split.creatorBps,
      kind: ctx.creatorShareTo ? "agent" : "wallet",
      ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
      ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
    },
    platform: { address: plan.split.platform, bps: plan.split.platformBps },
  };
}

export async function planLaunchFor(input: LaunchRequest, ctx: LaunchContext): Promise<PlannedLaunch> {
  let request: LaunchRequest = { ...input };
  if (!deploymentOf(request.launchpad, request.chain)) {
    throw new LaunchError(400, "wrong_chain", `${LAUNCHPADS[request.launchpad].name} is not deployed on ${CHAINS[request.chain].name}`);
  }
  const isEvm = CHAINS[request.chain].kind === "evm";
  if (isEvm ? !/^0x[0-9a-fA-F]{40}$/.test(request.creator) : !isSolAddress(request.creator)) {
    throw new LaunchError(400, "bad_creator", `Creator is not a valid ${isEvm ? "EVM" : "Solana"} address`);
  }
  const adapter = adapterFor(request.launchpad);
  if (adapter.status !== "live" && adapter.status !== "beta") {
    throw new LaunchError(501, "adapter_planned", `${LAUNCHPADS[request.launchpad].name} launches are not available yet`);
  }
  const isAgent = ctx.launchedBy === "agent" || !!ctx.agentId;
  await assertLaunchOpen(request.launchpad, request.chain, { agent: isAgent });

  if (request.launchpad === "pump") request = normalizePumpFields(request);
  if (!isEvm) {
    if (request.beneficiary || request.feeShares?.length) {
      throw new LaunchError(501, "social_unsupported_chain", `Sharing fees with social accounts isn't available on ${CHAINS[request.chain].name} yet`);
    }
    assertPermanentUris(request);
  }
  if (ctx.creatorShareTo) {
    if (isEvm || request.launchpad !== "pump") {
      throw new LaunchError(501, "agent_route_unsupported", `Launching with an agent isn't available on ${LAUNCHPADS[request.launchpad].name} yet`);
    }
    if (!isSolAddress(ctx.creatorShareTo)) throw new LaunchError(400, "bad_recipient", "The creator-share recipient is not a Solana address");
    if (ctx.creatorShareTo === PLATFORM_FEE_WALLET_SOL) throw new LaunchError(400, "bad_recipient", "The creator share can't go to the platform wallet");
  }

  const id = nanoid(16);
  const meta: Record<string, string> = {};
  const socialRoute = await prepareFeeRouting(request);
  const plan = await adapter.plan(request, {
    launchId: id,
    meta,
    feeRecipient: socialRoute?.feeRecipient,
    creatorShareTo: ctx.creatorShareTo ? { address: ctx.creatorShareTo, kind: "agent", agentSlug: ctx.agentSlug, agentName: ctx.agentName } : undefined,
  });
  if (socialRoute?.setup) {
    const { setup, shares } = socialRoute;
    meta.shareSplitter = setup.splitter;
    meta.shareFactory = setup.factory;
    meta.shareSalt = setup.salt;
    // Created first, so the address holds code before any fee can reach it (funds sent earlier are kept anyway).
    if (plan.txs.length) plan.txs.unshift(setup.tx);
    plan.predicted.shareSplitter = setup.splitter;
    plan.split.shares = shares;
    plan.split.mechanism += ` → creator side split by ShareSplitter ${setup.splitter} (${setup.label}; fixed at creation)`;
    plan.split.warnings.push(
      `Of the creator's ${pct(plan.split.creatorBps)}: ${shares.map((x) => `${x.kind === "launcher" ? "you" : x.handle ? "@" + x.handle : x.identityKey} ${pct(x.bps)}`).join(", ")}. Social shares wait in each account's vault until they claim.`,
    );
  }
  plan.split.recipientKind = ctx.creatorShareTo ? "agent" : "wallet";
  plan.split.agent = ctx.creatorShareTo && ctx.agentSlug ? { slug: ctx.agentSlug, name: ctx.agentName ?? ctx.agentSlug } : null;
  if (ctx.actor) meta.plannedBy = ctx.actor;

  const now = Date.now();
  const record: LaunchRecord = {
    id,
    chain: request.chain,
    launchpad: request.launchpad,
    creator: normalizeCreator(request.creator),
    name: request.name,
    symbol: request.symbol,
    imageUri: request.imageUri,
    metadataUri: request.metadataUri,
    request,
    token: plan.predicted.token,
    curve: plan.predicted.curve,
    splitter: plan.predicted.splitter,
    splitKind: LAUNCHPADS[request.launchpad].split,
    beneficiaryIdentity: socialRoute?.first.key,
    beneficiaryVault: socialRoute?.first.vault,
    shares: socialRoute?.shares,
    meta,
    agentId: ctx.agentId,
    launchedBy: isAgent ? "agent" : "human",
    feeRoute: plan.split.platform ? feeRouteOf(plan, ctx) : undefined,
    txHashes: [],
    status: "prepared",
    createdAt: now,
    updatedAt: now,
  };
  await launchStore.save(record);
  return { id, plan, createdAt: now, beneficiary: socialRoute?.beneficiary, shares: socialRoute?.shares };
}
