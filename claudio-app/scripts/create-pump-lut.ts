// One-time: create Claudio's pump.fun Address Lookup Table on Solana and print its address for PUMP_LUT_ADDRESS.
//
//   npx tsx scripts/create-pump-lut.ts <keypair.json> [--send]
//
// The keypair (a solana-keygen JSON file) becomes the table's authority and pays ~0.01 SOL of rent. Without --send it
// only builds and simulates the transactions. Uses SOL_RPC_URL when set (the public RPC works too, just slower).
// Mainnet unless CLAUDIO_NETWORK=testnet (then devnet). The table only holds public pump.fun program/config accounts.
import { readFileSync } from "fs";
import { AddressLookupTableAccount, Keypair, VersionedTransaction } from "@solana/web3.js";
import { buildLutSetup } from "../server/launch/pump/lut";
import { solConnection } from "../server/launch/sol";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: npx tsx scripts/create-pump-lut.ts <keypair.json> [--send]");
  process.exit(2);
}
const send = flags.includes("--send");
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
const conn = solConnection();
const authority = kp.publicKey.toBase58();

const balance = (await conn.getBalance(kp.publicKey, "confirmed")) / 1e9;
console.log(`authority ${authority}  balance ${balance} SOL  rpc ${conn.rpcEndpoint.replace(/api-key=[^&]+/, "api-key=…")}`);
if (balance < 0.012) {
  console.error("Not enough SOL: send at least 0.015 SOL to the authority first.");
  process.exit(1);
}

const setup = await buildLutSetup(authority);
console.log(`lookup table ${setup.address}  (${setup.addresses.length} addresses, ${setup.txs.length} transactions)`);

for (const [i, p] of setup.txs.entries()) {
  if (p.kind !== "svm") throw new Error("unexpected tx kind");
  const tx = VersionedTransaction.deserialize(Buffer.from(p.base64, "base64"));
  tx.sign([kp]);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false });
  if (sim.value.err) {
    console.error(`tx ${i + 1} simulation failed:`, JSON.stringify(sim.value.err), sim.value.logs?.slice(-6));
    process.exit(1);
  }
  console.log(`tx ${i + 1}/${setup.txs.length} simulated ok: ${p.description}`);
  if (!send) continue;
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) {
    console.error(`tx ${i + 1} failed on-chain:`, JSON.stringify(res.value.err), sig);
    process.exit(1);
  }
  console.log(`tx ${i + 1} confirmed: ${sig}`);
}

if (!send) {
  console.log("\nDry run only. Re-run with --send to create the table.");
  process.exit(0);
}

// Wait until the table is readable with every address in it.
for (let n = 0; n < 30; n++) {
  const acc = await conn.getAddressLookupTable(new (await import("@solana/web3.js")).PublicKey(setup.address));
  const table = acc.value as AddressLookupTableAccount | null;
  if (table && table.state.addresses.length >= setup.addresses.length) {
    console.log(`\nDone. ${table.state.addresses.length} addresses in the table.\n\nSet this Replit secret, then restart / redeploy:\n  PUMP_LUT_ADDRESS=${setup.address}\n`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.error(`Table created but not readable yet. Check it in a minute: https://solscan.io/account/${setup.address}`);
process.exit(1);
