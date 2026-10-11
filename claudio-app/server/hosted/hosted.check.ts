// Hosted-agents checks (not part of the app). Needs a throwaway Postgres; never touches mainnet (the Solana RPC and
// OpenRouter are local mocks; nothing is ever sent).
//   DATABASE_URL=postgres://claudio:claudio@localhost:55440/c_hosted npx tsx server/hosted/hosted.check.ts
// Creates a minimal `agents` table if none exists (the real one belongs to the agents workstream).
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { createHash, createPublicKey, randomBytes, verify as edVerify } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (a throwaway database)");
  process.exit(2);
}

// ─── mocks: OpenRouter + Solana RPC on one local server ──────────────
const FREE = "mock/free-model:free";
const PAID = "mock/paid-model";
const seenModels: string[] = [];
let nextCompletion = '{"action":"idle","reason":"nothing to do"}';
const mock = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/or/models") {
      return res.end(JSON.stringify({ data: [
        { id: FREE, pricing: { prompt: "0", completion: "0" } },
        { id: PAID, pricing: { prompt: "0.000002", completion: "0.000004" } },
      ] }));
    }
    if (req.url === "/or/chat/completions") {
      const j = JSON.parse(body);
      seenModels.push(j.model);
      return res.end(JSON.stringify({ model: j.model, choices: [{ message: { content: nextCompletion } }] }));
    }
    if (req.url === "/rpc") {
      const j = JSON.parse(body);
      if (j.method === "getBalance") return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, result: { value: 1_500_000_000 } }));
      if (j.method === "getSignaturesForAddress") return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, result: [] }));
      if (j.method === "sendTransaction") return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, error: { message: "mock refuses to send" } }));
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, error: { message: "unsupported in mock" } }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

const MASTER_A = randomBytes(32).toString("hex");
const MASTER_B = randomBytes(32).toString("base64");
process.env.VAULT_MASTER_KEY = MASTER_A;
delete process.env.VAULT_MASTER_KEY_PREVIOUS;
delete process.env.HOSTED_LIVE_TRADING;
delete process.env.HOSTED_KILL;
process.env.OPENROUTER_API_KEY = "test-key-not-real-0000";
process.env.OPENROUTER_BASE_URL = `${mockUrl}/or`;
process.env.SOL_RPC_URL = `${mockUrl}/rpc`;
process.env.SOLANA_RPC_URL = `${mockUrl}/rpc`;

const { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedMessage, ComputeBudgetProgram, TransactionInstruction } = await import("@solana/web3.js");
const { createTransferInstruction, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
const bs58 = (await import("bs58")).default;

const ADMIN = Keypair.generate().publicKey.toBase58();
const OWNER = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
process.env.ADMIN_WALLETS = ADMIN;
process.env.ADMIN_PASSWORD = "test-password-123";

const { pool } = await import("../db");
const { migrate } = await import("../migrate");
if (!pool) throw new Error("no pool");
await migrate();
await pool.query(`CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, category text, mode text NOT NULL, tier text,
  status text NOT NULL DEFAULT 'active', bio text, persona text, model text, owner_wallet text, wallet text)`);

// Leftovers from earlier runs (their master keys are gone) would otherwise fail the rotation check.
for (const t of ["agent_wallets", "agent_policies", "agent_ledger", "agent_paper_trades", "agent_approvals", "agent_actions", "agent_runtime"]) {
  await pool.query(`DELETE FROM ${t} WHERE agent_id LIKE 't-%' OR agent_id IN (SELECT id FROM agents WHERE slug = 'claudio')`);
}
await pool.query(`DELETE FROM agents WHERE id LIKE 't-%'`);
await pool.query(`DELETE FROM hosted_settings WHERE key = 'kill'`);

const vault = await import("./vault");
const signer = await import("./signer");
const policyMod = await import("./policy");
const store = await import("./hostedStore");
const runner = await import("./runner");
const trading = await import("./trading");
const { escrowForAgent, registerHostedRoutes } = await import("./index");
const { tokenStore, blankToken } = await import("../store");

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
}
function section(s: string) {
  console.log(`\n── ${s}`);
}

const run = randomBytes(3).toString("hex");
async function mkAgent(mode: string, opts: { slug?: string; owner?: string; model?: string | null; status?: string } = {}): Promise<{ id: string; slug: string }> {
  const id = `t-${run}-${randomBytes(4).toString("hex")}`;
  const slug = opts.slug ?? `a-${run}-${randomBytes(3).toString("hex")}`;
  await pool!.query(
    `INSERT INTO agents (id, slug, name, mode, status, persona, model, owner_wallet) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (slug) DO UPDATE SET mode = EXCLUDED.mode RETURNING id`,
    [id, slug, `Agent ${slug}`, mode, opts.status ?? "active", "A dry, data-first market watcher.", opts.model ?? null, opts.owner ?? OWNER],
  );
  const r = await pool!.query(`SELECT id FROM agents WHERE slug = $1`, [slug]);
  return { id: r.rows[0].id, slug };
}

// ═════════════════════════════════════════════════════════════════════
section("vault: master key parsing");
check("missing key refused", vault.parseMasterKey("").ok === false);
check("short key refused", vault.parseMasterKey(randomBytes(16).toString("hex")).ok === false);
check("low-entropy key refused", vault.parseMasterKey("ab".repeat(32)).ok === false);
check("passphrase refused", vault.parseMasterKey("correct horse battery staple is a long passphrase!").ok === false);
check("hex 32 bytes accepted", vault.parseMasterKey(MASTER_A).ok === true);
check("base64 32 bytes accepted", vault.parseMasterKey(MASTER_B).ok === true);
check("vault ready", vault.vaultState() === "ready");

section("escrowForAgent: eligibility, idempotency, concurrency");
const hosted = await mkAgent("hosted");
const ext = await mkAgent("external");
const resOther = await mkAgent("resident");
await pool.query(`DELETE FROM agent_wallets WHERE agent_id IN (SELECT id FROM agents WHERE slug = 'claudio')`);
const claudio = await mkAgent("resident", { slug: "claudio" });
const a1 = await escrowForAgent(hosted.id);
const a2 = await escrowForAgent(hosted.id);
check("hosted agent gets an address", !!a1 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a1!), a1 ?? "null");
check("second call returns the same address", a1 === a2);
check("external agent → null", (await escrowForAgent(ext.id)) === null);
check("other resident → null", (await escrowForAgent(resOther.id)) === null);
check("unknown agent → null", (await escrowForAgent("nope-" + run)) === null);
check("resident claudio → address", !!(await escrowForAgent(claudio.id)));
const conc = await mkAgent("hosted");
const many = await Promise.all(Array.from({ length: 12 }, () => escrowForAgent(conc.id)));
const rows = await pool.query(`SELECT count(*)::int AS n FROM agent_wallets WHERE agent_id = $1`, [conc.id]);
check("12 concurrent calls → one wallet, one address", new Set(many).size === 1 && !!many[0] && rows.rows[0].n === 1);
// Cross-"process" race: bypass the in-process dedupe by inserting a competing row first.
const race = await mkAgent("hosted");
const sealed = vault.sealNewWallet(race.id);
await pool.query(`INSERT INTO agent_wallets (agent_id, address, enc_key, iv, tag, wrapped_dek, key_version) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [race.id, sealed.address, sealed.encKey, sealed.iv, sealed.tag, sealed.wrappedDek, sealed.keyVersion]);
check("race with an existing row → returns the stored address", (await escrowForAgent(race.id)) === sealed.address);
const stored = (await pool.query(`SELECT * FROM agent_wallets WHERE agent_id = $1`, [hosted.id])).rows[0];
check("row holds no plaintext seed-sized field", stored.enc_key.length > 40 && !JSON.stringify(stored).includes(MASTER_A));

section("vault: encryption round-trip, tamper detection, wrong master key, rotation");
check("round-trip: decrypted key matches the address", (await signer.verifyWalletKey(hosted.id)).ok === true);
const flip = (b64: string) => {
  const b = Buffer.from(b64, "base64");
  b[0] ^= 1;
  return b.toString("base64");
};
await pool.query(`UPDATE agent_wallets SET enc_key = $2 WHERE agent_id = $1`, [hosted.id, flip(stored.enc_key)]);
check("tampered ciphertext → refused", (await signer.verifyWalletKey(hosted.id)).reason === "decrypt_failed");
await pool.query(`UPDATE agent_wallets SET enc_key = $2, tag = $3 WHERE agent_id = $1`, [hosted.id, stored.enc_key, flip(stored.tag)]);
check("tampered tag → refused", (await signer.verifyWalletKey(hosted.id)).reason === "decrypt_failed");
const [iv, tg, ct] = stored.wrapped_dek.split(".");
await pool.query(`UPDATE agent_wallets SET tag = $2, wrapped_dek = $3 WHERE agent_id = $1`, [hosted.id, stored.tag, [iv, tg, flip(ct)].join(".")]);
check("tampered wrapped data key → refused", (await signer.verifyWalletKey(hosted.id)).reason === "decrypt_failed");
await pool.query(`UPDATE agent_wallets SET wrapped_dek = $2 WHERE agent_id = $1`, [hosted.id, stored.wrapped_dek]);
// Row transplant: another agent's ciphertext under this agent id must fail (AAD binds agent id + address).
const concRow = (await pool.query(`SELECT * FROM agent_wallets WHERE agent_id = $1`, [conc.id])).rows[0];
await pool.query(`UPDATE agent_wallets SET enc_key = $2, iv = $3, tag = $4, wrapped_dek = $5 WHERE agent_id = $1`, [hosted.id, concRow.enc_key, concRow.iv, concRow.tag, concRow.wrapped_dek]);
check("ciphertext transplanted from another agent → refused", (await signer.verifyWalletKey(hosted.id)).ok === false);
await pool.query(`UPDATE agent_wallets SET enc_key = $2, iv = $3, tag = $4, wrapped_dek = $5 WHERE agent_id = $1`, [hosted.id, stored.enc_key, stored.iv, stored.tag, stored.wrapped_dek]);
check("restored row decrypts again", (await signer.verifyWalletKey(hosted.id)).ok === true);
const verA = vault.currentKeyVersion();
process.env.VAULT_MASTER_KEY = MASTER_B;
check("wrong master key → refused (unknown key version)", (await signer.verifyWalletKey(hosted.id)).reason === "unknown_key_version");
await pool.query(`UPDATE agent_wallets SET key_version = $2 WHERE agent_id = $1`, [hosted.id, vault.currentKeyVersion()]);
check("wrong master key with forged key_version → refused", (await signer.verifyWalletKey(hosted.id)).reason === "decrypt_failed");
await pool.query(`UPDATE agent_wallets SET key_version = $2 WHERE agent_id = $1`, [hosted.id, verA]);
process.env.VAULT_MASTER_KEY_PREVIOUS = MASTER_A;
check("rotation: old rows readable via VAULT_MASTER_KEY_PREVIOUS", (await signer.verifyWalletKey(hosted.id)).ok === true);
const rw = await vault.rewrapAll("test");
check("rotation: re-wrap moves rows to the new key", rw.rewrapped >= 4 && rw.failed === 0, JSON.stringify(rw));
delete process.env.VAULT_MASTER_KEY_PREVIOUS;
check("rotation: readable with only the new key", (await signer.verifyWalletKey(hosted.id)).ok === true && (await signer.verifyWalletKey(conc.id)).ok === true);
process.env.VAULT_MASTER_KEY = "00".repeat(32);
const weakAgent = await mkAgent("hosted");
check("weak master key → vault refuses, escrowForAgent null", vault.vaultState() === "weak_key" && (await escrowForAgent(weakAgent.id)) === null);
delete process.env.VAULT_MASTER_KEY;
check("missing master key → vault refuses", vault.vaultState() === "missing_key" && (await escrowForAgent(weakAgent.id)) === null);
process.env.VAULT_MASTER_KEY = MASTER_B;
let claimThrew = false;
try {
  vault.claimOpener();
} catch {
  claimThrew = true;
}
check("decrypt capability can't be claimed a second time", claimThrew);

section("isolation: who imports the signer / vault");
const root = process.cwd();
const offenders: string[] = [];
function walk(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === "node_modules" || f.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(f)) {
      const src = readFileSync(p, "utf8");
      const rel = path.relative(root, p);
      const inHosted = rel.startsWith(path.join("server", "hosted") + path.sep);
      if (!inHosted && /hosted\/(signer|vault)["']/.test(src)) offenders.push(rel);
      if (inHosted && /from "\.\/signer"/.test(src) && !/(trading|routes|hosted\.check)\.ts$/.test(rel)) offenders.push(rel);
    }
  }
}
for (const d of ["server", "shared", "client/src", "scripts"]) {
  try {
    walk(path.join(root, d));
  } catch {
    /* missing dir */
  }
}
check("signer/vault only imported inside server/hosted (signer: trading + routes only)", offenders.length === 0, offenders.join(", "));

// ═════════════════════════════════════════════════════════════════════
section("policy enforcement");
const MINT = Keypair.generate().publicKey.toBase58();
const MINT2 = Keypair.generate().publicKey.toBase58();
tokenStore.register(blankToken({ chain: "sol", address: MINT, launchpad: "pump", name: "Test", symbol: "TST", creator: OTHER, createdAt: Date.now(), volume1hUsd: 9000 }));
tokenStore.updateMarket(`sol:${MINT}`, { spotPriceNative: 3e-8 });
const trader = await mkAgent("hosted");
await escrowForAgent(trader.id);
const buy = (amountSol: number, mint = MINT) => ({ kind: "pump_buy" as const, mint, amountSol, slippageBps: 500 });
let v = await policyMod.checkTrade(trader.id, buy(0.05));
check("default policy: trading disabled", !v.ok && v.code === "trading_disabled");
await policyMod.savePolicy(trader.id, { ...(await policyMod.loadPolicy(trader.id)).policy, canTrade: true, maxSolPerTrade: 0.2, maxSolPerDay: 0.3, askOwnerAboveSol: 0.15, blockedTokens: [MINT2] }, "test");
v = await policyMod.checkTrade(trader.id, buy(0.05));
check("canTrade → ok, paper (live off)", v.ok && v.live === false);
v = await policyMod.checkTrade(trader.id, buy(0.25));
check("over per-trade cap → refused", !v.ok && v.code === "over_trade_cap");
v = await policyMod.checkTrade(trader.id, buy(0.05, MINT2));
check("blocked token → refused", !v.ok && v.code === "blocked_token");
v = await policyMod.checkTrade(trader.id, buy(0.18));
check("above ask-owner threshold → needs approval", !v.ok && v.code === "needs_approval");
const p1 = await trading.executeTrade(trader.id, buy(0.1), { source: "runner" });
const p2 = await trading.executeTrade(trader.id, buy(0.1), { source: "runner" });
check("paper buys fill", p1.ok && p2.ok && p1.mode === "paper");
v = await policyMod.checkTrade(trader.id, buy(0.12));
check("daily cap (paper spend counts) → refused", !v.ok && v.code === "over_daily_cap");
const sell = await trading.executeTrade(trader.id, { kind: "pump_sell", mint: MINT, amountSol: 0.05 }, { source: "runner" });
check("paper sell fills against the position", sell.ok && sell.mode === "paper" && sell.fill.side === "sell");
await store.setGlobalKill(true, "test", "check");
v = await policyMod.checkTrade(trader.id, buy(0.01));
check("global kill switch → refused", !v.ok && v.code === "killed_global");
await store.setGlobalKill(false, "test");
await policyMod.savePolicy(trader.id, { ...(await policyMod.loadPolicy(trader.id)).policy, killed: true }, "test");
v = await policyMod.checkTrade(trader.id, buy(0.01));
check("per-agent kill switch → refused", !v.ok && v.code === "killed");
await policyMod.savePolicy(trader.id, { ...(await policyMod.loadPolicy(trader.id)).policy, killed: false }, "test", true);
v = await policyMod.checkTrade(trader.id, buy(0.01));
check("admin kill → refused even with owner switch off", !v.ok && v.code === "killed");
await policyMod.savePolicy(trader.id, (await policyMod.loadPolicy(trader.id)).policy, "test", false);
check("policy patch: out-of-bounds rejected", !policyMod.policyPatchSchema.safeParse({ maxSolPerTrade: 100 }).success);
check("policy patch: unknown key rejected", !policyMod.policyPatchSchema.safeParse({ withdrawTo: OTHER }).success);
check("policy patch: bad mint rejected", !policyMod.policyPatchSchema.safeParse({ blockedTokens: ["not a mint"] }).success);
check("policy: trade cap > daily cap rejected", policyMod.validatePolicy({ ...(await policyMod.loadPolicy(trader.id)).policy, maxSolPerTrade: 2, maxSolPerDay: 1 }) !== null);

// ═════════════════════════════════════════════════════════════════════
section("signer: allowlist + live switch");
const escrow = (await vault.escrowAddressOf(trader.id))!;
const escrowPk = new PublicKey(escrow);
let s = await signer.signIntent(trader.id, buy(0.05));
check("live signing disabled by default → refused", !s.ok && s.code === "live_disabled");
s = await signer.signIntent(trader.id, { kind: "transfer", to: OTHER, amountSol: 1 });
check("non-trade intent (transfer) → refused", !s.ok && s.code === "bad_intent");
s = await signer.signIntent(trader.id, { ...buy(0.05), extra: "x" });
check("intent with extra fields → refused", !s.ok && s.code === "bad_intent");
const bh = "11111111111111111111111111111111";
const msgOf = (ixs: InstanceType<typeof TransactionInstruction>[], payer = escrowPk) =>
  VersionedMessage.deserialize(new TransactionMessage({ payerKey: payer, recentBlockhash: bh, instructions: ixs }).compileToV0Message().serialize());
const refuses = (name: string, msg: any, intent = buy(0.05), code?: string) => {
  try {
    signer.validateMessage(msg, escrow, intent);
    check(name, false, "accepted!");
  } catch (e) {
    const got = (e as { code?: string }).code;
    check(name, e instanceof signer.Refused && (!code || got === code), got);
  }
};
refuses("System transfer out → refused", msgOf([SystemProgram.transfer({ fromPubkey: escrowPk, toPubkey: new PublicKey(OTHER), lamports: 1_000_000 })]), buy(0.05), "program_not_allowed");
refuses("SPL token transfer → refused", msgOf([createTransferInstruction(Keypair.generate().publicKey, Keypair.generate().publicKey, escrowPk, 1, [], TOKEN_PROGRAM_ID)]), buy(0.05), "program_not_allowed");
refuses("Memo / unknown program → refused", msgOf([new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from("hi") })]), buy(0.05), "program_not_allowed");
refuses("ComputeBudget only (no pump buy) → refused", msgOf([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 })]), buy(0.05), "ix_count");
refuses("someone else as fee payer → refused", msgOf([ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 })], new PublicKey(OTHER)), buy(0.05), "bad_fee_payer");
const { buyExactQuoteInV2Ix, FEE_RECIPIENTS, BUYBACK_FEE_RECIPIENTS, createUserAtaIx } = await import("../launch/pump/ixs");
const pumpBuy = (user = escrowPk, lamports = BigInt(50_000_000), mint = new PublicKey(MINT)) =>
  buyExactQuoteInV2Ix({ mint, user, curveCreator: Keypair.generate().publicKey, feeRecipient: FEE_RECIPIENTS[0], buybackFeeRecipient: BUYBACK_FEE_RECIPIENTS[0], spendableLamports: lamports, minTokensOut: BigInt(1000) });
refuses("pump buy for another user → refused", msgOf([pumpBuy(new PublicKey(OTHER))]), buy(0.05));
const sneaky = pumpBuy();
sneaky.keys[13] = { pubkey: new PublicKey(OTHER), isSigner: false, isWritable: true };
refuses("pump buy whose user slot isn't the escrow → refused", msgOf([sneaky]), buy(0.05), "user_mismatch");
refuses("pump buy amount ≠ intent → refused", msgOf([pumpBuy(escrowPk, BigInt(90_000_000))]), buy(0.05), "amount_mismatch");
refuses("pump buy of another mint → refused", msgOf([pumpBuy(escrowPk, BigInt(50_000_000), new PublicKey(MINT2))]), buy(0.05), "mint_mismatch");
const wrongDisc = pumpBuy();
wrongDisc.data = Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), wrongDisc.data.subarray(8)]);
refuses("pump ix with a non-allowlisted discriminator → refused", msgOf([wrongDisc]), buy(0.05), "ix_not_allowed");
refuses("pump buy + hidden System transfer → refused", msgOf([pumpBuy(), SystemProgram.transfer({ fromPubkey: escrowPk, toPubkey: new PublicKey(OTHER), lamports: 1 })]), buy(0.05), "program_not_allowed");
let okMsg = true;
try {
  signer.validateMessage(msgOf([ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }), createUserAtaIx(new PublicKey(MINT), escrowPk), pumpBuy()]), escrow, buy(0.05));
} catch (e) {
  okMsg = false;
  console.log("   ", (e as Error).message);
}
check("well-formed escrow pump buy passes the allowlist", okMsg);

process.env.HOSTED_LIVE_TRADING = "true";
s = await signer.signIntent(trader.id, buy(0.05));
check("live on + policy paper → refused (paper_mode)", !s.ok && s.code === "paper_mode");
await policyMod.savePolicy(trader.id, { ...(await policyMod.loadPolicy(trader.id)).policy, paper: false, maxSolPerDay: 5 }, "test");
// Fake chain reads: a synthetic bonding curve (default pump reserves) + blockhash. Nothing is sent.
const curve = Buffer.alloc(151);
Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).copy(curve, 0);
curve.writeBigUInt64LE(BigInt("1073000000000000"), 8);
curve.writeBigUInt64LE(BigInt("30000000000"), 16);
curve.writeBigUInt64LE(BigInt("793100000000000"), 24);
curve.writeBigUInt64LE(BigInt("1000000000000000"), 40);
Keypair.generate().publicKey.toBuffer().copy(curve, 49);
new PublicKey("So11111111111111111111111111111111111111112").toBuffer().copy(curve, 83);
signer.setChainReader({ accountData: async () => curve, latestBlockhash: async () => ({ blockhash: bs58.encode(randomBytes(32)), lastValidBlockHeight: 1 }) });
s = await signer.signIntent(trader.id, buy(0.05));
let sigOk = false;
if (s.ok) {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Buffer.from(s.tx, "base64"));
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), new PublicKey(escrow).toBuffer()]);
  sigOk = edVerify(null, Buffer.from(tx.message.serialize()), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(tx.signatures[0]));
}
check("live on + policy live: builds, validates and signs as the escrow (not sent)", s.ok && sigOk);
s = await signer.signIntent(trader.id, buy(0.2));
check("signer re-checks policy: above ask-owner → needs approval", !s.ok && s.code === "needs_approval");
s = await signer.signIntent(trader.id, { kind: "pump_sell", mint: MINT, amountSol: 0.05 });
check("live sell → refused (paper only)", !s.ok && s.code === "unsupported_live");
const liveExec = await trading.executeTrade(trader.id, buy(0.05), { source: "runner" });
check("live path: send failure is reported, not retried blindly", !liveExec.ok && liveExec.code === "send_failed");
signer.setChainReader(null);
delete process.env.HOSTED_LIVE_TRADING;
await policyMod.savePolicy(trader.id, { ...(await policyMod.loadPolicy(trader.id)).policy, paper: true }, "test");

// ═════════════════════════════════════════════════════════════════════
section("runner: decision parsing + mock OpenRouter (free only)");
const P = runner.parseDecision;
check("plain JSON", P('{"action":"idle","reason":"x"}').ok);
check("fenced JSON with chatter", P('Sure!\n```json\n{"action":"post","room":"general","content":"gm {braces} \\"q\\""}\n```').ok);
check("unknown action refused", !P('{"action":"transfer","to":"x"}').ok);
check("extra keys refused", !P('{"action":"idle","sudo":true}').ok);
check("oversized post refused", !P(JSON.stringify({ action: "post", room: "general", content: "x".repeat(600) })).ok);
check("bad mint refused", !P('{"action":"paper_trade","side":"buy","mint":"0xdead","amountSol":0.1}').ok);
check("no JSON refused", !P("I think we should buy").ok);

const bot = await mkAgent("hosted", { model: PAID });
await store.setRunning(bot.id, true, OWNER, "Watch new pump coins and comment on holder concentration.");
seenModels.length = 0;
nextCompletion = '```json\n{"action":"post","room":"general","content":"Top-10 holders own 40% on TST — careful.","memory":"TST concentrated"}\n```';
let r = await runner.runAgentOnce(bot.id);
// With the real thread merged, an empty test database answers "room not found" (or "posted" once rooms exist);
// the stub answered "thread_unavailable". Any of these proves the decision went through postAsAgent.
check("post decision routed to postAsAgent", r.ok && r.action === "post" && /^post(ed|_thread_unavailable|_room_not_found|_)/.test(String(r.outcome)), JSON.stringify(r));
check("paid model refused: only free models were called", seenModels.length > 0 && seenModels.every((m) => m !== PAID), seenModels.join(","));
check("memory rolled", (await store.getRuntime(bot.id)).memory.includes("TST concentrated"));
nextCompletion = '{"action":"post","room":"admin-secrets","content":"hi"}';
r = await runner.runAgentOnce(bot.id);
check("post to a non-allowed room → blocked", r.outcome === "room_not_allowed");
await policyMod.savePolicy(bot.id, { ...(await policyMod.loadPolicy(bot.id)).policy, canTrade: true, maxSolPerTrade: 0.5, maxSolPerDay: 2, askOwnerAboveSol: 0.25 }, "test");
nextCompletion = JSON.stringify({ action: "paper_trade", side: "buy", mint: MINT, amountSol: 0.05, reason: "momentum" });
r = await runner.runAgentOnce(bot.id);
check("paper_trade decision → paper fill", r.outcome === "paper_trade", JSON.stringify(r));
nextCompletion = JSON.stringify({ action: "paper_trade", side: "buy", mint: MINT, amountSol: 0.3, reason: "bigger" });
r = await runner.runAgentOnce(bot.id);
const pend = await store.listApprovals(bot.id);
check("trade above ask-owner → queued for the owner", r.outcome === "needs_approval" && pend.some((a) => a.status === "pending"));
nextCompletion = JSON.stringify({ action: "paper_trade", side: "buy", mint: Keypair.generate().publicKey.toBase58(), amountSol: 0.01 });
r = await runner.runAgentOnce(bot.id);
check("trade in a token not on the board → blocked", r.outcome === "unknown_token");
nextCompletion = "lol no json here";
r = await runner.runAgentOnce(bot.id);
check("garbage completion → invalid_decision logged", r.outcome === "invalid_decision");
await store.setGlobalKill(true, "test");
r = await runner.runAgentOnce(bot.id);
check("global kill → runner skips the agent", !r.ok && r.error === "killed_global");
await store.setGlobalKill(false, "test");
const paused = await mkAgent("hosted", { status: "paused" });
await store.setRunning(paused.id, true, OWNER);
r = await runner.runAgentOnce(paused.id);
check("paused agent → not run, auto-stopped", !r.ok && (await store.getRuntime(paused.id)).running === false);
const gateBefore = runner.llmGate();
const saveKey = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
check("no OpenRouter key → runner idles (unconfigured)", runner.llmGate() === "unconfigured" && gateBefore === "ok");
process.env.OPENROUTER_API_KEY = saveKey;

// ═════════════════════════════════════════════════════════════════════
section("endpoints: owner vs non-owner vs admin");
const express = (await import("express")).default;
const app = express();
app.use(express.json());
registerHostedRoutes(app);
const srv = app.listen(0, "127.0.0.1");
await new Promise((r2) => srv.once("listening", r2));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
async function session(wallet: string, admin = false): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await pool!.query(`INSERT INTO auth_sessions (token_hash, wallet, admin_until, expires_at) VALUES ($1,$2,$3, now() + interval '1 hour')`, [
    createHash("sha256").update(token).digest("hex"),
    wallet,
    admin ? new Date(Date.now() + 3600_000) : null,
  ]);
  return `claudio_session=${token}`;
}
const cOwner = await session(OWNER);
const cOther = await session(OTHER);
const cAdmin = await session(ADMIN, true);
const call = async (method: string, p: string, cookie?: string, body?: unknown) => {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
};
const slug = bot.slug;
check("wallet: no session → 401", (await call("GET", `/api/agents/${slug}/wallet`)).status === 401);
check("wallet: non-owner → 403", (await call("GET", `/api/agents/${slug}/wallet`, cOther)).status === 403);
let w = await call("GET", `/api/agents/${slug}/wallet`, cOwner);
check("wallet: owner → 200 with address/balance/paper", w.status === 200 && !!w.json.address && w.json.balanceSol === 1.5 && w.json.withdrawals === "unavailable" && w.json.paper.trades >= 1, JSON.stringify(w.json).slice(0, 160));
check("wallet: response has no key material", !/enc_key|wrapped|secret|iv"/i.test(JSON.stringify(w.json)));
check("wallet: admin → 200", (await call("GET", `/api/agents/${slug}/wallet`, cAdmin)).status === 200);
check("wallet: external agent → 409", (await call("GET", `/api/agents/${ext.slug}/wallet`, cOwner)).status === 409);
check("wallet: unknown agent → 404", (await call("GET", `/api/agents/nope-${run}/wallet`, cOwner)).status === 404);
check("policy GET: non-owner → 403", (await call("GET", `/api/agents/${slug}/policy`, cOther)).status === 403);
check("policy PUT: non-owner → 403", (await call("PUT", `/api/agents/${slug}/policy`, cOther, { canTrade: false })).status === 403);
check("policy PUT: out of bounds → 400", (await call("PUT", `/api/agents/${slug}/policy`, cOwner, { maxSolPerDay: 1000 })).status === 400);
const pu = await call("PUT", `/api/agents/${slug}/policy`, cOwner, { maxSolPerTrade: 0.4, askOwnerAboveSol: 0.2, paper: false });
check("policy PUT: owner → 200, live still effectively paper", pu.status === 200 && pu.json.policy.maxSolPerTrade === 0.4 && pu.json.effectivePaper === true);
const ak = await call("PUT", `/api/agents/${slug}/policy`, cAdmin, { killed: true });
check("policy PUT: admin kill → adminKilled", ak.status === 200 && ak.json.adminKilled === true && ak.json.policy.killed === false);
const ownerUnkill = await call("PUT", `/api/agents/${slug}/policy`, cOwner, { killed: false });
check("owner can't lift an admin kill", ownerUnkill.json.adminKilled === true);
check("run start blocked while admin-killed → 409", (await call("POST", `/api/agents/${slug}/run`, cOwner, { action: "start" })).status === 409);
await call("PUT", `/api/agents/${slug}/policy`, cAdmin, { killed: false });
check("run: non-owner → 403", (await call("POST", `/api/agents/${slug}/run`, cOther, { action: "start" })).status === 403);
check("run: bad body → 400", (await call("POST", `/api/agents/${slug}/run`, cOwner, { action: "fly" })).status === 400);
const st = await call("POST", `/api/agents/${slug}/run`, cOwner, { action: "start", goals: "Comment on new coins." });
check("run start: owner → running, memory not exposed", st.status === 200 && st.json.run.running === true && st.json.run.memory === undefined);
check("run stop: admin may stop", (await call("POST", `/api/agents/${slug}/run`, cAdmin, { action: "stop" })).json.run.running === false);
check("run start: admin can't start someone's agent", (await call("POST", `/api/agents/${slug}/run`, cAdmin, { action: "start" })).status === 403);
const lg = await call("GET", `/api/agents/${slug}/logs`, cOwner);
check("logs: owner → actions + approvals", lg.status === 200 && lg.json.actions.length > 0 && Array.isArray(lg.json.approvals));
check("logs: non-owner → 403", (await call("GET", `/api/agents/${slug}/logs`, cOther)).status === 403);
const pending = lg.json.approvals.find((a: any) => a.status === "pending");
check("approval: admin can't approve for the owner → 403", (await call("POST", `/api/agents/${slug}/approvals/${pending?.id}`, cAdmin, { approve: true })).status === 403);
check("approval: non-owner → 403", (await call("POST", `/api/agents/${slug}/approvals/${pending?.id}`, cOther, { approve: true })).status === 403);
const ap = await call("POST", `/api/agents/${slug}/approvals/${pending?.id}`, cOwner, { approve: true });
check("approval: owner approves → executed as paper trade", ap.status === 200 && ap.json.outcome?.ok === true && ap.json.approval.status === "executed", JSON.stringify(ap.json).slice(0, 200));
check("approval: second decision → 409", (await call("POST", `/api/agents/${slug}/approvals/${pending?.id}`, cOwner, { approve: true })).status === 409);
check("admin overview: owner → 403", (await call("GET", `/api/admin/hosted`, cOwner)).status === 403);
const ov = await call("GET", `/api/admin/hosted`, cAdmin);
check("admin overview: admin → wallets + status", ov.status === 200 && ov.json.wallets.length >= 3 && ov.json.vault === "ready" && ov.json.liveTrading === false);
check("admin overview: no key material", !/enc_key|wrapped_dek|"iv"|"tag"/.test(JSON.stringify(ov.json)));
check("admin kill PUT: owner → 403", (await call("PUT", `/api/admin/hosted`, cOwner, { killed: true })).status === 403);
const kon = await call("PUT", `/api/admin/hosted`, cAdmin, { killed: true, reason: "test" });
check("admin kill PUT: admin → on", kon.status === 200 && kon.json.kill.killed === true);
check("run start refused under global kill", (await call("POST", `/api/agents/${slug}/run`, cOwner, { action: "start" })).status === 409);
await call("PUT", `/api/admin/hosted`, cAdmin, { killed: false });
const audits = await pool.query(`SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'hosted.%' AND created_at > now() - interval '5 minutes'`);
check("mutations audited", audits.rows[0].n >= 8, `${audits.rows[0].n} hosted.* audit events`);

srv.close();
mock.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
