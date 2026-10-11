// Fee collector check (never sends a transaction).
//
//   npx tsx server/platform/collector.check.ts                      pure: key parsing, coin selection, batching, ixs
//   npx tsx server/platform/collector.check.ts --prepare plan.json  swap the plan's harvest for the collector's own
//                                                                  distribute tx (throwaway collector key) for the
//                                                                  LiteSVM replay (scripts/pump-replay.cjs)
//   npx tsx server/platform/collector.check.ts --verify state.json plan.json
//                                                                  decode the REAL post-launch sharing config from the
//                                                                  replay, run the selection on it and check that the
//                                                                  collector's distribute paid 70/30
//
// Full fork run (mainnet accounts cloned into LiteSVM):
//   SYNTH_LUT=1 PLAN_OUT=/tmp/p.json npx tsx server/launch/pump/pump.check.ts
//   npx tsx server/platform/collector.check.ts --prepare /tmp/p.json
//   STATE_OUT=/tmp/s.json NODE_PATH=<litesvm>/node_modules node scripts/pump-replay.cjs /tmp/p.json
//   npx tsx server/platform/collector.check.ts --verify /tmp/s.json /tmp/p.json
delete process.env.DATABASE_URL; // pure: in-memory launch store
import { readFileSync, writeFileSync } from "fs";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { PLATFORM_FEE_WALLET_SOL } from "@shared/platform";
import { PUMP_AMM_PROGRAM, PUMP_PROGRAM, decodeBondingCurve, decodeSharingConfig, pumpPda } from "../launch/pump/ixs";

let failures = 0;
function ok(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}

const DISC_SC = [216, 74, 9, 0, 56, 140, 93, 75];
const DISC_BC = [23, 183, 248, 55, 96, 216, 172, 96];

/** SharingConfig bytes as pump_fees lays them out (see decodeSharingConfig). */
function sharingBytes(mint: PublicKey, holders: { address: PublicKey; bps: number }[], opts: { active?: boolean; revoked?: boolean } = {}): Buffer {
  const parts = [Buffer.from(DISC_SC), Buffer.from([255, 2, opts.active === false ? 0 : 1]), mint.toBuffer(), PublicKey.default.toBuffer(), Buffer.from([opts.revoked === false ? 0 : 1])];
  const n = Buffer.alloc(4);
  n.writeUInt32LE(holders.length);
  parts.push(n);
  for (const h of holders) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(h.bps);
    parts.push(h.address.toBuffer(), b);
  }
  return Buffer.concat(parts);
}

function curveBytes(creator: PublicKey, complete: boolean): Buffer {
  const b = Buffer.alloc(8 + 40 + 1 + 32 + 2);
  Buffer.from(DISC_BC).copy(b, 0);
  b.writeUInt8(complete ? 1 : 0, 48);
  creator.toBuffer().copy(b, 49);
  return b;
}

async function pure() {
  const { batches, coinIxs, collectableLaunches, decideCoin, loadCollectorKey, RENT_EXEMPT_EMPTY } = await import("./collector");
  const { launchStore } = await import("../launch/store");

  console.log("\nCOLLECTOR_KEY parsing");
  const kp = Keypair.generate();
  ok(loadCollectorKey(bs58.encode(kp.secretKey)).kp?.publicKey.equals(kp.publicKey), "base58 64-byte secret");
  ok(loadCollectorKey(JSON.stringify(Array.from(kp.secretKey))).kp?.publicKey.equals(kp.publicKey), "JSON array secret");
  ok(!loadCollectorKey("").kp && loadCollectorKey("").reason === "COLLECTOR_KEY not set", "missing → disabled with a reason");
  const bad = loadCollectorKey("not-a-key!!");
  ok(!bad.kp && !!bad.reason && !bad.reason.includes("not-a-key"), "garbage → disabled, secret not echoed");

  console.log("\nselection (decideCoin)");
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const escrow = Keypair.generate().publicKey;
  const platform = new PublicKey(PLATFORM_FEE_WALLET_SOL);
  const sharing = pumpPda.sharingConfig(mint);
  const launch = (shareTo: PublicKey) => ({
    id: "L1",
    token: mint.toBase58(),
    symbol: "TEST",
    meta: { mint: mint.toBase58() },
    request: { creator: creator.toBase58() } as never,
    feeRoute: { creator: { address: shareTo.toBase58(), bps: 7000, kind: "wallet" as const }, platform: { address: PLATFORM_FEE_WALLET_SOL, bps: 3000 } },
  });
  const good = [{ address: creator, bps: 7000 }, { address: platform, bps: 3000 }];
  const reading = (o: Partial<{ holders: typeof good; vault: number; amm: number | null; complete: boolean; curveCreator: PublicKey; revoked: boolean; cfg: boolean; shareTo: PublicKey }> = {}) => ({
    launch: launch(o.shareTo ?? creator),
    mint: mint.toBase58(),
    cfg: o.cfg === false ? null : decodeSharingConfig(sharingBytes(mint, o.holders ?? good, { revoked: o.revoked })),
    curve: decodeBondingCurve(curveBytes(o.curveCreator ?? sharing, o.complete ?? false)),
    vaultLamports: o.vault ?? RENT_EXEMPT_EMPTY + 60_000_000,
    ammVaultLamports: o.amm ?? null,
  });
  const MIN = 50_000_000;
  let d = decideCoin(reading(), MIN);
  ok(d.action === "distribute" && d.claimable === 60_000_000 && !d.sweep, "planned route + 0.06 SOL → distribute 0.06 (vault keeps rent)");
  d = decideCoin(reading({ vault: RENT_EXEMPT_EMPTY + 49_999_999 }), MIN);
  ok(d.action === "skip" && /below minimum/.test(d.reason ?? ""), "below COLLECTOR_MIN_SOL → skip");
  d = decideCoin(reading({ cfg: false }), MIN);
  ok(d.action === "skip" && !d.mismatch, "no sharing config → skip");
  d = decideCoin(reading({ holders: [{ address: creator, bps: 10_000 }] }), MIN);
  ok(d.action === "skip" && d.mismatch, "creator-only shareholders (split not applied) → mismatch, untouched");
  d = decideCoin(reading({ holders: [{ address: Keypair.generate().publicKey, bps: 7000 }, { address: platform, bps: 3000 }] }), MIN);
  ok(d.action === "skip" && d.mismatch, "foreign creator shareholder → mismatch");
  d = decideCoin(reading({ holders: [{ address: creator, bps: 8000 }, { address: platform, bps: 2000 }] }), MIN);
  ok(d.action === "skip" && d.mismatch, "wrong bps → mismatch");
  d = decideCoin(reading({ revoked: false }), MIN);
  ok(d.action === "skip" && d.mismatch, "admin not revoked → mismatch");
  d = decideCoin(reading({ curveCreator: creator }), MIN);
  ok(d.action === "skip" && d.mismatch, "bonding curve creator ≠ sharing config (CTO/reset) → mismatch");
  d = decideCoin(reading({ shareTo: escrow, holders: [{ address: escrow, bps: 7000 }, { address: platform, bps: 3000 }] }), MIN);
  ok(d.action === "distribute", "hosted-agent route (escrow 70 / platform 30) → distribute");
  d = decideCoin(reading({ complete: true, vault: RENT_EXEMPT_EMPTY + 10_000_000, amm: 45_000_000 }), MIN);
  ok(d.action === "distribute" && d.sweep && d.claimable === 55_000_000, "graduated: PumpSwap fees count, sweep first");
  d = decideCoin(reading({ complete: false, vault: RENT_EXEMPT_EMPTY + 10_000_000, amm: 45_000_000 }), MIN);
  ok(d.action === "skip" && !d.sweep, "not graduated: AMM vault ignored");

  d = decideCoin({ ...reading(), launch: { ...reading().launch, feeRoute: undefined } as never }, MIN);
  ok(d.action === "skip" && !d.mismatch && /legacy/.test(d.reason ?? ""), "legacy launch (no recorded route) → skipped quietly, no alarm");

  console.log("\nbatching + instructions");
  const b = batches([1, 2, 3, 4, 5, 6, 7], 3);
  ok(JSON.stringify(b) === "[[1,2,3],[4,5,6],[7]]", "7 coins → 3 + 3 + 1");
  const payer = Keypair.generate().publicKey;
  const ixs = coinIxs(decideCoin(reading({ complete: true, amm: 60_000_000 }), MIN), payer);
  ok(ixs.length === 2 && ixs[0].programId.equals(PUMP_AMM_PROGRAM) && ixs[1].programId.equals(PUMP_PROGRAM), "graduated coin → transfer_creator_fees_to_pump_v2 then distribute_creator_fees_v2");
  const dist = ixs[1];
  ok(dist.keys[0].pubkey.equals(payer) && dist.keys[0].isSigner, "collector is the payer/signer");
  ok(dist.keys.slice(-2).map((k) => k.pubkey.toBase58()).join() === [creator, platform].map((p) => p.toBase58()).join(), "remaining accounts = on-chain shareholders in order");

  console.log("\nwhich launches are collected");
  const now = Date.now();
  const rec = (id: string, status: string, chain: string, launchpad: string) =>
    launchStore.save({ id, chain, launchpad, status, creator: creator.toBase58(), name: id, symbol: id, request: {} as never, token: Keypair.generate().publicKey.toBase58(), splitKind: "x", meta: {}, txHashes: [], createdAt: now, updatedAt: now } as never);
  await rec("c-sol-pump", "confirmed", "sol", "pump");
  await rec("u-sol-pump", "unverified", "sol", "pump");
  await rec("s-sol-pump", "submitted", "sol", "pump");
  await rec("f-sol-pump", "failed", "sol", "pump");
  await rec("c-sol-bags", "confirmed", "sol", "bags");
  await rec("c-hood-pons", "confirmed", "hood", "pons");
  const picked = (await collectableLaunches()).map((l) => l.id);
  ok(picked.length === 1 && picked[0] === "c-sol-pump", `only confirmed Solana pump.fun launches (got ${picked.join(",")})`);
}

async function prepare(planFile: string) {
  const { coinIxs } = await import("./collector");
  const { compileTx, toBase64 } = await import("../launch/sol");
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const mint = new PublicKey(plan.meta.mint);
  const shareTo = new PublicKey(plan.meta.creatorShareTo ?? plan.creator);
  const holders = [shareTo, new PublicKey(plan.meta.platform ?? PLATFORM_FEE_WALLET_SOL)];
  const collector = Keypair.generate();
  const fake = {
    reading: { mint: mint.toBase58(), cfg: { shareholders: holders.map((address) => ({ address, bps: 0 })) } },
    sweep: false,
  } as never;
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...coinIxs(fake, collector.publicKey)];
  const c = compileTx(collector.publicKey, "11111111111111111111111111111111", ixs, null, [collector]);
  if (!c) throw new Error("collector tx too large");
  plan.harvest = [{ kind: "svm", base64: toBase64(c.bytes), signers: [collector.publicKey.toBase58()], partiallySigned: false, description: "Collector: distribute_creator_fees_v2" }];
  plan.fund = [collector.publicKey.toBase58()];
  plan.watch = [...holders.map((h) => h.toBase58()), collector.publicKey.toBase58()];
  writeFileSync(planFile, JSON.stringify(plan, null, 1));
  console.log(`prepared: collector ${collector.publicKey.toBase58()} distributes ${mint.toBase58()} to ${holders.map((h) => h.toBase58()).join(", ")}`);
}

async function verify(stateFile: string, planFile: string) {
  const { decideCoin, RENT_EXEMPT_EMPTY, MIN_DISTRIBUTABLE_VAULT } = await import("./collector");
  const { checkSharingConfig } = await import("../launch/adapters/pump");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const a = state.afterLaunch;
  console.log("\nreal post-launch state from the LiteSVM fork");
  ok(!!a?.sharingConfig, "sharing config exists after the atomic launch tx");
  const cfg = decodeSharingConfig(Buffer.from(a.sharingConfig.data, "base64"));
  const curve = decodeBondingCurve(Buffer.from(a.bondingCurve.data, "base64"));
  const shareTo = plan.meta.creatorShareTo ?? plan.creator;
  const want = { creator: shareTo, creatorBps: 7000, platform: PLATFORM_FEE_WALLET_SOL, platformBps: 3000 };
  ok(cfg && checkSharingConfig(cfg, want).ok, `on-chain shareholders = [${shareTo.slice(0, 4)}… 70%, platform 30%], admin revoked`);
  ok(cfg && !checkSharingConfig(cfg, { ...want, creator: Keypair.generate().publicKey.toBase58() }).ok, "a different planned recipient is detected as a mismatch");
  ok(curve?.creator.equals(pumpPda.sharingConfig(new PublicKey(plan.meta.mint))), "bonding_curve.creator = sharing config PDA");
  const vault = a.creatorVault?.lamports ?? 0;
  console.log(`  creator vault after dev buy: ${vault} lamports (${vault - RENT_EXEMPT_EMPTY} claimable)`);
  const d = decideCoin(
    {
      launch: { id: "x", token: plan.meta.mint, symbol: "CHK", meta: plan.meta, request: { creator: plan.creator } as never, feeRoute: { creator: { address: shareTo, bps: 7000, kind: "wallet" }, platform: { address: PLATFORM_FEE_WALLET_SOL, bps: 3000 } } },
      mint: plan.meta.mint,
      cfg,
      curve,
      vaultLamports: vault,
      ammVaultLamports: null,
    },
    1,
  );
  const bal = state.balances as Record<string, number>;
  const [creatorGot, platformGot] = [bal[shareTo] ?? 0, bal[PLATFORM_FEE_WALLET_SOL] ?? 0];
  const collector = (plan.fund ?? [])[0];
  console.log(`  collector distribute: creator +${creatorGot}, platform +${platformGot}, collector ${bal[collector]}`);
  if (vault < MIN_DISTRIBUTABLE_VAULT) {
    ok(d.action === "skip", `selection: vault below pump's minimum (${MIN_DISTRIBUTABLE_VAULT}) → skip (${d.reason})`);
    ok(creatorGot === 0 && platformGot === 0, "the program indeed paid nothing (so skipping saves the fee)");
  } else {
    ok(d.action === "distribute" && d.claimable === vault - RENT_EXEMPT_EMPTY, `selection: distribute ${d.claimable} lamports`);
    ok(creatorGot + platformGot >= d.claimable - 2 && creatorGot + platformGot <= d.claimable, "everything claimable was paid out");
    ok(Math.abs(creatorGot * 3 - platformGot * 7) <= 10, "paid 70/30");
  }
  ok(bal[collector] < 0 && bal[collector] > -20_000, "collector only paid the tx fee");
}

const [mode, a1, a2] = process.argv.slice(2);
(mode === "--prepare" ? prepare(a1) : mode === "--verify" ? verify(a1, a2) : pure())
  .then(() => {
    console.log(failures ? `\n${failures} failure(s)` : "\ncollector: all checks passed");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
