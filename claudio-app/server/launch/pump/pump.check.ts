// Read-only pump.fun check (never sends a transaction):
//   1. every hand-built instruction vs the IDLs in ./idl — discriminator, account count, order, writable/signer
//      flags, fixed addresses and every PDA whose seeds can be resolved from the instruction's own accounts;
//   2. pumpAdapter.plan() for a funded mainnet wallet → the plan's own simulateTransaction result + logs.
//
//   SOL_RPC_URL=<mainnet rpc> CREATOR=<funded wallet> npx tsx server/launch/pump/pump.check.ts
// CREATOR defaults to a large exchange hot wallet (only used as a simulation fee payer; it never signs anything).
import { createHash } from "crypto";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import pumpIdl from "./idl/pump.json";
import feesIdl from "./idl/pump_fees.json";
import ammIdl from "./idl/pump_amm.json";
import {
  BUYBACK_FEE_RECIPIENTS,
  FEE_RECIPIENTS,
  buyExactQuoteInV2Ix,
  createFeeSharingConfigIx,
  createV2Ix,
  distributeCreatorFeesV2Ix,
  pumpPda,
  sellV2Ix,
  transferCreatorFeesToPumpV2Ix,
  updateFeeSharesV2Ix,
} from "./ixs";

interface IdlSeed {
  kind: string;
  value?: number[];
  path?: string;
}
interface IdlAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: IdlSeed[]; program?: IdlSeed };
}
interface IdlIx {
  name: string;
  discriminator: number[];
  accounts: IdlAccount[];
}
interface Idl {
  address: string;
  instructions: IdlIx[];
}

let failures = 0;
function fail(msg: string) {
  failures++;
  console.log(`  ✗ ${msg}`);
}

function checkIx(idl: Idl, name: string, ix: TransactionInstruction, opts: { optionalNone?: string[]; remaining?: number } = {}) {
  const def = idl.instructions.find((i) => i.name === name);
  console.log(`\n${name}`);
  if (!def) return fail(`not in IDL`);
  if (ix.programId.toBase58() !== idl.address) fail(`program ${ix.programId.toBase58()} ≠ ${idl.address}`);
  const disc = Array.from(ix.data.subarray(0, 8));
  const want = Array.from(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
  if (JSON.stringify(disc) !== JSON.stringify(def.discriminator) || JSON.stringify(disc) !== JSON.stringify(want)) fail(`discriminator ${disc} (IDL ${def.discriminator})`);
  const expected = def.accounts.length + (opts.remaining ?? 0);
  if (ix.keys.length !== expected) fail(`${ix.keys.length} accounts, IDL has ${def.accounts.length} + ${opts.remaining ?? 0} remaining`);
  const byName = new Map<string, PublicKey>();
  def.accounts.forEach((a, i) => ix.keys[i] && byName.set(a.name, ix.keys[i].pubkey));
  let pdas = 0;
  def.accounts.forEach((a, i) => {
    const k = ix.keys[i];
    if (!k) return;
    const isNone = a.optional && opts.optionalNone?.includes(a.name);
    if (isNone) {
      if (!k.pubkey.equals(ix.programId)) fail(`${a.name}: optional None must be the program id`);
      return;
    }
    if (!!a.writable !== k.isWritable) fail(`${a.name}: writable ${k.isWritable}, IDL ${!!a.writable}`);
    if (!!a.signer !== k.isSigner) fail(`${a.name}: signer ${k.isSigner}, IDL ${!!a.signer}`);
    if (a.address && a.address !== k.pubkey.toBase58()) fail(`${a.name}: ${k.pubkey.toBase58()} ≠ fixed ${a.address}`);
    if (a.pda) {
      const seeds: Buffer[] = [];
      for (const s of a.pda.seeds) {
        if (s.kind === "const") seeds.push(Buffer.from(s.value!));
        else if (s.kind === "account" && s.path && !s.path.includes(".") && byName.has(s.path)) seeds.push(byName.get(s.path)!.toBuffer());
        else return; // depends on account data or args — covered by the simulation
      }
      let program = new PublicKey(idl.address);
      if (a.pda.program) {
        if (a.pda.program.kind === "const") program = new PublicKey(Buffer.from(a.pda.program.value!));
        else if (a.pda.program.kind === "account" && byName.has(a.pda.program.path!)) program = byName.get(a.pda.program.path!)!;
        else return;
      }
      const derived = PublicKey.findProgramAddressSync(seeds, program)[0];
      pdas++;
      if (!derived.equals(k.pubkey)) fail(`${a.name}: ${k.pubkey.toBase58()} ≠ PDA ${derived.toBase58()}`);
    }
  });
  console.log(`  ${ix.keys.length} accounts, ${pdas} PDAs re-derived from the IDL`);
}

async function main() {
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const platform = Keypair.generate().publicKey;
  const sharing = pumpPda.sharingConfig(mint);
  const pump = pumpIdl as unknown as Idl;
  const fees = feesIdl as unknown as Idl;
  const amm = ammIdl as unknown as Idl;

  checkIx(pump, "create_v2", createV2Ix({ mint, user: creator, creator, name: "N", symbol: "S", uri: "u", mayhem: false }));
  checkIx(fees, "create_fee_sharing_config", createFeeSharingConfigIx(mint, creator), {
    optionalNone: ["pool", "pump_amm_program", "pump_amm_event_authority"],
  });
  checkIx(fees, "update_fee_shares_v2", updateFeeSharesV2Ix(mint, creator, [creator], [{ address: creator, bps: 7000 }, { address: platform, bps: 3000 }]), {
    remaining: 1,
  });
  checkIx(
    pump,
    "buy_exact_quote_in_v2",
    buyExactQuoteInV2Ix({
      mint,
      user: creator,
      curveCreator: sharing,
      feeRecipient: FEE_RECIPIENTS[0],
      buybackFeeRecipient: BUYBACK_FEE_RECIPIENTS[0],
      spendableLamports: BigInt(1),
      minTokensOut: BigInt(0),
    }),
  );
  // Trading (server/trade/pumpCurve.ts): sell_v2, and buy for a legacy SPL-Token coin.
  checkIx(
    pump,
    "sell_v2",
    sellV2Ix({
      mint,
      user: creator,
      curveCreator: sharing,
      feeRecipient: FEE_RECIPIENTS[0],
      buybackFeeRecipient: BUYBACK_FEE_RECIPIENTS[0],
      amount: BigInt(1),
      minSolOutput: BigInt(0),
    }),
  );
  {
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    checkIx(
      pump,
      "buy_exact_quote_in_v2",
      buyExactQuoteInV2Ix({
        mint,
        user: creator,
        curveCreator: creator,
        feeRecipient: FEE_RECIPIENTS[1],
        buybackFeeRecipient: BUYBACK_FEE_RECIPIENTS[1],
        spendableLamports: BigInt(1),
        minTokensOut: BigInt(0),
        baseTokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
    checkIx(
      pump,
      "sell_v2",
      sellV2Ix({
        mint,
        user: creator,
        curveCreator: creator,
        feeRecipient: FEE_RECIPIENTS[1],
        buybackFeeRecipient: BUYBACK_FEE_RECIPIENTS[1],
        amount: BigInt(1),
        minSolOutput: BigInt(0),
        baseTokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
  }
  checkIx(pump, "distribute_creator_fees_v2", distributeCreatorFeesV2Ix(mint, creator, [creator, platform]), { remaining: 2 });
  checkIx(amm, "transfer_creator_fees_to_pump_v2", transferCreatorFeesToPumpV2Ix(mint, creator));
  console.log(failures ? `\n${failures} encoding problem(s)` : "\nencodings: all match the IDL");

  // ── Live plan + simulation ─────────────────────────────────────────
  if (process.env.SKIP_SIM) return;
  // The platform shareholder is always PLATFORM_FEE_WALLET_SOL (a differing PLATFORM_TREASURY_SOL refuses the plan).
  const { PLATFORM_FEE_WALLET_SOL } = await import("@shared/platform");
  const { pumpAdapter } = await import("../adapters/pump");
  // SYNTH_LUT=1: pretend PUMP_LUT_ADDRESS holds pumpStaticAccounts() (not on-chain) to exercise the atomic layout.
  // The RPC simulation of that tx then fails with an unknown lookup table; replay it in a forked SVM instead.
  let lut: { key: string; addresses: string[] } | undefined;
  if (process.env.SYNTH_LUT) {
    const { AddressLookupTableAccount } = await import("@solana/web3.js");
    const { solConnection } = await import("../sol");
    const { pumpStaticAccounts } = await import("./ixs");
    const key = Keypair.generate().publicKey;
    const account = new AddressLookupTableAccount({
      key,
      state: { addresses: pumpStaticAccounts(), authority: undefined, deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0 },
    });
    process.env.PUMP_LUT_ADDRESS = key.toBase58();
    solConnection().getAddressLookupTable = async () => ({ context: { slot: 0 }, value: account });
    lut = { key: key.toBase58(), addresses: account.state.addresses.map((a) => a.toBase58()) };
  }
  const who = process.env.CREATOR ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const meta: Record<string, string> = {};
  const plan = await pumpAdapter.plan(
    {
      chain: "sol",
      launchpad: "pump",
      creator: who,
      name: "Claudio Check",
      symbol: "RCHK",
      metadataUri: "https://ipfs.io/ipfs/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
      devBuyNative: Number(process.env.DEV_BUY ?? "0.01"),
      slippageBps: 500,
      mayhemMode: process.env.MAYHEM === "1",
    } as Parameters<typeof pumpAdapter.plan>[0],
    // SHARE_TO=<pubkey>: plan a hosted-agent launch (creator share → that escrow instead of the signer).
    { launchId: "check", meta, ...(process.env.SHARE_TO ? { creatorShareTo: { address: process.env.SHARE_TO, kind: "agent" as const, agentName: "check-agent" } } : {}) },
  );
  console.log(`\nplan layout=${meta.layout} txs=${plan.txs.length}: ${plan.txs.map((t) => t.description).join(" | ")}`);
  console.log(`simulation: ${JSON.stringify(plan.simulation)}`);
  // PLAN_OUT=<file>: dump the unsigned txs, e.g. to replay the whole sequence in a forked local SVM.
  if (process.env.PLAN_OUT) {
    const { writeFileSync } = await import("fs");
    const { ComputeBudgetProgram } = await import("@solana/web3.js");
    const { compileTx, toBase64 } = await import("../sol");
    // Harvest right after the dev buy (what pumpAdapter.harvest builds once the config exists on-chain).
    const payer = new PublicKey(who);
    const holders = [payer, new PublicKey(PLATFORM_FEE_WALLET_SOL)];
    const h = compileTx(payer, "11111111111111111111111111111111", [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      distributeCreatorFeesV2Ix(new PublicKey(meta.mint), payer, holders),
    ], null);
    const harvest = h ? [{ kind: "svm", base64: toBase64(h.bytes), signers: [who], partiallySigned: false, description: "Harvest (distribute_creator_fees_v2)" }] : [];
    writeFileSync(process.env.PLAN_OUT, JSON.stringify({ creator: who, meta, lut, txs: plan.txs, harvest }, null, 1));
  }
  if (!plan.simulation?.ok) failures++;
}

main()
  .then(() => process.exit(failures ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
