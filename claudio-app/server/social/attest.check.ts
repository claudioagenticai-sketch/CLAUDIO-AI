// Manual end-to-end check (not part of the app): server-signed attestation → on-chain bind → funds reach the wallet.
// Run against a local chain with the factory deployed:
//   HOOD_RPC_URL=http://127.0.0.1:8546 SOCIAL_VAULT_FACTORY_HOOD=0x… SOCIAL_ATTESTOR_KEY=0x… npx tsx server/social/attest.check.ts
import { createWalletClient, http, parseEther, getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { evmClient } from "../trade/evm";
import { identityHash, identityKey } from "./identity";
import { signBind, vaultAddress, SOCIAL_FACTORY_ABI, SOCIAL_VAULT_ABI } from "./attest";

async function main() {
  const rpc = process.env.HOOD_RPC_URL!;
  const funder = privateKeyToAccount(process.env.FUNDER_KEY as `0x${string}`);
  const wallet = privateKeyToAccount(generatePrivateKey()).address;
  const id = identityHash(identityKey({ provider: "x", providerUserId: "44196397" }));
  const client = evmClient("hood");
  const vault = (await vaultAddress("hood", id))!;
  const w = createWalletClient({ account: funder, transport: http(rpc), chain: { id: 4663, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } });

  // Fees arrive before the person ever signed in (vault not deployed yet).
  await client.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: vault, value: parseEther("0.7") }) });
  console.log("vault", vault, "balance before claim", await client.getBalance({ address: vault }));

  const att = await signBind("hood", id, wallet);
  const hash = await w.writeContract({
    address: att.factory,
    abi: SOCIAL_FACTORY_ABI,
    functionName: "bind",
    args: [att.identity, att.wallet, BigInt(att.deadline), att.signature, ["0x0000000000000000000000000000000000000000"]],
  });
  const r = await client.waitForTransactionReceipt({ hash });
  const bal = await client.getBalance({ address: wallet });
  const ben = await client.readContract({ address: vault, abi: SOCIAL_VAULT_ABI, functionName: "beneficiary" });
  console.log("bind status", r.status, "| beneficiary", ben === getAddress(wallet) ? "= claimer ✓" : ben, "| claimer received", bal);
  if (r.status !== "success" || bal !== parseEther("0.7")) process.exit(1);

  // Replay must fail (nonce consumed).
  try {
    await client.simulateContract({ account: funder, address: att.factory, abi: SOCIAL_FACTORY_ABI, functionName: "bind", args: [att.identity, att.wallet, BigInt(att.deadline), att.signature, []] });
    console.log("replay: UNEXPECTEDLY SUCCEEDED");
    process.exit(1);
  } catch {
    console.log("replay rejected ✓");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
