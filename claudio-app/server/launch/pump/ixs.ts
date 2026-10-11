// Hand-built pump.fun / pump_fees / pump_amm instructions (no SDK).
//
// Source of truth: research/repos/pump-public-docs (HEAD 8109141) — idl/{pump,pump_fees,pump_amm}.json and
// docs/instructions/{COIN_CREATION,BUY,CREATOR_FEE_SHARING}.md. Trimmed IDLs are copied to ./idl for reference.
// Verified 2026-09-27:
//  • every discriminator below == sha256("global:<ix_name>")[0..8] AND equals the IDL value;
//  • account order/writability/signers copied from the IDL `accounts` arrays;
//  • PDA seeds + owning programs copied from the IDL `pda` blocks (program byte arrays decoded to base58);
//  • Global 4wTV…jf live: virtual tokens 1.073e15, virtual SOL 30e9, real tokens 7.931e14, supply 1e15.
// Re-verified 2026-09-28 (pump.check.ts): the IDLs above still match pump-public-docs HEAD and, for every
// instruction used here, the on-chain Anchor IDL accounts of pump / pump_fees / pump_amm; every builder matches its
// IDL (discriminator, account order, flags, re-derived PDAs). create_v2 passes mainnet simulateTransaction; the full
// create → fee sharing → buy → distribute sequence (normal + Mayhem, split and atomic-with-LUT layouts) passes in a
// LiteSVM forked from mainnet accounts/programs (the RPC can't simulate dependent txs).
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_FEES_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const PUMP_AMM_PROGRAM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const MAYHEM_PROGRAM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
export const WSOL = NATIVE_MINT; // So11111111111111111111111111111111111111112

// docs/FEE_RECIPIENTS.md
export const FEE_RECIPIENTS = [
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
].map((a) => new PublicKey(a));
export const MAYHEM_FEE_RECIPIENTS = [
  "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS",
  "4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6",
  "8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR",
  "4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH",
  "8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6",
  "Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk",
  "463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq",
  "6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA",
].map((a) => new PublicKey(a));
export const BUYBACK_FEE_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
].map((a) => new PublicKey(a));

// Anchor discriminators (verified == IDL == sha256("global:<name>")[0..8]).
const DISC = {
  create_v2: [214, 144, 76, 236, 95, 139, 49, 180],
  buy_exact_quote_in_v2: [194, 171, 28, 70, 104, 77, 91, 47],
  sell_v2: [93, 246, 130, 60, 231, 233, 64, 178],
  distribute_creator_fees_v2: [255, 203, 19, 79, 244, 68, 8, 159],
  create_fee_sharing_config: [195, 78, 86, 76, 111, 52, 251, 213],
  update_fee_shares_v2: [111, 251, 49, 6, 78, 78, 106, 18],
  transfer_creator_fees_to_pump_v2: [1, 33, 78, 185, 33, 67, 44, 92],
} as const;
export const ACCOUNT_DISC = {
  SharingConfig: [216, 74, 9, 0, 56, 140, 93, 75],
  BondingCurve: [23, 183, 248, 55, 96, 216, 172, 96],
  Global: [167, 232, 232, 177, 200, 108, 114, 127],
  FeeConfig: [143, 52, 146, 187, 219, 123, 76, 155],
} as const;

// ─── Borsh helpers (hand-rolled; little-endian) ─────────────────────
class Writer {
  private parts: Buffer[] = [];
  bytes(b: ArrayLike<number>): this {
    this.parts.push(Buffer.from(Array.from(b)));
    return this;
  }
  u8(n: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(n, 0);
    this.parts.push(b);
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  u16(n: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n, 0);
    this.parts.push(b);
    return this;
  }
  u32(n: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    this.parts.push(b);
    return this;
  }
  u64(n: bigint): this {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n, 0);
    this.parts.push(b);
    return this;
  }
  str(s: string): this {
    const utf8 = Buffer.from(s, "utf8");
    this.u32(utf8.length);
    this.parts.push(utf8);
    return this;
  }
  pubkey(p: PublicKey): this {
    this.parts.push(p.toBuffer());
    return this;
  }
  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });

// ─── PDAs ───────────────────────────────────────────────────────────
const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey): PublicKey => PublicKey.findProgramAddressSync(seeds, program)[0];
const s = (x: string): Buffer => Buffer.from(x, "utf8");
/** ATA with off-curve owners allowed (most owners here are PDAs). */
const ata = (mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

export const pumpPda = {
  global: () => pda([s("global")], PUMP_PROGRAM),
  mintAuthority: () => pda([s("mint-authority")], PUMP_PROGRAM),
  bondingCurve: (mint: PublicKey) => pda([s("bonding-curve"), mint.toBuffer()], PUMP_PROGRAM),
  eventAuthority: () => pda([s("__event_authority")], PUMP_PROGRAM),
  creatorVault: (creator: PublicKey) => pda([s("creator-vault"), creator.toBuffer()], PUMP_PROGRAM),
  globalVolumeAccumulator: () => pda([s("global_volume_accumulator")], PUMP_PROGRAM),
  userVolumeAccumulator: (user: PublicKey) => pda([s("user_volume_accumulator"), user.toBuffer()], PUMP_PROGRAM),
  // pump_fees
  feesEventAuthority: () => pda([s("__event_authority")], PUMP_FEES_PROGRAM),
  sharingConfig: (mint: PublicKey) => pda([s("sharing-config"), mint.toBuffer()], PUMP_FEES_PROGRAM),
  feeConfig: () => pda([s("fee_config"), PUMP_PROGRAM.toBuffer()], PUMP_FEES_PROGRAM),
  // pump_amm
  ammEventAuthority: () => pda([s("__event_authority")], PUMP_AMM_PROGRAM),
  ammCreatorVaultAuthority: (coinCreator: PublicKey) => pda([s("creator_vault"), coinCreator.toBuffer()], PUMP_AMM_PROGRAM),
  // mayhem
  mayhemGlobalParams: () => pda([s("global-params")], MAYHEM_PROGRAM),
  mayhemSolVault: () => pda([s("sol-vault")], MAYHEM_PROGRAM),
  mayhemState: (mint: PublicKey) => pda([s("mayhem-state"), mint.toBuffer()], MAYHEM_PROGRAM),
};

// ─── Instructions ───────────────────────────────────────────────────

export interface CreateV2Args {
  mint: PublicKey;
  user: PublicKey;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  mayhem: boolean;
}

/** create_v2 — Token-2022 mint (6 dec). Signers: mint + user. */
export function createV2Ix(a: CreateV2Args): TransactionInstruction {
  const bondingCurve = pumpPda.bondingCurve(a.mint);
  const solVault = pumpPda.mayhemSolVault();
  const data = new Writer()
    .bytes(DISC.create_v2)
    .str(a.name)
    .str(a.symbol)
    .str(a.uri)
    .pubkey(a.creator)
    .bool(a.mayhem)
    .bool(false) // is_cashback_enabled: OptionBool (struct { bool }) — deprecated, must be false
    .u64(BigInt(0)) // creator_fee_bps: OptionU64 (struct { u64 }) — ignored for SOL pairs
    .bool(false) // is_holder_reward: OptionBool — regular coin (holder-reward coins can't split fees)
    .done();
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data,
    keys: [
      ws(a.mint),
      r(pumpPda.mintAuthority()),
      w(bondingCurve),
      w(ata(a.mint, bondingCurve, TOKEN_2022_PROGRAM_ID)),
      r(pumpPda.global()),
      ws(a.user),
      r(SystemProgram.programId),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      w(MAYHEM_PROGRAM), // IDL marks mayhem_program_id writable
      r(pumpPda.mayhemGlobalParams()),
      w(solVault),
      w(pumpPda.mayhemState(a.mint)),
      w(ata(a.mint, solVault, TOKEN_2022_PROGRAM_ID)),
      r(pumpPda.eventAuthority()),
      r(PUMP_PROGRAM),
    ],
  });
}

/**
 * create_fee_sharing_config (pump_fees). Payer must be the coin creator. Migrates bonding_curve.creator to the
 * sharing_config PDA with shareholders [(creator, 10000)]. Optional pool/amm accounts are passed as the
 * pump_fees program id = Anchor's "None" convention (coin not graduated).
 */
export function createFeeSharingConfigIx(mint: PublicKey, creator: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PUMP_FEES_PROGRAM,
    data: Buffer.from(DISC.create_fee_sharing_config),
    keys: [
      r(pumpPda.feesEventAuthority()),
      r(PUMP_FEES_PROGRAM),
      ws(creator),
      r(pumpPda.global()),
      r(mint),
      w(pumpPda.sharingConfig(mint)),
      r(SystemProgram.programId),
      w(pumpPda.bondingCurve(mint)),
      r(PUMP_PROGRAM),
      r(pumpPda.eventAuthority()),
      r(PUMP_FEES_PROGRAM), // pool: None
      r(PUMP_FEES_PROGRAM), // pump_amm_program: None
      r(PUMP_FEES_PROGRAM), // pump_amm_event_authority: None
    ],
  });
}

export interface Shareholder {
  address: PublicKey;
  bps: number;
}

/**
 * update_fee_shares_v2 (pump_fees). One-shot: sets the final shareholders and revokes the admin.
 * remaining accounts = CURRENT shareholders in on-chain order (right after create: [creator]).
 */
export function updateFeeSharesV2Ix(
  mint: PublicKey,
  authority: PublicKey,
  current: PublicKey[],
  next: Shareholder[],
): TransactionInstruction {
  const sharing = pumpPda.sharingConfig(mint);
  const pumpCreatorVault = pumpPda.creatorVault(sharing);
  const ammVaultAuth = pumpPda.ammCreatorVaultAuthority(sharing);
  const wr = new Writer().bytes(DISC.update_fee_shares_v2).u32(next.length);
  for (const h of next) wr.pubkey(h.address).u16(h.bps);
  return new TransactionInstruction({
    programId: PUMP_FEES_PROGRAM,
    data: wr.done(),
    keys: [
      r(pumpPda.feesEventAuthority()),
      r(PUMP_FEES_PROGRAM),
      ws(authority),
      r(pumpPda.global()),
      r(mint),
      w(sharing),
      r(pumpPda.bondingCurve(mint)),
      w(pumpCreatorVault),
      w(ata(WSOL, pumpCreatorVault, TOKEN_PROGRAM_ID)),
      r(SystemProgram.programId),
      r(PUMP_PROGRAM),
      r(pumpPda.eventAuthority()),
      r(PUMP_AMM_PROGRAM),
      r(pumpPda.ammEventAuthority()),
      r(WSOL),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      w(ammVaultAuth),
      w(ata(WSOL, ammVaultAuth, TOKEN_PROGRAM_ID)),
      ...current.map((p) => w(p)),
    ],
  });
}

export interface BuyArgs {
  mint: PublicKey;
  user: PublicKey;
  /** bonding_curve.creator at execution time — the sharing_config PDA once fee sharing is set up. */
  curveCreator: PublicKey;
  feeRecipient: PublicKey;
  buybackFeeRecipient: PublicKey;
  spendableLamports: bigint;
  minTokensOut: bigint;
  /** Token program of the base mint: Token-2022 for create_v2 coins (default), SPL Token for legacy coins. */
  baseTokenProgram?: PublicKey;
}

/** Idempotent creation of the buyer's Token-2022 ATA for the new mint (buy does not init it). */
export function createUserAtaIx(mint: PublicKey, user: PublicKey, tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    user,
    ata(mint, user, tokenProgram),
    user,
    mint,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** buy_exact_quote_in_v2 — SOL-paired: quote mint = wSOL, quote token program = SPL Token. */
export function buyExactQuoteInV2Ix(a: BuyArgs): TransactionInstruction {
  const bondingCurve = pumpPda.bondingCurve(a.mint);
  const creatorVault = pumpPda.creatorVault(a.curveCreator);
  const userVol = pumpPda.userVolumeAccumulator(a.user);
  const baseProgram = a.baseTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  const data = new Writer().bytes(DISC.buy_exact_quote_in_v2).u64(a.spendableLamports).u64(a.minTokensOut).done();
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data,
    keys: [
      r(pumpPda.global()),
      r(a.mint),
      r(WSOL),
      r(baseProgram),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      w(a.feeRecipient),
      w(ata(WSOL, a.feeRecipient, TOKEN_PROGRAM_ID)),
      w(a.buybackFeeRecipient),
      w(ata(WSOL, a.buybackFeeRecipient, TOKEN_PROGRAM_ID)),
      w(bondingCurve),
      w(ata(a.mint, bondingCurve, baseProgram)),
      w(ata(WSOL, bondingCurve, TOKEN_PROGRAM_ID)),
      ws(a.user),
      w(ata(a.mint, a.user, baseProgram)),
      w(ata(WSOL, a.user, TOKEN_PROGRAM_ID)),
      w(creatorVault),
      w(ata(WSOL, creatorVault, TOKEN_PROGRAM_ID)),
      r(pumpPda.sharingConfig(a.mint)),
      r(pumpPda.globalVolumeAccumulator()),
      w(userVol),
      w(ata(WSOL, userVol, TOKEN_PROGRAM_ID)),
      r(pumpPda.feeConfig()),
      r(PUMP_FEES_PROGRAM),
      r(SystemProgram.programId),
      r(pumpPda.eventAuthority()),
      r(PUMP_PROGRAM),
    ],
  });
}

/** distribute_creator_fees_v2 — permissionless payout of the curve creator vault to shareholders (on-chain order). */
export function distributeCreatorFeesV2Ix(mint: PublicKey, payer: PublicKey, shareholders: PublicKey[]): TransactionInstruction {
  const sharing = pumpPda.sharingConfig(mint);
  const creatorVault = pumpPda.creatorVault(sharing);
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data: new Writer().bytes(DISC.distribute_creator_fees_v2).bool(false).done(), // initialize_ata ignored for wSOL
    keys: [
      ws(payer),
      r(mint),
      r(pumpPda.bondingCurve(mint)),
      r(sharing),
      w(creatorVault),
      r(SystemProgram.programId),
      r(pumpPda.eventAuthority()),
      r(PUMP_PROGRAM),
      w(ata(WSOL, creatorVault, TOKEN_PROGRAM_ID)),
      r(WSOL),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      ...shareholders.map((p) => w(p)),
    ],
  });
}

/** transfer_creator_fees_to_pump_v2 (pump_amm) — graduated coins: AMM creator vault → curve creator vault. */
export function transferCreatorFeesToPumpV2Ix(mint: PublicKey, payer: PublicKey): TransactionInstruction {
  const coinCreator = pumpPda.sharingConfig(mint);
  const vaultAuth = pumpPda.ammCreatorVaultAuthority(coinCreator);
  const pumpVault = pumpPda.creatorVault(coinCreator);
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM,
    data: Buffer.from(DISC.transfer_creator_fees_to_pump_v2),
    keys: [
      ws(payer),
      r(WSOL),
      r(TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(coinCreator),
      w(vaultAuth),
      w(ata(WSOL, vaultAuth, TOKEN_PROGRAM_ID)),
      w(pumpVault),
      w(ata(WSOL, pumpVault, TOKEN_PROGRAM_ID)),
      r(pumpPda.ammEventAuthority()),
      r(PUMP_AMM_PROGRAM),
    ],
  });
}

// ─── Account decoding ───────────────────────────────────────────────

function discMatches(data: Buffer, disc: readonly number[]): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return false;
  return true;
}

/** SharingConfig { bump u8, version u8, status enum(u8), mint, admin, admin_revoked bool, shareholders Vec<{pubkey,u16}> } */
export function decodeSharingConfig(data: Buffer): { active: boolean; adminRevoked: boolean; admin: PublicKey; shareholders: Shareholder[] } | null {
  if (!discMatches(data, ACCOUNT_DISC.SharingConfig)) return null;
  let o = 8;
  o += 2; // bump, version
  const status = data.readUInt8(o);
  o += 1;
  o += 32; // mint
  const admin = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const adminRevoked = data.readUInt8(o) === 1;
  o += 1;
  const n = data.readUInt32LE(o);
  o += 4;
  const shareholders: Shareholder[] = [];
  for (let i = 0; i < n && o + 34 <= data.length; i++) {
    shareholders.push({ address: new PublicKey(data.subarray(o, o + 32)), bps: data.readUInt16LE(o + 32) });
    o += 34;
  }
  return { active: status === 1, adminRevoked, admin, shareholders };
}

/** BondingCurve { vT u64, vQ u64, rT u64, rQ u64, supply u64, complete bool, creator pubkey, … } */
export function decodeBondingCurve(data: Buffer): { complete: boolean; creator: PublicKey } | null {
  if (!discMatches(data, ACCOUNT_DISC.BondingCurve) || data.length < 8 + 40 + 1 + 32) return null;
  return { complete: data.readUInt8(48) === 1, creator: new PublicKey(data.subarray(49, 81)) };
}

/** Global: initial reserves at fixed offsets (8 disc + bool + authority + fee_recipient = 73). */
export function decodeGlobalReserves(data: Buffer): { vT: bigint; vQ: bigint; rT: bigint; supply: bigint } | null {
  if (data.length < 105) return null;
  return {
    vT: data.readBigUInt64LE(73),
    vQ: data.readBigUInt64LE(81),
    rT: data.readBigUInt64LE(89),
    supply: data.readBigUInt64LE(97),
  };
}

/** Static accounts every launch touches — the content of the Claudio pump Address Lookup Table. */
export function pumpStaticAccounts(): PublicKey[] {
  return [
    pumpPda.global(),
    pumpPda.mintAuthority(),
    pumpPda.eventAuthority(),
    pumpPda.globalVolumeAccumulator(),
    pumpPda.feesEventAuthority(),
    pumpPda.feeConfig(),
    pumpPda.ammEventAuthority(),
    pumpPda.mayhemGlobalParams(),
    pumpPda.mayhemSolVault(),
    PUMP_PROGRAM,
    PUMP_FEES_PROGRAM,
    PUMP_AMM_PROGRAM,
    MAYHEM_PROGRAM,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    WSOL,
    new PublicKey("ComputeBudget111111111111111111111111111111"),
    ...FEE_RECIPIENTS,
    ...FEE_RECIPIENTS.map((p) => ata(WSOL, p, TOKEN_PROGRAM_ID)),
    ...MAYHEM_FEE_RECIPIENTS,
    ...MAYHEM_FEE_RECIPIENTS.map((p) => ata(WSOL, p, TOKEN_PROGRAM_ID)),
    ...BUYBACK_FEE_RECIPIENTS,
    ...BUYBACK_FEE_RECIPIENTS.map((p) => ata(WSOL, p, TOKEN_PROGRAM_ID)),
  ];
}

// ─── Trading (bonding curve) ────────────────────────────────────────

export interface SellArgs {
  mint: PublicKey;
  user: PublicKey;
  /** bonding_curve.creator (the sharing_config PDA for coins with fee sharing). */
  curveCreator: PublicKey;
  feeRecipient: PublicKey;
  buybackFeeRecipient: PublicKey;
  /** Base token units to sell. */
  amount: bigint;
  /** Minimum lamports received after protocol + creator fees. */
  minSolOutput: bigint;
  baseTokenProgram?: PublicKey;
}

/** sell_v2 — SOL-paired: quote mint = wSOL (native SOL moves), quote token program = SPL Token. 26 accounts. */
export function sellV2Ix(a: SellArgs): TransactionInstruction {
  const bondingCurve = pumpPda.bondingCurve(a.mint);
  const creatorVault = pumpPda.creatorVault(a.curveCreator);
  const userVol = pumpPda.userVolumeAccumulator(a.user);
  const baseProgram = a.baseTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  const data = new Writer().bytes(DISC.sell_v2).u64(a.amount).u64(a.minSolOutput).done();
  return new TransactionInstruction({
    programId: PUMP_PROGRAM,
    data,
    keys: [
      r(pumpPda.global()),
      r(a.mint),
      r(WSOL),
      r(baseProgram),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      w(a.feeRecipient),
      w(ata(WSOL, a.feeRecipient, TOKEN_PROGRAM_ID)),
      w(a.buybackFeeRecipient),
      w(ata(WSOL, a.buybackFeeRecipient, TOKEN_PROGRAM_ID)),
      w(bondingCurve),
      w(ata(a.mint, bondingCurve, baseProgram)),
      w(ata(WSOL, bondingCurve, TOKEN_PROGRAM_ID)),
      ws(a.user),
      w(ata(a.mint, a.user, baseProgram)),
      w(ata(WSOL, a.user, TOKEN_PROGRAM_ID)),
      w(creatorVault),
      w(ata(WSOL, creatorVault, TOKEN_PROGRAM_ID)),
      r(pumpPda.sharingConfig(a.mint)),
      w(userVol),
      w(ata(WSOL, userVol, TOKEN_PROGRAM_ID)),
      r(pumpPda.feeConfig()),
      r(PUMP_FEES_PROGRAM),
      r(SystemProgram.programId),
      r(pumpPda.eventAuthority()),
      r(PUMP_PROGRAM),
    ],
  });
}

/** The user's ATA for `mint` under `tokenProgram` (off-curve owners allowed). */
export function userAta(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): PublicKey {
  return ata(mint, owner, tokenProgram);
}

export interface BondingCurveState {
  virtualToken: bigint;
  virtualQuote: bigint;
  realToken: bigint;
  realQuote: bigint;
  supply: bigint;
  complete: boolean;
  creator: PublicKey;
  /** false for legacy accounts that predate the field. */
  mayhem: boolean;
  cashback: boolean;
  /** null = SOL-paired (Pubkey::default() or account too short to hold the field). */
  quoteMint: PublicKey | null;
}

/**
 * Full BondingCurve decode. Layout (IDL): disc 8 · vT u64 · vQ u64 · rT u64 · rQ u64 · supply u64 · complete bool (48) ·
 * creator (49..81) · is_mayhem_mode (81) · is_cashback_coin (82) · quote_mint (83..115) · … Older accounts are shorter;
 * missing fields read as their defaults.
 */
export function decodeBondingCurveState(data: Buffer): BondingCurveState | null {
  if (!discMatches(data, ACCOUNT_DISC.BondingCurve) || data.length < 81) return null;
  const quote = data.length >= 115 ? new PublicKey(data.subarray(83, 115)) : null;
  return {
    virtualToken: data.readBigUInt64LE(8),
    virtualQuote: data.readBigUInt64LE(16),
    realToken: data.readBigUInt64LE(24),
    realQuote: data.readBigUInt64LE(32),
    supply: data.readBigUInt64LE(40),
    complete: data.readUInt8(48) === 1,
    creator: new PublicKey(data.subarray(49, 81)),
    mayhem: data.length > 81 && data.readUInt8(81) === 1,
    cashback: data.length > 82 && data.readUInt8(82) === 1,
    quoteMint: quote && !quote.equals(PublicKey.default) ? quote : null,
  };
}

/** Global fee fields: fee_basis_points @105, creator_fee_basis_points @154 (after withdraw_authority, enable_migrate, pool_migration_fee). */
export function decodeGlobalFees(data: Buffer): { protocolFeeBps: bigint; creatorFeeBps: bigint } | null {
  if (!discMatches(data, ACCOUNT_DISC.Global) || data.length < 162) return null;
  return { protocolFeeBps: data.readBigUInt64LE(105), creatorFeeBps: data.readBigUInt64LE(154) };
}

export interface PumpFeeTier {
  marketCapLamportsThreshold: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
}

/** pump_fees FeeConfig: disc 8 · bump u8 · admin 32 · flat_fees {lp,protocol,creator u64} · fee_tiers Vec<{u128, Fees}> · … */
export function decodeFeeConfigTiers(data: Buffer): PumpFeeTier[] | null {
  if (!discMatches(data, ACCOUNT_DISC.FeeConfig) || data.length < 69) return null;
  let o = 8 + 1 + 32 + 24;
  const n = data.readUInt32LE(o);
  o += 4;
  const tiers: PumpFeeTier[] = [];
  for (let i = 0; i < n && o + 40 <= data.length; i++) {
    const lo = data.readBigUInt64LE(o);
    const hi = data.readBigUInt64LE(o + 8);
    tiers.push({
      marketCapLamportsThreshold: (hi << BigInt(64)) + lo,
      protocolFeeBps: data.readBigUInt64LE(o + 16 + 8),
      creatorFeeBps: data.readBigUInt64LE(o + 16 + 16),
    });
    o += 40;
  }
  return tiers;
}

/**
 * Curve fee bps (docs/FEE_PROGRAM_README.md computeFeesBps): with a fee config, the tier for the curve's market cap
 * (vQ · mintSupply / vT, lamports); without one, Global's fee_basis_points + creator_fee_basis_points.
 * creator fee is 0 when the curve has no creator.
 */
export function curveFeesBps(
  curve: BondingCurveState,
  mintSupply: bigint,
  tiers: PumpFeeTier[] | null,
  global: { protocolFeeBps: bigint; creatorFeeBps: bigint } | null,
): { protocolFeeBps: bigint; creatorFeeBps: bigint; source: "fee_config" | "global" | "default" } {
  let out: { protocolFeeBps: bigint; creatorFeeBps: bigint; source: "fee_config" | "global" | "default" };
  if (tiers && tiers.length && curve.virtualToken > BigInt(0)) {
    const mcap = (curve.virtualQuote * mintSupply) / curve.virtualToken;
    let t = tiers[0];
    if (mcap >= tiers[0].marketCapLamportsThreshold) {
      for (let i = tiers.length - 1; i >= 0; i--) {
        if (mcap >= tiers[i].marketCapLamportsThreshold) {
          t = tiers[i];
          break;
        }
      }
    }
    out = { protocolFeeBps: t.protocolFeeBps, creatorFeeBps: t.creatorFeeBps, source: "fee_config" };
  } else if (global) out = { ...global, source: "global" };
  else out = { protocolFeeBps: BigInt(95), creatorFeeBps: BigInt(30), source: "default" };
  if (curve.creator.equals(PublicKey.default)) out.creatorFeeBps = BigInt(0);
  return out;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - BigInt(1)) / b;
const TEN_K = BigInt(10_000);

/** IDL "Quote formulas" for buy_exact_quote_in_v2: spendable lamports (fees included) → tokens out. */
export function curveBuyQuote(curve: BondingCurveState, spendable: bigint, fees: { protocolFeeBps: bigint; creatorFeeBps: bigint }): { tokensOut: bigint; netSol: bigint; feeLamports: bigint } {
  const zero = BigInt(0);
  if (spendable <= zero) return { tokensOut: zero, netSol: zero, feeLamports: zero };
  const total = fees.protocolFeeBps + fees.creatorFeeBps;
  let net = (spendable * TEN_K) / (TEN_K + total);
  const fee = ceilDiv(net * fees.protocolFeeBps, TEN_K) + ceilDiv(net * fees.creatorFeeBps, TEN_K);
  if (net + fee > spendable) net = net - (net + fee - spendable);
  if (net <= BigInt(1)) return { tokensOut: zero, netSol: net, feeLamports: spendable - net };
  let tokensOut = ((net - BigInt(1)) * curve.virtualToken) / (curve.virtualQuote + net - BigInt(1));
  if (tokensOut > curve.realToken) tokensOut = curve.realToken;
  return { tokensOut, netSol: net, feeLamports: spendable - net };
}

/** sell: gross = floor(tokens · vQ / (vT + tokens)); fees are ceil'd bps of gross; the seller receives gross − fees. */
export function curveSellQuote(curve: BondingCurveState, tokens: bigint, fees: { protocolFeeBps: bigint; creatorFeeBps: bigint }): { solOut: bigint; grossSol: bigint; feeLamports: bigint } {
  const zero = BigInt(0);
  if (tokens <= zero) return { solOut: zero, grossSol: zero, feeLamports: zero };
  let gross = (tokens * curve.virtualQuote) / (curve.virtualToken + tokens);
  if (gross > curve.realQuote) gross = curve.realQuote;
  const fee = ceilDiv(gross * fees.protocolFeeBps, TEN_K) + ceilDiv(gross * fees.creatorFeeBps, TEN_K);
  const solOut = gross > fee ? gross - fee : zero;
  return { solOut, grossSol: gross, feeLamports: gross - solOut };
}
