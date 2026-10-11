// Social fee accounts: launch "for" an X/Farcaster/GitHub account, and let its owner sign in (Auth0 or Clerk) and claim.
//   GET  /api/social/config                  what's enabled (auth providers, lookup providers, chains with vaults)
//   POST /api/social/resolve   {provider, handle}      → resolved account + where its fees would go
//   GET  /api/social/token/:chain/:address   who a token's creator fees belong to ("Is this you? Claim")
//   GET  /api/social/me                      (auth) your verified accounts + claimable vaults per chain
//   POST /api/social/claim     {identityKey, chain, wallet}   (auth) → signed bind tx for the user's wallet to send
//   POST /api/social/claim/:id/submitted {txHash}   (auth) record the claim tx
//   POST /api/social/opt-out   {identityKey, optedOut}        (auth) refuse future launches in your name
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { encodeFunctionData, formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";
import { CHAINS, CHAIN_ORDER, type ChainId } from "@shared/chains";
import { HANDLE_KEYED, SIGN_IN_VIA, SOCIAL_PROVIDERS, type FeeShare, type TokenBeneficiary } from "@shared/social";
import { evmClient } from "../trade/evm";
import { launchStore } from "../launch/store";
import { launchEnv } from "../launch/env";
import { AuthError, authenticate, enabledAuthProviders, type AuthedUser } from "../social/auth";
import { attestorAddress, signBind, socialFactory, vaultAddress, SOCIAL_FACTORY_ABI, SOCIAL_VAULT_ABI } from "../social/attest";
import { identityKey, parseIdentityKey } from "../social/identity";
import { ResolveError, resolvableProviders, resolveHandle } from "../social/resolve";
import { socialStore } from "../social/store";
import { RelayError, relay, relayerEnabled } from "../relayer";
import { socialLaunchpads } from "../launch/registry";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return next();
    }
    if (++h.n > max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "Too many requests — slow down." });
    }
    return next();
  };
}

function sendError(res: Response, e: unknown) {
  if (e instanceof AuthError || e instanceof ResolveError || e instanceof RelayError) return res.status(e.status).json({ error: e.code, message: e.message });
  if (e instanceof z.ZodError) return res.status(400).json({ error: "invalid_request", message: e.issues[0]?.message ?? "Invalid request" });
  console.error("[social]", e);
  return res.status(500).json({ error: "internal", message: e instanceof Error ? e.message : "Internal error" });
}

/** EVM chains where a SocialVaultFactory is configured. */
export function socialChains(): ChainId[] {
  return CHAIN_ORDER.filter((c) => CHAINS[c].enabled && CHAINS[c].kind === "evm" && !!socialFactory(c));
}

interface VaultState {
  chain: ChainId;
  vault: Address;
  deployed: boolean;
  balance: string; // native, human units
  symbol: string;
  beneficiary: Address | null;
  pendingBeneficiary: Address | null;
  readyAt: number | null;
}

async function vaultState(chain: ChainId, idHash: Hex): Promise<VaultState | null> {
  const vault = await vaultAddress(chain, idHash);
  if (!vault) return null;
  const c = evmClient(chain);
  const [code, bal] = await Promise.all([c.getCode({ address: vault }), c.getBalance({ address: vault })]);
  const deployed = !!code && code !== "0x";
  let beneficiary: Address | null = null;
  let pending: Address | null = null;
  let readyAt: number | null = null;
  if (deployed) {
    const [b, p, r] = await Promise.all([
      c.readContract({ address: vault, abi: SOCIAL_VAULT_ABI, functionName: "beneficiary" }),
      c.readContract({ address: vault, abi: SOCIAL_VAULT_ABI, functionName: "pendingBeneficiary" }),
      c.readContract({ address: vault, abi: SOCIAL_VAULT_ABI, functionName: "readyAt" }),
    ]);
    beneficiary = b === ZERO ? null : b;
    pending = p === ZERO ? null : p;
    readyAt = Number(r) || null;
  }
  return { chain, vault, deployed, balance: formatUnits(bal, CHAINS[chain].nativeDecimals), symbol: CHAINS[chain].nativeSymbol, beneficiary, pendingBeneficiary: pending, readyAt };
}

async function requireUser(req: Request): Promise<AuthedUser> {
  const user = await authenticate(req);
  // Remember what this sign-in proved, and refresh the display fields we show on token pages.
  for (const a of user.accounts) {
    const rec = await socialStore.upsertIdentity({ ...a, verified: true });
    await socialStore.link(a.via, a.subject, rec.key);
  }
  return user;
}

const resolveSchema = z.object({ provider: z.enum(SOCIAL_PROVIDERS), handle: z.string().trim().min(1).max(64) });
const claimSchema = z.object({
  identityKey: z.string().min(3).max(128),
  chain: z.enum(CHAIN_ORDER as [ChainId, ...ChainId[]]),
  wallet: z.string().refine((v) => isAddress(v), "wallet must be an EVM address"),
  /** Let the server's gas relayer submit the claim (the claimer needs no gas). */
  relay: z.boolean().optional(),
});
const submittedSchema = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });
const optOutSchema = z.object({ identityKey: z.string().min(3).max(128), optedOut: z.boolean() });

/** Loud startup warnings for sign-in settings that would weaken claims in production. */
function warnAuthConfig() {
  const prod = process.env.NODE_ENV === "production";
  const e = (n: string) => process.env[n]?.trim();
  if (e("CLERK_SECRET_KEY")) {
    if (!e("CLERK_AUTHORIZED_PARTIES")) console.warn("[social] CLERK_AUTHORIZED_PARTIES is not set: Clerk sessions from any origin are accepted");
    if (prod && e("CLERK_SECRET_KEY")!.startsWith("sk_test_")) console.warn("[social] Clerk is using a DEVELOPMENT instance (sk_test_) in production");
  }
  if (e("AUTH0_DOMAIN") && !e("AUTH0_CLIENT_ID") && !e("VITE_AUTH0_CLIENT_ID")) {
    console.warn("[social] AUTH0_CLIENT_ID is not set: access tokens issued to other apps in the tenant are accepted");
  }
}

export function registerSocialRoutes(app: Express): void {
  warnAuthConfig();
  const light = rateLimit(60, 60_000);
  const lookup = rateLimit(20, 60_000); // X lookups cost money
  const claimLimit = rateLimit(10, 60_000);

  app.get("/api/social/config", (_req, res) => {
    res.json({
      authProviders: enabledAuthProviders(),
      resolvable: resolvableProviders(),
      /** Which sign-in service each social uses (buttons are shown only when that service is configured). */
      signInVia: SIGN_IN_VIA,
      handleKeyed: Array.from(HANDLE_KEYED),
      chains: socialChains(),
      attestor: attestorAddress(),
      launchpads: socialLaunchpads(),
      /** Chains where the creator share can be split between the launcher and several accounts. */
      shareChains: socialChains().filter((c) => !!launchEnv.shareFactory(c)),
      relayer: socialChains().filter((c) => relayerEnabled(c)),
    });
  });

  app.post("/api/social/resolve", lookup, async (req, res) => {
    try {
      const { provider, handle } = resolveSchema.parse(req.body);
      const acct = await resolveHandle(provider, handle);
      const rec = await socialStore.upsertIdentity(acct);
      const vaults: Partial<Record<ChainId, string>> = {};
      for (const c of socialChains()) {
        const v = await vaultAddress(c, rec.idHash as Hex).catch(() => null);
        if (v) vaults[c] = v;
      }
      res.json({ account: acct, identityKey: rec.key, optedOut: rec.optedOut, claimed: !!rec.verifiedAt, vaults });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/social/token/:chain/:address", light, async (req, res) => {
    try {
      const chain = req.params.chain as ChainId;
      if (!CHAIN_ORDER.includes(chain)) return res.status(400).json({ error: "bad_chain", message: "Unknown chain" });
      const launch = await launchStore.byToken(chain, req.params.address);
      if (!launch?.beneficiaryIdentity || !launch.beneficiaryVault) return res.json({ beneficiary: null });
      const id = await socialStore.getIdentity(launch.beneficiaryIdentity);
      const parsed = parseIdentityKey(launch.beneficiaryIdentity);
      if (!parsed) return res.json({ beneficiary: null });
      const state = CHAINS[chain].kind === "evm" && id ? await vaultState(chain, id.idHash as Hex).catch(() => null) : null;
      const beneficiary: TokenBeneficiary = {
        identityKey: launch.beneficiaryIdentity,
        provider: parsed.provider,
        handle: id?.handle ?? undefined,
        displayName: id?.displayName ?? undefined,
        avatarUrl: id?.avatarUrl ?? undefined,
        vault: launch.beneficiaryVault,
        claimed: !!state?.beneficiary,
      };
      // Split launches: every recipient of the creator side, with each social vault's claim status.
      const shares: FeeShare[] | undefined = launch.shares?.length
        ? await Promise.all(
            launch.shares.map(async (sh) => {
              if (sh.kind !== "social" || CHAINS[chain].kind !== "evm") return sh;
              const b = await evmClient(chain)
                .readContract({ address: getAddress(sh.address), abi: SOCIAL_VAULT_ABI, functionName: "beneficiary" })
                .catch(() => ZERO);
              return { ...sh, claimed: b !== ZERO };
            }),
          )
        : undefined;
      res.json({ beneficiary, vault: state, shares });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/social/me", light, async (req, res) => {
    try {
      const user = await requireUser(req);
      const chains = socialChains();
      const accounts = await Promise.all(
        user.accounts.map(async (a) => {
          const key = identityKey(a);
          const rec = await socialStore.getIdentity(key);
          const idHash = (rec?.idHash ?? "") as Hex;
          const vaults = (await Promise.all(chains.map((c) => vaultState(c, idHash).catch(() => null)))).filter(Boolean);
          const launches = (await launchStore.byBeneficiary(key, 50))
            .filter((l) => l.status === "confirmed")
            .map((l) => ({ id: l.id, chain: l.chain, launchpad: l.launchpad, name: l.name, symbol: l.symbol, token: l.token, imageUri: l.imageUri }));
          const { subject: _s, ...pub } = a;
          return { ...pub, identityKey: key, optedOut: rec?.optedOut ?? false, vaults, launches };
        }),
      );
      res.json({ sessions: user.sessions.map((x) => x.authProvider), accounts });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/social/claim", claimLimit, async (req, res) => {
    try {
      const user = await requireUser(req);
      const { identityKey: key, chain, wallet, relay: wantRelay } = claimSchema.parse(req.body);
      // The only check that matters: this sign-in PROVED control of exactly this identity.
      const proof = user.accounts.find((a) => identityKey(a) === key);
      if (!proof) {
        return res.status(403).json({ error: "not_your_account", message: "Sign in with that account to claim it" });
      }
      if (CHAINS[chain].kind !== "evm" || !socialFactory(chain)) {
        return res.status(501).json({ error: "chain_unsupported", message: `Claiming isn't available on ${CHAINS[chain].name} yet` });
      }
      const rec = await socialStore.getIdentity(key);
      if (!rec) return res.status(404).json({ error: "unknown_identity", message: "Nothing has been launched for this account" });
      const state = await vaultState(chain, rec.idHash as Hex);
      if (state?.beneficiary) {
        return res.status(409).json({ error: "already_claimed", message: `Already claimed — fees go to ${state.beneficiary}` });
      }
      const att = await signBind(chain, rec.idHash as Hex, getAddress(wallet));
      // Sweep native + every token launched for this identity on this chain (their memecoin fee share).
      const tokens = (await launchStore.byBeneficiary(key, 200))
        .filter((l) => l.chain === chain && l.status === "confirmed" && l.token && isAddress(l.token))
        .map((l) => getAddress(l.token!));
      const sweep = [ZERO, ...Array.from(new Set(tokens))] as Address[];
      const claim = await socialStore.recordClaim({
        identityKey: key,
        chain,
        wallet: att.wallet,
        vault: state?.vault ?? "",
        authProvider: proof.via,
        authSubject: proof.subject,
        nonce: att.nonce,
        deadline: Number(att.deadline),
        signature: att.signature,
        ip: req.ip ?? null,
      });
      const bindDelay = Number(await evmClient(chain).readContract({ address: att.factory, abi: SOCIAL_FACTORY_ABI, functionName: "bindDelay" }));
      const data = encodeFunctionData({
        abi: SOCIAL_FACTORY_ABI,
        functionName: "bind",
        args: [att.identity, att.wallet, BigInt(att.deadline), att.signature, sweep],
      });
      // Gas-free: the relayer submits the bind. Funds still only go to the wallet named in the signed attestation.
      if (wantRelay && relayerEnabled(chain)) {
        try {
          const r = await relay(chain, { to: att.factory, data }, `claim ${key}`);
          await socialStore.updateClaim(claim.id, { status: r.status === "success" ? (bindDelay ? "pending" : "bound") : "failed", txHash: r.hash });
          return res.json({ claimId: claim.id, bindDelaySec: bindDelay, relayed: r });
        } catch (e) {
          // Relayer unavailable (budget, balance…): fall through and let the user sign it themselves.
          if (!(e instanceof RelayError) || e.status < 500) throw e;
        }
      }
      res.json({
        claimId: claim.id,
        bindDelaySec: bindDelay,
        tx: {
          kind: "evm",
          chainId: att.chainId,
          to: att.factory,
          value: "0",
          data,
          description: bindDelay
            ? `Claim ${rec.handle ? "@" + rec.handle : key} — funds unlock after ${Math.round(bindDelay / 3600)}h`
            : `Claim ${rec.handle ? "@" + rec.handle : key} and receive ${state?.balance ?? "0"} ${CHAINS[chain].nativeSymbol}`,
        },
      });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/social/claim/:id/submitted", claimLimit, async (req, res) => {
    try {
      const user = await requireUser(req);
      const { txHash } = submittedSchema.parse(req.body);
      const claim = await socialStore.getClaim(req.params.id);
      if (!claim || !user.sessions.some((x) => x.authProvider === claim.authProvider && x.subject === claim.authSubject)) return res.status(404).json({ error: "not_found", message: "Unknown claim" });
      await socialStore.updateClaim(claim.id, { status: "submitted", txHash });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/social/opt-out", claimLimit, async (req, res) => {
    try {
      const user = await requireUser(req);
      const { identityKey: key, optedOut } = optOutSchema.parse(req.body);
      if (!user.accounts.some((a) => identityKey(a) === key)) {
        return res.status(403).json({ error: "not_your_account", message: "Sign in with that account first" });
      }
      await socialStore.setOptedOut(key, optedOut);
      res.json({ ok: true, optedOut });
    } catch (e) {
      sendError(res, e);
    }
  });
}
