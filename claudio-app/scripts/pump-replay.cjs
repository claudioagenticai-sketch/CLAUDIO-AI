// Replays a pump.fun launch plan (PLAN_OUT of server/launch/pump/pump.check.ts) in LiteSVM with every referenced
// account and upgradeable program cloned from mainnet: create → fee-sharing lock → dev buy → harvest, one after the
// other (mainnet simulateTransaction can only run the first tx). sigverify + blockhash checks off; read-only.
//
//   PLAN_OUT=/tmp/plan.json npx tsx server/launch/pump/pump.check.ts      (SYNTH_LUT=1: atomic layout)
//   npm i --prefix /tmp/lsvm litesvm@0.6                                  (web3.js-v1 API; not a repo dependency)
//   NODE_PATH=/tmp/lsvm/node_modules RPC=https://api.mainnet-beta.solana.com TREASURY=<pubkey> node scripts/pump-replay.cjs /tmp/plan.json
// Collector check: `npx tsx server/platform/collector.check.ts --prepare /tmp/plan.json` swaps the harvest for the
// collector's own distribute tx (plan.fund = payers to airdrop); STATE_OUT=<file> dumps the post-launch sharing config /
// curve / creator vault and the shareholders' balance changes for `collector.check.ts --verify <file>`.
//
// SPL Token / Token-2022 / ATA come from LiteSVM's bundled builds, not mainnet.
const { LiteSVM, Clock } = require("litesvm");
const { PublicKey, VersionedTransaction, Connection } = require("@solana/web3.js");
const fs = require("fs");
const RPC = process.env.RPC || "https://solana-rpc.publicnode.com";
const conn = new Connection(RPC, "confirmed");
const UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const BUILTIN_SKIP = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWWc7n9ekkXhxkYzH",
  "SysvarRent111111111111111111111111111111111",
]);

(async () => {
  const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  plan.txs = plan.txs.concat(plan.harvest || []);
  const txs = plan.txs.map((t) => VersionedTransaction.deserialize(Buffer.from(t.base64, "base64")));
  const keys = new Set();
  for (const tx of txs) for (const k of tx.message.staticAccountKeys) keys.add(k.toBase58());
  if (plan.lut) for (const a of plan.lut.addresses) keys.add(a);
  const list = [...keys].filter((k) => !BUILTIN_SKIP.has(k));
  const svm = new LiteSVM().withSigverify(false).withBlockhashCheck(false);
  const slot = await conn.getSlot();
  const now = BigInt(Math.floor(Date.now() / 1000));
  svm.setClock(new Clock(BigInt(slot), now - 1000n, BigInt(Math.floor(slot / 432000)), BigInt(Math.floor(slot / 432000)) + 1n, now));
  svm.warpToSlot(BigInt(slot));
  const infos = [];
  for (let i = 0; i < list.length; i += 100) infos.push(...(await conn.getMultipleAccountsInfo(list.slice(i, i + 100).map((k) => new PublicKey(k)))));
  let loaded = 0, programs = 0;
  for (let i = 0; i < list.length; i++) {
    const info = infos[i];
    if (!info) continue;
    const pk = new PublicKey(list[i]);
    if (info.executable && info.owner.equals(UPGRADEABLE)) {
      const pd = new PublicKey(info.data.subarray(4, 36));
      const pdi = await conn.getAccountInfo(pd);
      svm.addProgram(pk, pdi.data.subarray(45));
      programs++;
      continue;
    }
    svm.setAccount(pk, { lamports: info.lamports, data: info.data, owner: info.owner, executable: info.executable, rentEpoch: 0 });
    loaded++;
  }
  if (plan.lut) {
    const n = plan.lut.addresses.length;
    const data = Buffer.alloc(56 + 32 * n);
    data.writeUInt32LE(1, 0);
    data.writeBigUInt64LE(18446744073709551615n, 4);
    data.writeBigUInt64LE(BigInt(slot - 10), 12);
    plan.lut.addresses.forEach((a, i) => new PublicKey(a).toBuffer().copy(data, 56 + 32 * i));
    svm.setAccount(new PublicKey(plan.lut.key), { lamports: 1e9, data, owner: new PublicKey("AddressLookupTab1e1111111111111111111111111"), executable: false, rentEpoch: 0 });
  }
  console.log(`cloned ${loaded} accounts + ${programs} programs from mainnet at slot ${slot}`);
  for (const f of plan.fund || []) svm.airdrop(new PublicKey(f), 1_000_000_000n);
  const creator = new PublicKey(plan.creator);
  const before = svm.getBalance(creator);
  const nLaunch = plan.txs.length - (plan.harvest || []).length;
  const state = { afterLaunch: null, balances: {} };
  const watch = (plan.watch || []).map((a) => new PublicKey(a));
  const snap = () => Object.fromEntries(watch.map((k) => [k.toBase58(), Number(svm.getBalance(k) || 0n)]));
  let pre = null;
  let ok = true;
  txs.forEach((tx, i) => {
    if (!ok) return;
    const r = svm.sendTransaction(tx);
    const failed = typeof r.err === "function";
    const meta = failed ? r.meta() : r;
    const logs = meta.logs();
    console.log(`\n── tx ${i + 1}: ${plan.txs[i].description} → ${failed ? "FAILED " + r.err().toString() : "ok"}, ${meta.computeUnitsConsumed()} CU`);
    for (const l of logs) if (!/^Program data:|consumed|^Program [A-Za-z0-9]+ invoke|success$/.test(l) || failed) console.log("   ", l.slice(0, 200));
    if (failed) ok = false;
    svm.expireBlockhash();
    if (i === nLaunch - 1 && plan.meta && plan.meta.sharingConfig) {
      const acc = (a) => { const x = svm.getAccount(new PublicKey(a)); return x ? { lamports: Number(x.lamports), data: Buffer.from(x.data).toString("base64") } : null; };
      const vault = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), new PublicKey(plan.meta.sharingConfig).toBuffer()], new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"))[0];
      state.afterLaunch = { sharingConfig: acc(plan.meta.sharingConfig), bondingCurve: acc(plan.meta.bondingCurve), creatorVault: acc(vault.toBase58()) };
      pre = snap();
    }
  });
  if (pre) { const post = snap(); for (const k of Object.keys(post)) state.balances[k] = post[k] - pre[k]; }
  if (process.env.STATE_OUT) fs.writeFileSync(process.env.STATE_OUT, JSON.stringify(state, null, 1));
  const after = svm.getBalance(creator);
  if (process.env.TREASURY) console.log("treasury balance after:", svm.getBalance(new PublicKey(process.env.TREASURY)));
  console.log(`\ncreator spent ${(Number(before - after) / 1e9).toFixed(6)} SOL`);
  if (ok) {
    const sc = svm.getAccount(new PublicKey(plan.meta.sharingConfig));
    const bc = svm.getAccount(new PublicKey(plan.meta.bondingCurve));
    console.log("sharing_config bytes", sc && sc.data.length, "bonding curve creator =", bc && new PublicKey(Buffer.from(bc.data).subarray(49, 81)).toBase58());
  }
  process.exit(ok ? 0 : 1);
})();
