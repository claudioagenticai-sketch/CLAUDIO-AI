// pump.fun adapter (Solana) — status: beta.
//
// Launch = create_v2 → create_fee_sharing_config → update_fee_shares_v2([creator 7000, platform 3000]) → dev buy
// (buy_exact_quote_in_v2 with creator_vault derived from the sharing_config PDA). See pump/ixs.ts for sources.
//
// Measured 2026-09-28 (mainnet simulateTransaction for create_v2; the full sequence replayed in a mainnet-forked
// LiteSVM — see pump/pump.check.ts): create_v2 ≈ 100–111k CU, but ≈ 150–176k CU in Mayhem mode (the old 150k limit
// made every Mayhem launch fail with "exceeded CUs meter"); create_fee_sharing_config + update_fee_shares_v2
// ≈ 175k CU; ATA + buy_exact_quote_in_v2 ≈ 111–115k CU. Limits below leave ≥ 40% headroom over the Mayhem worst case.
//
// Transaction layout (Solana packet limit 1232 bytes). The fee split MUST land in the same transaction as create_v2
// (otherwise anyone could front-run update_fee_shares_v2 being skipped / the creator could drop it):
//   • With PUMP_LUT_ADDRESS: everything in ONE v0 tx (atomic; dev buy lands in the creation tx). Measured: ~1197 B
//     for a short name + 80-char metadata URI *without* compute-budget ixs; with them it's over the limit, so the
//     atomic layout usually runs without a priority fee ("atomic-lean").
//   • Else [create+split | buy] (split atomic with create, dev buy separate — sniping caveat shown).
//   • [create | split | buy] puts the split in its own tx → refused with 422 split_not_atomic unless
//     PUMP_ALLOW_SPLIT_LAYOUT=true (testing only).
//   Nothing fits → 422 tx_too_large asking the user to shorten the name / ticker / metadata URI.
//
// Fee route: shareholders = [creator-share recipient 7000, PLATFORM_FEE_WALLET_SOL 3000]; the recipient is the
// signing wallet, or ctx.creatorShareTo (a hosted agent's escrow). The platform wallet is compiled in
// (shared/platform.ts); a differing PLATFORM_TREASURY_SOL env refuses the launch (server/platform/treasury.ts).
// confirm() only accepts signatures over the planned messages (meta.planMsgs) by the creator, and only marks the
// coin "launched here" after the on-chain sharing config equals the planned route with the admin revoked.
//
// Mint key: by default the server generates the mint Keypair, partially signs the creation tx and DISCARDS the
// secret (zeroed) — the creator's signature completes it. Vanity (beta): the client grinds a keypair locally and
// sends only its PUBLIC key as `vanitySalt`; the server then leaves the mint signature slot empty
// (partiallySigned=false, signers=[creator, mint]) and the client adds it before handing the tx to the wallet
// (client/src/features/launch/vanity.ts → addMintSignature). The vanity secret never leaves the browser.
import { ComputeBudgetProgram, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { platformRecipientSol } from "../../platform/treasury";
import { FEE_SPLIT, LAUNCHPADS } from "@shared/launchpads";
import { PLATFORM_FEE_WALLET_SOL } from "@shared/platform";
import type { LaunchPlan, LaunchRequest, PreparedTx } from "@shared/types";
import { tokenStore } from "../../store";
import { indexClaudioLaunch } from "../../insights/indexing";
import { B0, BPS, fromUnits, isSolAddress, launchEnv, toUnits } from "../env";
import { PUMP_DEFAULT_CURVE, pumpQuote, type PumpCurve } from "../math";
import { compileTx, pickRandom, simulateSol, solConnection, toBase64, type CompiledTx } from "../sol";
import { LaunchError, type ConfirmResult, type FeeReading, type HarvestResult, type LaunchAdapter, type LaunchRecord, type PlanContext } from "../types";
import {
  BUYBACK_FEE_RECIPIENTS,
  FEE_RECIPIENTS,
  MAYHEM_FEE_RECIPIENTS,
  buyExactQuoteInV2Ix,
  createFeeSharingConfigIx,
  createUserAtaIx,
  createV2Ix,
  decodeBondingCurve,
  decodeGlobalReserves,
  decodeSharingConfig,
  distributeCreatorFeesV2Ix,
  pumpPda,
  transferCreatorFeesToPumpV2Ix,
  updateFeeSharesV2Ix,
} from "../pump/ixs";
import { pickRecipient, pumpFeeRecipients } from "../pump/global";

const RENT_EXEMPT_EMPTY = 890_880; // lamports for a 0-byte system account
/** Rough rent the launch pays (mint + curve + ATAs + sharing config 1 KB + volume accumulator). Display only. */
const EST_RENT_SOL = 0.022;

async function liveCurve(): Promise<PumpCurve> {
  try {
    const info = await solConnection().getAccountInfo(pumpPda.global());
    const g = info ? decodeGlobalReserves(info.data) : null;
    if (g && g.vT > B0 && g.vQ > B0) return { ...PUMP_DEFAULT_CURVE, virtualToken: g.vT, virtualQuote: g.vQ, realToken: g.rT, supply: g.supply };
  } catch {
    /* fall back to constants */
  }
  return PUMP_DEFAULT_CURVE;
}

function cuIxs(units: number): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: launchEnv.pumpPriorityMicroLamports() }),
  ];
}

interface Layout {
  name: string;
  groups: { ixs: TransactionInstruction[]; description: string; hasCreate: boolean; units: number }[];
}

/** The planned [creator-share recipient, platform] route of a launch (records before migration 100 fall back to meta). */
export function expectedRoute(launch: LaunchRecord): { creator: string; creatorBps: number; platform: string; platformBps: number } {
  return {
    creator: launch.feeRoute?.creator.address ?? launch.meta.creatorShareTo ?? launch.request.creator,
    creatorBps: launch.feeRoute?.creator.bps ?? FEE_SPLIT.creatorBps,
    platform: launch.feeRoute?.platform.address ?? launch.meta.platform ?? PLATFORM_FEE_WALLET_SOL,
    platformBps: launch.feeRoute?.platform.bps ?? FEE_SPLIT.platformBps,
  };
}

/** Exact match: active, admin revoked, exactly [creator-share recipient, platform] with the planned bps. */
export function checkSharingConfig(
  cfg: { active: boolean; adminRevoked: boolean; shareholders: { address: PublicKey; bps: number }[] },
  want: { creator: string; creatorBps: number; platform: string; platformBps: number },
): { ok: true } | { ok: false; reason: string } {
  const got = cfg.shareholders.map((h) => `${h.address.toBase58()}:${h.bps}`).sort();
  const exp = [`${want.creator}:${want.creatorBps}`, `${want.platform}:${want.platformBps}`].sort();
  if (!cfg.active) return { ok: false, reason: "sharing config is not active" };
  if (!cfg.adminRevoked) return { ok: false, reason: "the sharing config admin is not revoked (the split could still be changed)" };
  if (got.length !== exp.length || got.some((g, i) => g !== exp[i])) {
    return { ok: false, reason: `shareholders ${cfg.shareholders.map((h) => `${h.address.toBase58().slice(0, 4)}…${h.address.toBase58().slice(-4)} ${h.bps / 100}%`).join(", ")}` };
  }
  return { ok: true };
}

export const pumpAdapter: LaunchAdapter = {
  id: "pump",
  chains: ["sol"],
  status: "beta",
  note: "Hand-built pump.fun instructions; every plan is simulated before you sign.",

  async plan(req: LaunchRequest, ctx: PlanContext): Promise<LaunchPlan> {
    if (!isSolAddress(req.creator)) throw new LaunchError(400, "bad_creator", "Creator must be a Solana address");
    // No Solana social escrow exists yet: never silently pay the creator share to the launcher instead.
    if (ctx.feeRecipient) {
      throw new LaunchError(501, "social_unsupported_chain", "Routing creator fees to a social account isn't available on pump.fun yet");
    }
    const creator = new PublicKey(req.creator);
    const name = req.name.trim();
    const symbol = req.symbol.trim();
    if (Buffer.byteLength(name, "utf8") > 32) throw new LaunchError(400, "name_too_long", "pump.fun names are limited to 32 bytes");
    if (Buffer.byteLength(symbol, "utf8") > 13) throw new LaunchError(400, "symbol_too_long", "pump.fun tickers are limited to 13 bytes");
    const uri = req.metadataUri?.trim();
    if (!uri) throw new LaunchError(400, "metadata_required", "pump.fun needs a metadata URI — upload metadata first");
    if (Buffer.byteLength(uri, "utf8") > 200) throw new LaunchError(400, "uri_too_long", "Metadata URI must be ≤ 200 bytes");

    const blockers: string[] = [];
    const platformB58 = platformRecipientSol(ctx.meta.plannedBy ?? req.creator);
    const platform = new PublicKey(platformB58);
    if (platformB58 === creator.toBase58()) blockers.push("the creator wallet cannot be the platform fee wallet");
    // Creator share: the signing wallet, or a hosted agent's escrow (ctx.creatorShareTo).
    const shareTo = ctx.creatorShareTo ? new PublicKey(ctx.creatorShareTo.address) : creator;
    if (shareTo.equals(platform)) throw new LaunchError(400, "bad_recipient", "The creator share can't go to the platform wallet");

    // Mint: vanity public key from the client, or a fresh server keypair (secret discarded after signing).
    let mintKp: Keypair | null = null;
    let mint: PublicKey;
    const vanity = req.vanitySalt?.trim();
    if (vanity) {
      if (!isSolAddress(vanity)) throw new LaunchError(400, "bad_vanity", "vanitySalt must be the vanity mint public key");
      mint = new PublicKey(vanity);
    } else {
      mintKp = Keypair.generate();
      mint = mintKp.publicKey;
    }

    const mayhem = !!req.mayhemMode;
    const sharing = pumpPda.sharingConfig(mint);
    const bondingCurve = pumpPda.bondingCurve(mint);
    ctx.meta.mint = mint.toBase58();
    ctx.meta.sharingConfig = sharing.toBase58();
    ctx.meta.bondingCurve = bondingCurve.toBase58();
    ctx.meta.mayhem = mayhem ? "1" : "0";

    const conn = solConnection();
    const [curve, latest, lutAcc, recipients] = await Promise.all([
      liveCurve(),
      conn.getLatestBlockhash("confirmed").catch((e: unknown) => {
        throw new LaunchError(503, "rpc_unavailable", `Solana RPC unavailable (${e instanceof Error ? e.message : String(e)}) — try again shortly`);
      }),
      (async () => {
        const addr = launchEnv.pumpLut();
        if (!addr) return null;
        try {
          return (await conn.getAddressLookupTable(new PublicKey(addr))).value;
        } catch {
          return null;
        }
      })(),
      pumpFeeRecipients(),
    ]);
    const inLut = lutAcc ? new Set(lutAcc.state.addresses.map((a) => a.toBase58())) : undefined;

    const spendable = toUnits(req.devBuyNative, 9);
    const quote = pumpQuote(spendable, curve);
    const slip = BigInt(Math.max(0, Math.min(5000, Math.floor(req.slippageBps))));
    const minOut = (quote.tokensOut * (BPS - slip)) / BPS;

    // Instruction groups.
    const createIx = createV2Ix({ mint, user: creator, creator, name, symbol, uri, mayhem });
    const splitIxs = [
      createFeeSharingConfigIx(mint, creator),
      updateFeeSharesV2Ix(mint, creator, [creator], [
        { address: shareTo, bps: FEE_SPLIT.creatorBps },
        { address: platform, bps: FEE_SPLIT.platformBps },
      ]),
    ];
    const buyIxs =
      spendable > B0
        ? [
            createUserAtaIx(mint, creator),
            buyExactQuoteInV2Ix({
              mint,
              user: creator,
              curveCreator: sharing,
              feeRecipient: pickRecipient(mayhem ? recipients.mayhem : recipients.normal, inLut),
              buybackFeeRecipient: pickRecipient(recipients.buyback, inLut),
              spendableLamports: spendable,
              minTokensOut: minOut,
            }),
          ]
        : [];

    const all = [createIx, ...splitIxs, ...buyIxs];
    const layouts: Layout[] = [
      { name: "atomic", groups: [{ ixs: all, description: "Create coin, lock 70/30 split, dev buy", hasCreate: true, units: 700_000 }] },
      { name: "atomic-lean", groups: [{ ixs: all, description: "Create coin, lock 70/30 split, dev buy", hasCreate: true, units: 0 }] },
      {
        name: "create+split | buy",
        groups: [
          { ixs: [createIx, ...splitIxs], description: "Create coin + lock 70/30 fee split", hasCreate: true, units: 500_000 },
          ...(buyIxs.length ? [{ ixs: buyIxs, description: "Dev buy", hasCreate: false, units: 200_000 }] : []),
        ],
      },
      // Split in its own transaction: never in production (see header). Testing only.
      ...(launchEnv.pumpAllowSplitLayout() ? [{
        name: "create | split | buy",
        groups: [
          { ixs: [createIx], description: "Create coin", hasCreate: true, units: 250_000 },
          ...(splitIxs.length ? [{ ixs: splitIxs, description: "Lock 70/30 fee split (one-shot)", hasCreate: false, units: 250_000 }] : []),
          ...(buyIxs.length ? [{ ixs: buyIxs, description: "Dev buy", hasCreate: false, units: 200_000 }] : []),
        ],
      }] : []),
    ];

    let chosen: { layout: Layout; compiled: CompiledTx[] } | null = null;
    for (const layout of layouts) {
      const compiled: CompiledTx[] = [];
      let fits = true;
      for (const g of layout.groups) {
        const ixs = g.units ? [...cuIxs(g.units), ...g.ixs] : g.ixs;
        const c = compileTx(creator, latest.blockhash, ixs, lutAcc, g.hasCreate && mintKp ? [mintKp] : []);
        if (!c) {
          fits = false;
          break;
        }
        compiled.push(c);
      }
      if (fits) {
        chosen = { layout, compiled };
        break;
      }
    }
    // The server mint secret is no longer needed: the signed bytes are all we keep. Drop the reference so the
    // key only lives until GC; it is never logged, stored or returned.
    const serverMint = mintKp !== null;
    mintKp = null;
    if (!chosen) {
      // Would the split-tx layout have fitted? Then the only problem is atomicity (no lookup table).
      const splitFits =
        !launchEnv.pumpAllowSplitLayout() &&
        [[createIx], splitIxs].every((ixs) => !!compileTx(creator, latest.blockhash, [...cuIxs(250_000), ...ixs], lutAcc));
      if (splitFits && !lutAcc) {
        throw new LaunchError(
          422,
          "split_not_atomic",
          "This launch only fits if the fee split goes into a separate transaction, which Claudio doesn't allow. " +
            (launchEnv.pumpLut() ? "The pump lookup table couldn't be loaded — try again in a moment." : "The operator needs to create the pump lookup table (PUMP_LUT_ADDRESS, see the admin page)."),
        );
      }
      throw new LaunchError(
        422,
        "tx_too_large",
        "Your launch doesn't fit into one Solana transaction. Shorten the coin name, ticker, description or links (the metadata link) and try again.",
      );
    }
    ctx.meta.layout = chosen.layout.name;
    // Planned messages: confirm() accepts only signatures by the creator over exactly these bytes.
    ctx.meta.planMsgs = JSON.stringify(chosen.compiled.map((c) => Buffer.from(c.tx.message.serialize()).toString("base64")));
    ctx.meta.creatorShareTo = shareTo.toBase58();
    ctx.meta.platform = platformB58;

    const txs: PreparedTx[] = blockers.length
      ? []
      : chosen.compiled.map((c, i) => {
          const g = chosen!.layout.groups[i];
          const needsMintSig = g.hasCreate && !serverMint;
          return {
            kind: "svm" as const,
            base64: toBase64(c.bytes),
            signers: needsMintSig ? [creator.toBase58(), mint.toBase58()] : [creator.toBase58()],
            partiallySigned: g.hasCreate && serverMint,
            description: `${g.description} (${c.size} B)`,
          };
        });

    // Simulate the first transaction (later ones depend on its state).
    const sim = blockers.length ? null : await simulateSol(chosen.compiled[0].tx);
    const warnings = [...LAUNCHPADS.pump.warnings];
    // Hosted agents: the share goes to a Claudio-held escrow, not the person signing. External agents sign with their
    // own wallet and receive the share there, so there's nothing to warn about.
    if (ctx.creatorShareTo && !shareTo.equals(creator)) {
      warnings.push(`Creator rewards go to ${ctx.creatorShareTo.agentName ?? "the agent"}'s wallet (${shareTo.toBase58()}), run by Claudio — not to the signing wallet.`);
    }
    if (chosen.compiled.length > 1) {
      warnings.push(
        `Launch is split into ${chosen.compiled.length} transactions (no lookup table configured). ` +
          (chosen.layout.name === "create | split | buy"
            ? "TEST LAYOUT: the fee split is NOT atomic with the coin creation. "
            : "The fee split is locked in the creation transaction, but ") +
          "snipers can buy between your create and dev-buy transactions.",
      );
      if (sim?.ok) warnings.push("Only the first transaction could be simulated; the rest depend on it.");
    }
    if (chosen.layout.name === "atomic-lean") {
      warnings.push("Single atomic transaction without a priority fee (it only fits the packet without compute-budget instructions) — it may land slower when Solana is congested.");
    }
    if (mayhem) warnings.push("Mayhem mode: pump.fun cannot CTO this coin, so the fee split cannot be reset by pump.fun.");
    else warnings.push("Without Mayhem mode, pump.fun's CTO process can reset the fee split.");
    if (quote.clamped) warnings.push("Dev buy exceeds the curve's remaining supply and will be clamped.");

    const unitsTotal = chosen.layout.groups.reduce((a, g) => a + g.units, 0); // priced units only (lean = no priority fee)
    const priorityFeeSol = (unitsTotal * launchEnv.pumpPriorityMicroLamports()) / 1e6 / 1e9;
    const estGas = EST_RENT_SOL + priorityFeeSol + 0.000005 * chosen.compiled.length * 2;

    return {
      request: req,
      txs,
      predicted: { token: mint.toBase58(), curve: bondingCurve.toBase58(), splitter: sharing.toBase58() },
      fees: {
        launchFeeNative: 0,
        devBuyNative: req.devBuyNative,
        estGasNative: estGas,
        totalNative: req.devBuyNative + estGas,
      },
      split: {
        creatorBps: FEE_SPLIT.creatorBps,
        platformBps: FEE_SPLIT.platformBps,
        mechanism: `pump_fees sharing_config ${sharing.toBase58()} — shares written once in the creation transaction (admin revoked)`,
        creator: shareTo.toBase58(),
        platform: platformB58,
        warnings,
      },
      devBuyPreview: {
        tokensOut: fromUnits(quote.tokensOut, 6),
        supplyPct: quote.supplyPct,
        priceImpactPct: quote.priceImpactPct,
        snipeTaxPct: 0,
      },
      simulation: blockers.length
        ? { ok: false, error: blockers.join("; ") }
        : { ok: !!sim?.ok, error: sim?.error, gasUsed: sim?.unitsConsumed !== undefined ? `${sim.unitsConsumed} CU` : undefined },
    };
  },

  async confirm(launch: LaunchRecord, hashes: string[]): Promise<ConfirmResult> {
    const conn = solConnection();
    const statuses = (await conn.getSignatureStatuses(hashes, { searchTransactionHistory: true })).value;
    const failed = statuses.findIndex((s) => s?.err);
    if (failed >= 0) return { status: "failed", error: `transaction ${failed + 1} failed: ${JSON.stringify(statuses[failed]?.err)}` };
    if (statuses.some((s) => !s || !s.confirmationStatus || s.confirmationStatus === "processed")) return { status: "submitted" };

    const mint = new PublicKey(launch.meta.mint);
    const sharing = pumpPda.sharingConfig(mint);
    const ids = { token: mint.toBase58(), curve: pumpPda.bondingCurve(mint).toBase58(), splitter: sharing.toBase58() };
    const info = await conn.getAccountInfo(sharing, "confirmed");
    const cfg = info ? decodeSharingConfig(info.data) : null;
    if (!cfg) {
      // Landed but the config isn't visible yet (RPC lag) → retry later; after 10 min it's a real mismatch.
      if (Date.now() - launch.createdAt < 10 * 60_000) return { status: "submitted" };
      return { status: "unverified", ...ids, error: "Coin created but no fee sharing config exists on-chain — the planned fee split was not applied" };
    }
    const check = checkSharingConfig(cfg, expectedRoute(launch));
    if (!check.ok) return { status: "unverified", ...ids, error: `Coin created but its on-chain fee split doesn't match the plan: ${check.reason}` };
    tokenStore.markLaunchedHere(`sol:${mint.toBase58()}`, { kind: "native-locked", splitter: sharing.toBase58() });
    // On the board right away (launchedHere, never evicted) even before our feed sees it; enriched from GMGN.
    indexClaudioLaunch({ ...launch, ...ids }, { feeSplit: { kind: "native-locked", splitter: ids.splitter } });
    return { status: "confirmed", ...ids };
  },

  async harvest(launch: LaunchRecord): Promise<HarvestResult> {
    const mintB58 = launch.token ?? launch.meta.mint;
    if (!mintB58) throw new LaunchError(409, "not_launched", "Launch has no mint yet");
    const mint = new PublicKey(mintB58);
    const payer = new PublicKey(launch.request.creator);
    const conn = solConnection();
    const [cfgInfo, bcInfo, latest] = await Promise.all([
      conn.getAccountInfo(pumpPda.sharingConfig(mint)),
      conn.getAccountInfo(pumpPda.bondingCurve(mint)),
      conn.getLatestBlockhash("confirmed"),
    ]);
    const cfg = cfgInfo ? decodeSharingConfig(cfgInfo.data) : null;
    if (!cfg) throw new LaunchError(409, "no_sharing_config", "No fee sharing config found for this coin");
    const bc = bcInfo ? decodeBondingCurve(bcInfo.data) : null;
    const notes: string[] = [];
    const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })];
    if (bc?.complete) {
      ixs.push(transferCreatorFeesToPumpV2Ix(mint, payer));
      notes.push("Coin graduated: PumpSwap creator fees are swept into the curve vault first.");
    }
    ixs.push(distributeCreatorFeesV2Ix(mint, payer, cfg.shareholders.map((h) => h.address)));
    const compiled = compileTx(payer, latest.blockhash, ixs, null);
    if (!compiled) throw new LaunchError(500, "tx_too_large", "Harvest transaction too large");
    const sim = await simulateSol(compiled.tx);
    if (!sim.ok) notes.push(`Simulation: ${sim.error ?? "failed"} (nothing to distribute yet?)`);
    notes.push(`Pays every shareholder pro-rata: ${cfg.shareholders.map((h) => `${h.address.toBase58().slice(0, 4)}… ${h.bps / 100}%`).join(", ")}.`);
    return {
      txs: [
        {
          kind: "svm",
          base64: toBase64(compiled.bytes),
          signers: [payer.toBase58()],
          partiallySigned: false,
          description: "Distribute creator fees to all shareholders",
        },
      ],
      notes,
    };
  },

  async fees(launch: LaunchRecord): Promise<FeeReading[]> {
    const mintB58 = launch.token ?? launch.meta.mint;
    if (!mintB58) return [];
    const vault = pumpPda.creatorVault(pumpPda.sharingConfig(new PublicKey(mintB58)));
    const lamports = await solConnection().getBalance(vault);
    const claimable = Math.max(0, lamports - RENT_EXEMPT_EMPTY) / 1e9;
    return [
      {
        label: "Curve creator vault",
        amount: claimable,
        symbol: "SOL",
        creatorShare: claimable * (FEE_SPLIT.creatorBps / 10_000),
        note: "PumpSwap fees after graduation are swept in on harvest.",
      },
    ];
  },
};
