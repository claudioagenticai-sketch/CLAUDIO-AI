// The ONLY module that can decrypt an escrow key (it claims the vault's one-shot opener at import time).
// Imported only by server/hosted/trading.ts (runner + approvals) and server/hosted/routes.ts (admin key check);
// hosted.check.ts verifies nothing outside server/hosted imports it.
//
// Narrow API: signIntent(agentId, intent) with a typed intent. The signer builds the transaction ITSELF and then
// validates the compiled message against an allowlist before decrypting anything:
//   • fee payer = the agent's escrow, it is the only signer, no address-lookup tables
//   • ComputeBudget: setComputeUnitLimit / setComputeUnitPrice only (bounded priority fee)
//   • Associated Token program: CreateIdempotent of the escrow's own ATA for the intent's mint only
//   • pump.fun: buy_exact_quote_in_v2 only — mint = intent mint, user = escrow, tokens to the escrow's ATA,
//     spend = exactly the intent amount, slippage-protected (min out > 0), known fee recipients
//   • everything else — System program (transfers), SPL Token (transfer/approve/close), any other program or
//     discriminator — is refused. There is no withdrawal and no arbitrary-transaction API.
// Live signing is disabled unless HOSTED_LIVE_TRADING=true; policy (caps, paper, kill switches, blocked tokens,
// ask-owner threshold) is re-checked here. pump_sell has no vendored IDL yet → paper only.
//
// Withdrawals (future): a separate `withdraw` intent to the owner wallet only (passport-verified), with a delay +
// owner signature + admin co-approval, built and allowlisted here (SystemProgram.transfer to that one address).
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import {
  BUYBACK_FEE_RECIPIENTS,
  FEE_RECIPIENTS,
  MAYHEM_FEE_RECIPIENTS,
  PUMP_PROGRAM,
  buyExactQuoteInV2Ix,
  createUserAtaIx,
  decodeBondingCurve,
  pumpPda,
} from "../launch/pump/ixs";
import { pumpQuote } from "../launch/math";
import { audit } from "../auth/audit";
import { primaryRpc } from "../rpc";
import { hostedEnv, LAMPORTS } from "./config";
import { checkTrade, tradeIntentSchema, type TradeIntent } from "./policy";
import { claimOpener, loadSealed, type SealedWallet } from "./vault";

const openSeed = claimOpener();

const BUY_DISC = Buffer.from([194, 171, 28, 70, 104, 77, 91, 47]);
const MAX_CU = 400_000;
const MAX_MICROLAMPORTS = 2_000_000; // ≤ 0.0008 SOL priority fee at MAX_CU
const DEFAULT_MICROLAMPORTS = 200_000;
const BC_DISC = [23, 183, 248, 55, 96, 216, 172, 96];

export type SignResult =
  | { ok: true; tx: string; signature: string; address: string; blockhash: string; lastValidBlockHeight: number; approvalId?: string }
  | { ok: false; code: string; message: string; needsApproval?: boolean };

// ─── chain reads (injectable for tests; validation never trusts them) ─

export interface ChainReader {
  accountData(address: string): Promise<Buffer | null>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(primaryRpc("sol"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error || j.result === undefined) throw new Error(`rpc ${method}: ${j.error?.message ?? r.status}`);
  return j.result;
}

const rpcReader: ChainReader = {
  async accountData(address) {
    const v = await rpc<{ value: { data: [string, string] } | null }>("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
    return v.value ? Buffer.from(v.value.data[0], "base64") : null;
  },
  async latestBlockhash() {
    const v = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    return v.value;
  },
};

let reader: ChainReader = rpcReader;
/** Test hook: replace chain reads (bonding curve, blockhash). The allowlist still validates whatever gets built. */
export function setChainReader(r: ChainReader | null): void {
  reader = r ?? rpcReader;
}

// ─── allowlist validation of a compiled message ──────────────────────

const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const keySet = (l: PublicKey[]) => new Set(l.map((p) => p.toBase58()));
const FEE_SET = new Set([...keySet(FEE_RECIPIENTS), ...keySet(MAYHEM_FEE_RECIPIENTS)]);
const BUYBACK_SET = keySet(BUYBACK_FEE_RECIPIENTS);
const CB = ComputeBudgetProgram.programId.toBase58();
const ATA = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const PUMP = PUMP_PROGRAM.toBase58();

export class Refused extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/**
 * Throws Refused unless every instruction in `msg` is on the allowlist for this escrow + intent.
 * Exported for tests; signIntent always runs it on the exact message it is about to sign.
 */
export function validateMessage(msg: VersionedMessage, escrow: string, intent: TradeIntent): void {
  if (msg.addressTableLookups?.length) throw new Refused("lookup_tables", "Address lookup tables are not allowed");
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== escrow) throw new Refused("bad_fee_payer", "Fee payer must be the agent's escrow");
  if (msg.header.numRequiredSignatures !== 1) throw new Refused("extra_signers", "The escrow must be the only signer");
  if (intent.kind !== "pump_buy") throw new Refused("intent_not_signable", `${intent.kind} cannot be signed live`);
  const mint = new PublicKey(intent.mint);
  const escrowPk = new PublicKey(escrow);
  const wantLamports = BigInt(Math.round(intent.amountSol * LAMPORTS));
  let pumpIxs = 0;
  let cuLimit = 200_000;
  let cuPrice = 0;
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    const acc = (i: number) => keys[ix.accountKeyIndexes[i]];
    if (program === CB) {
      if (data[0] === 2 && data.length === 5) cuLimit = data.readUInt32LE(1);
      else if (data[0] === 3 && data.length === 9) cuPrice = Number(data.readBigUInt64LE(1));
      else throw new Refused("ix_not_allowed", "ComputeBudget instruction not allowed");
      continue;
    }
    if (program === ATA) {
      // CreateIdempotent: [payer, ata, owner, mint, system, token program]
      if (!(data.length === 1 && data[0] === 1)) throw new Refused("ix_not_allowed", "Only CreateIdempotent is allowed on the ATA program");
      if (acc(0) !== escrow || acc(2) !== escrow || acc(3) !== mint.toBase58() || acc(1) !== ataOf(mint, escrowPk).toBase58()) {
        throw new Refused("ata_mismatch", "ATA creation must be the escrow's own account for the intent's mint");
      }
      continue;
    }
    if (program === PUMP) {
      if (data.length !== 24 || !data.subarray(0, 8).equals(BUY_DISC)) throw new Refused("ix_not_allowed", "Only pump.fun buy_exact_quote_in_v2 is allowed");
      if (ix.accountKeyIndexes.length !== 27) throw new Refused("bad_accounts", "Unexpected pump buy account list");
      const spend = data.readBigUInt64LE(8);
      const minOut = data.readBigUInt64LE(16);
      if (spend !== wantLamports) throw new Refused("amount_mismatch", "Spend amount does not match the intent");
      if (minOut <= BigInt(0)) throw new Refused("no_slippage_guard", "min_tokens_out must be > 0");
      if (acc(1) !== mint.toBase58()) throw new Refused("mint_mismatch", "Pump buy mint does not match the intent");
      if (acc(13) !== escrow) throw new Refused("user_mismatch", "Pump buy user must be the escrow");
      if (acc(14) !== ataOf(mint, escrowPk).toBase58()) throw new Refused("ata_mismatch", "Tokens must go to the escrow's own ATA");
      if (acc(10) !== pumpPda.bondingCurve(mint).toBase58()) throw new Refused("curve_mismatch", "Bonding curve PDA mismatch");
      if (!FEE_SET.has(acc(6)) || !BUYBACK_SET.has(acc(8))) throw new Refused("fee_recipient", "Unknown pump fee recipient");
      pumpIxs += 1;
      continue;
    }
    throw new Refused("program_not_allowed", `Program ${program} is not allowed`);
  }
  if (pumpIxs !== 1) throw new Refused("ix_count", "Exactly one pump buy instruction is required");
  if (cuLimit > MAX_CU || cuPrice > MAX_MICROLAMPORTS) throw new Refused("priority_fee", "Compute budget above the cap");
}

// ─── builder ─────────────────────────────────────────────────────────

async function buildPumpBuy(escrow: PublicKey, intent: TradeIntent): Promise<{ msg: VersionedMessage; lastValidBlockHeight: number; blockhash: string }> {
  const mint = new PublicKey(intent.mint);
  const data = await reader.accountData(pumpPda.bondingCurve(mint).toBase58());
  if (!data || data.length < 83 || !BC_DISC.every((b, i) => data[i] === b)) throw new Refused("no_curve", "No pump.fun bonding curve for this mint");
  const bc = decodeBondingCurve(data);
  if (!bc) throw new Refused("no_curve", "Unreadable bonding curve");
  if (bc.complete) throw new Refused("migrated_unsupported", "Coin graduated — live AMM trades are not supported yet");
  if (data.length >= 115 && !new PublicKey(data.subarray(83, 115)).equals(NATIVE_MINT)) throw new Refused("quote_unsupported", "Only SOL-paired curves");
  const mayhem = data.readUInt8(81) === 1;
  const curve = {
    virtualToken: data.readBigUInt64LE(8),
    virtualQuote: data.readBigUInt64LE(16),
    realToken: data.readBigUInt64LE(24),
    supply: data.readBigUInt64LE(40),
    totalFeeBps: BigInt(125),
  };
  const spend = BigInt(Math.round(intent.amountSol * LAMPORTS));
  const q = pumpQuote(spend, curve);
  const minOut = (q.tokensOut * BigInt(10_000 - intent.slippageBps)) / BigInt(10_000);
  if (minOut <= BigInt(0)) throw new Refused("quote_zero", "Quote returned no tokens");
  const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: DEFAULT_MICROLAMPORTS }),
    createUserAtaIx(mint, escrow),
    buyExactQuoteInV2Ix({
      mint,
      user: escrow,
      curveCreator: bc.creator,
      feeRecipient: pick(mayhem ? MAYHEM_FEE_RECIPIENTS : FEE_RECIPIENTS),
      buybackFeeRecipient: pick(BUYBACK_FEE_RECIPIENTS),
      spendableLamports: spend,
      minTokensOut: minOut,
    }),
  ];
  const { blockhash, lastValidBlockHeight } = await reader.latestBlockhash();
  const msg = new TransactionMessage({ payerKey: escrow, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return { msg, blockhash, lastValidBlockHeight };
}

// ─── public API ──────────────────────────────────────────────────────

/**
 * Builds, validates and signs one trade for the agent's escrow. Never sends. Refuses unless live trading is enabled
 * on the server, the policy is live (not paper) and allows this exact trade.
 */
export async function signIntent(agentId: string, rawIntent: unknown, opts: { approvalId?: string } = {}): Promise<SignResult> {
  const parsed = tradeIntentSchema.safeParse(rawIntent);
  if (!parsed.success) return { ok: false, code: "bad_intent", message: "Unsupported or malformed intent" };
  const intent = parsed.data;
  if (!hostedEnv.liveTrading()) return { ok: false, code: "live_disabled", message: "Live signing is disabled on this server (HOSTED_LIVE_TRADING)" };
  const verdict = await checkTrade(agentId, intent, opts);
  if (!verdict.ok) return { ok: false, code: verdict.code, message: verdict.message, needsApproval: verdict.needsApproval };
  if (!verdict.live) return { ok: false, code: "paper_mode", message: "This agent is in paper mode" };
  if (intent.kind !== "pump_buy") return { ok: false, code: "unsupported_live", message: "Live sells are not supported yet (paper only)" };
  const sealed = await loadSealed(agentId);
  if (!sealed) return { ok: false, code: "no_wallet", message: "This agent has no escrow wallet" };
  const escrow = new PublicKey(sealed.address);
  let built: Awaited<ReturnType<typeof buildPumpBuy>>;
  try {
    built = await buildPumpBuy(escrow, intent);
    // Round-trip through bytes so we validate exactly what will be signed.
    const msg = VersionedMessage.deserialize(built.msg.serialize());
    validateMessage(msg, sealed.address, intent);
    built.msg = msg;
  } catch (e) {
    const code = e instanceof Refused ? e.code : "build_failed";
    audit({ actor: `agent:${agentId}`, action: "hosted.sign_refused", target: intent.mint, severity: e instanceof Refused ? "warn" : "info", detail: { code, kind: intent.kind } });
    return { ok: false, code, message: (e as Error).message };
  }
  const tx = new VersionedTransaction(built.msg);
  signWith(agentId, sealed, (kp) => tx.sign([kp]));
  const signature = bs58.encode(tx.signatures[0]);
  audit({ actor: `agent:${agentId}`, action: "hosted.signed", target: intent.mint, detail: { kind: intent.kind, amountSol: intent.amountSol, signature } });
  return {
    ok: true,
    tx: Buffer.from(tx.serialize()).toString("base64"),
    signature,
    address: sealed.address,
    blockhash: built.blockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
    approvalId: verdict.approvalId,
  };
}

function signWith(agentId: string, sealed: SealedWallet, fn: (kp: Keypair) => void): void {
  const seed = openSeed(agentId, sealed);
  try {
    const kp = Keypair.fromSeed(seed);
    if (kp.publicKey.toBase58() !== sealed.address) throw new Error("vault: key does not match address");
    fn(kp);
  } finally {
    seed.fill(0);
  }
}

/** Integrity check for admins/tests: decrypts in place and confirms the key matches the address. Returns no secret. */
export async function verifyWalletKey(agentId: string): Promise<{ ok: boolean; reason?: string }> {
  const sealed = await loadSealed(agentId);
  if (!sealed) return { ok: false, reason: "no_wallet" };
  try {
    signWith(agentId, sealed, () => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: /no master key/.test((e as Error).message) ? "unknown_key_version" : "decrypt_failed" };
  }
}
