// Launch confirm check (offline; the Solana RPC is mocked). Covers:
//   • only the creator's signatures over the PLANNED messages are accepted (launch/verify.ts);
//   • pumpAdapter.confirm marks a launch confirmed only when the on-chain sharing config equals the planned route
//     (creator-or-escrow 7000 / PLATFORM_FEE_WALLET_SOL 3000, admin revoked) — otherwise "unverified", no badge.
//
//   npx tsx server/launch/confirm.check.ts                    (synthetic sharing config bytes)
//   STATE=<replay state.json> PLAN=<plan.json> npx tsx …      (also the REAL config from the LiteSVM fork replay)
delete process.env.DATABASE_URL;
import { readFileSync } from "fs";
import { Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { PLATFORM_FEE_WALLET_SOL } from "@shared/platform";
import { pumpPda } from "./pump/ixs";

let failures = 0;
function ok(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}

function sharingBytes(mint: PublicKey, holders: { address: PublicKey; bps: number }[], revoked = true): Buffer {
  const parts = [Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]), Buffer.from([255, 2, 1]), mint.toBuffer(), PublicKey.default.toBuffer(), Buffer.from([revoked ? 1 : 0])];
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

async function main() {
  const { verifySolHashes, plannedIndexOf } = await import("./verify");
  const { pumpAdapter } = await import("./adapters/pump");
  const { solConnection } = await import("./sol");
  const { tokenStore } = await import("../store");

  const creator = Keypair.generate();
  const stranger = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const platform = new PublicKey(PLATFORM_FEE_WALLET_SOL);
  const msg = (n: number) =>
    new TransactionMessage({
      payerKey: creator.publicKey,
      recentBlockhash: bs58.encode(Buffer.alloc(32, n)),
      instructions: [SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: mint, lamports: n })],
    }).compileToLegacyMessage();
  const planned = [msg(1), msg(2)];
  // A tx id = the fee payer's ed25519 signature over the message bytes (raw signing also lets a stranger "sign" it).
  const signedBy = (kp: Keypair, m: ReturnType<typeof msg>) => bs58.encode(ed25519.sign(m.serialize(), kp.secretKey.slice(0, 32)));
  const launch = {
    id: "chk",
    chain: "sol",
    launchpad: "pump",
    creator: creator.publicKey.toBase58(),
    name: "Check",
    symbol: "CHK",
    request: { creator: creator.publicKey.toBase58() },
    meta: { mint: mint.toBase58(), planMsgs: JSON.stringify(planned.map((m) => Buffer.from(m.serialize()).toString("base64"))) },
    splitKind: "native-locked",
    txHashes: [] as string[],
    status: "submitted",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    feeRoute: { creator: { address: creator.publicKey.toBase58(), bps: 7000, kind: "wallet" }, platform: { address: PLATFORM_FEE_WALLET_SOL, bps: 3000 } },
  } as never as import("./types").LaunchRecord;

  console.log("\nplanned-signature verification");
  const h1 = signedBy(creator, planned[0]);
  const h2 = signedBy(creator, planned[1]);
  ok(plannedIndexOf(launch, h1) === 0 && plannedIndexOf(launch, h2) === 1, "creator signatures over planned messages map to their tx index");
  let v = await verifySolHashes(launch, [h2, h1], { online: false });
  ok(v.accepted.join() === [h1, h2].join() && !v.rejected.length, "accepted in planned order");
  const foreign = signedBy(stranger, planned[0]);
  v = await verifySolHashes(launch, [foreign], { online: false });
  ok(!v.accepted.length && v.pending.length === 1, "a third party's signature over the same message is not accepted");
  const otherMsg = signedBy(creator, msg(9));
  v = await verifySolHashes(launch, [otherMsg], { online: false });
  ok(!v.accepted.length, "the creator's signature over a different (unplanned) message is not accepted");
  v = await verifySolHashes(launch, ["not-a-signature", "1111"], { online: false });
  ok(v.rejected.length === 2 && !v.accepted.length, "garbage hashes rejected");
  // Online fallback: a landed tx paid by someone else (or without the mint) is rejected outright.
  const conn = solConnection() as unknown as Record<string, unknown>;
  conn.getTransaction = async () => ({ transaction: { message: { staticAccountKeys: [stranger.publicKey, mint] } } });
  v = await verifySolHashes(launch, [foreign]);
  ok(v.rejected.length === 1 && !v.accepted.length, "on-chain fallback: fee payer ≠ creator → rejected");
  conn.getTransaction = async () => ({ transaction: { message: { staticAccountKeys: [creator.publicKey, mint] } } });
  v = await verifySolHashes(launch, [otherMsg]);
  ok(v.accepted.length === 1, "on-chain fallback: creator-paid tx touching the mint (wallet re-wrote the dev buy) → accepted");
  conn.getTransaction = async () => null;
  v = await verifySolHashes(launch, [otherMsg]);
  ok(v.pending.length === 1, "not landed yet → pending (re-checked by the reconciler)");

  console.log("\npumpAdapter.confirm against the planned route");
  let marked = 0;
  (tokenStore as unknown as Record<string, unknown>).markLaunchedHere = () => {
    marked++;
  };
  const confirmed = { confirmationStatus: "confirmed", err: null };
  let cfgData: Buffer | null = null;
  conn.getSignatureStatuses = async (hs: string[]) => ({ value: hs.map(() => confirmed) });
  conn.getAccountInfo = async (k: PublicKey) => (k.equals(pumpPda.sharingConfig(mint)) && cfgData ? { data: cfgData, lamports: 1, owner: PublicKey.default, executable: false } : null);
  const run = async (data: Buffer | null, l = launch) => {
    cfgData = data;
    const before = marked;
    const r = await pumpAdapter.confirm!(l, [h1]);
    return { ...r, badge: marked > before };
  };
  let r = await run(sharingBytes(mint, [{ address: creator.publicKey, bps: 7000 }, { address: platform, bps: 3000 }]));
  ok(r.status === "confirmed" && r.badge, "exact route → confirmed + launched-here badge");
  r = await run(sharingBytes(mint, [{ address: platform, bps: 3000 }, { address: creator.publicKey, bps: 7000 }]));
  ok(r.status === "confirmed", "shareholder order doesn't matter");
  r = await run(sharingBytes(mint, [{ address: creator.publicKey, bps: 10_000 }]));
  ok(r.status === "unverified" && !r.badge, `split never applied → unverified, no badge (${r.error})`);
  r = await run(sharingBytes(mint, [{ address: creator.publicKey, bps: 7000 }, { address: Keypair.generate().publicKey, bps: 3000 }]));
  ok(r.status === "unverified" && !r.badge, "platform share to another wallet → unverified");
  r = await run(sharingBytes(mint, [{ address: creator.publicKey, bps: 7000 }, { address: platform, bps: 3000 }], false));
  ok(r.status === "unverified" && !r.badge, "admin not revoked → unverified");
  const agentLaunch = { ...launch, feeRoute: { creator: { address: Keypair.generate().publicKey.toBase58(), bps: 7000, kind: "agent" }, platform: { address: PLATFORM_FEE_WALLET_SOL, bps: 3000 } } } as never;
  r = await run(sharingBytes(mint, [{ address: creator.publicKey, bps: 7000 }, { address: platform, bps: 3000 }]), agentLaunch);
  ok(r.status === "unverified", "agent launch whose 70% went to the signer instead of the escrow → unverified");
  r = await run(null);
  ok(r.status === "submitted", "landed but config not visible yet (young) → stays submitted");
  r = await run(null, { ...launch, createdAt: Date.now() - 11 * 60_000 } as never);
  ok(r.status === "unverified", "no config 10+ min later → unverified");
  conn.getSignatureStatuses = async (hs: string[]) => ({ value: hs.map(() => ({ confirmationStatus: "confirmed", err: { InstructionError: [2, "Custom"] } })) });
  r = await run(null);
  ok(r.status === "failed", "reverted tx → failed");

  if (process.env.STATE && process.env.PLAN) {
    console.log("\nreal sharing config from the LiteSVM fork replay");
    const state = JSON.parse(readFileSync(process.env.STATE, "utf8"));
    const plan = JSON.parse(readFileSync(process.env.PLAN, "utf8"));
    const realMint = new PublicKey(plan.meta.mint);
    const real = Buffer.from(state.afterLaunch.sharingConfig.data, "base64");
    conn.getSignatureStatuses = async (hs: string[]) => ({ value: hs.map(() => confirmed) });
    conn.getAccountInfo = async () => ({ data: real, lamports: 1, owner: PublicKey.default, executable: false });
    const shareTo = plan.meta.creatorShareTo ?? plan.creator;
    const realLaunch = { ...launch, creator: plan.creator, meta: { mint: realMint.toBase58() }, feeRoute: { creator: { address: shareTo, bps: 7000, kind: "wallet" }, platform: { address: PLATFORM_FEE_WALLET_SOL, bps: 3000 } } } as never;
    const before = marked;
    const rr = await pumpAdapter.confirm!(realLaunch, [h1]);
    ok(rr.status === "confirmed" && marked > before, "planned route vs the real on-chain config → confirmed");
    const wrong = { ...(realLaunch as object), feeRoute: { creator: { address: creator.publicKey.toBase58(), bps: 7000, kind: "wallet" }, platform: { address: PLATFORM_FEE_WALLET_SOL, bps: 3000 } } } as never;
    ok((await pumpAdapter.confirm!(wrong, [h1])).status === "unverified", "a different planned recipient vs the real config → unverified");
  }
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} failure(s)` : "\nconfirm: all checks passed");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
