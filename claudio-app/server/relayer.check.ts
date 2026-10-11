// Manual adversarial check for the relayer allowlist (not part of the app). Run against a fork with the factories deployed:
//   HOOD_RPC_URL=… FEE_SPLITTER_FACTORY_HOOD=… SOCIAL_VAULT_FACTORY_HOOD=… RELAYER_KEY=… TOKEN=… VAULT=… CURVE=… npx tsx server/relayer.check.ts
import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import { relay, RelayError } from "./relayer";
import { SOCIAL_FACTORY_ABI, SOCIAL_VAULT_ABI } from "./social/attest";

const token = getAddress(process.env.TOKEN!);
const vault = getAddress(process.env.VAULT!);
const curve = getAddress(process.env.CURVE!);
const factory = getAddress(process.env.SOCIAL_VAULT_FACTORY_HOOD!);
const attacker = "0x000000000000000000000000000000000000bEEF" as Address;

const cases: { name: string; to: string; data: string; want: string }[] = [
  { name: "ERC-20 transfer (drain relayer tokens)", to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [attacker, BigInt(1)] }), want: "not_allowed" },
  { name: "ERC-20 approve", to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [attacker, BigInt(1)] }), want: "not_allowed" },
  { name: "sweepMany on a non-vault (the curve)", to: curve, data: encodeFunctionData({ abi: SOCIAL_VAULT_ABI, functionName: "sweepMany", args: [[]] }), want: "not_allowed" },
  { name: "bind on a fake factory", to: curve, data: encodeFunctionData({ abi: SOCIAL_FACTORY_ABI, functionName: "bind", args: ["0x" + "11".repeat(32) as `0x${string}`, attacker, BigInt(9e9), "0x", []] }), want: "not_allowed" },
  { name: "bind with a forged signature (real factory)", to: factory, data: encodeFunctionData({ abi: SOCIAL_FACTORY_ABI, functionName: "bind", args: ["0x" + "11".repeat(32) as `0x${string}`, attacker, BigInt(9e9), ("0x" + "22".repeat(65)) as `0x${string}`, []] }), want: "would_revert" },
  { name: "garbage calldata", to: factory, data: "0xdeadbeef", want: "not_allowed" },
  { name: "sweep on real vault (legit)", to: vault, data: encodeFunctionData({ abi: SOCIAL_VAULT_ABI, functionName: "sweepMany", args: [["0x0000000000000000000000000000000000000000"]] }), want: "ok" },
];

let failed = 0;
for (const c of cases) {
  let got: string;
  try {
    await relay("hood", { to: c.to, data: c.data }, c.name);
    got = "ok";
  } catch (e) {
    got = e instanceof RelayError ? e.code : `THREW ${(e as Error).message}`;
  }
  const pass = got === c.want;
  if (!pass) failed++;
  console.log(`${pass ? "✓" : "✗"} ${c.name}: ${got}${pass ? "" : ` (wanted ${c.want})`}`);
}
process.exit(failed ? 1 : 0);
