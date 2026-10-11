// Read-only re-run of the Flap + Bags (Robinhood Chain) launch verification. Sends nothing: every call is an eth_call /
// estimateGas / eth_simulateV1 from a random address funded through a state override. Not part of the app.
//   npx tsx server/launch/flap-bags.check.ts            (HOOD_CHECK_RPC=… to use another RPC)
import { createPublicClient, decodeFunctionResult, http, parseEther, toFunctionSelector, type Address, type Hex } from "viem";
import { randomBytes } from "crypto";
import { BAGS_FACTORY_ABI, BAGS_FEE_SHARE_ABI, FLAP_PORTAL_ABI, FLAP_TAX_ABI } from "./abis";
import { BAGS_FACTORY, encodeBagsLaunch } from "./adapters/bags";
import { FLAP_PORTAL, encodeFlapLaunch, mineFlapSalt } from "./adapters/flap";

const RPC = process.env.HOOD_CHECK_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const c = createPublicClient({ transport: http(RPC, { timeout: 30_000 }) });
const rnd = (): Address => `0x${randomBytes(20).toString("hex")}` as Address;
const from = rnd();
const splitter = rnd(); // stands in for a not-yet-deployed FeeSplitter clone (launchpads don't require code there)
const platform = rnd();
const stateOverride = [{ address: from, balance: parseEther("10") }];
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function implCode(proxy: Address): Promise<string> {
  const slot = await c.getStorageAt({ address: proxy, slot: IMPL_SLOT });
  return (await c.getCode({ address: `0x${slot!.slice(26)}` as Address })) ?? "0x";
}

/** eth_call + estimateGas, then eth_simulateV1 with follow-up reads in the same simulated block. */
async function run(label: string, to: Address, data: Hex, value: bigint, abi: typeof FLAP_PORTAL_ABI, fn: string) {
  try {
    const r = await c.call({ account: from, to, data, value, stateOverride });
    const out = decodeFunctionResult({ abi, functionName: fn, data: r.data! });
    const gas = await c.estimateGas({ account: from, to, data, value, stateOverride });
    check(label, true, `returned ${JSON.stringify(out)}, gas ${gas}`);
    return out as unknown;
  } catch (e) {
    check(label, false, (e as Error).message.split("\n")[0]);
    return undefined;
  }
}

// ── Flap ────────────────────────────────────────────────────────────
{
  const code = await implCode(FLAP_PORTAL);
  const sel = toFunctionSelector(FLAP_PORTAL_ABI.find((x) => x.type === "function" && x.name === "newTokenV6") as never);
  check("Flap newTokenV6 selector in Portal impl bytecode", code.includes(sel.slice(2)), sel);
  const { salt, token } = mineFlapSalt();
  const base = { name: "Claudio Check", symbol: "FLCHK", meta: "bafkreidfqn7wgcgpxhuols3sb5wcyhk275rrk2hr4zrep3s5xhaxinl5oe", salt, beneficiary: splitter, buyTaxBps: 300, sellTaxBps: 300, taxDuration: BigInt(3_153_600_000) };
  const got = await run("Flap newTokenV6 (3% tax, no dev buy)", FLAP_PORTAL, encodeFlapLaunch({ ...base, quoteAmt: BigInt(0) }), BigInt(0), FLAP_PORTAL_ABI, "newTokenV6");
  check("Flap token address == mined CREATE2 prediction", String(got).toLowerCase() === token.toLowerCase(), token);
  const buy = parseEther("0.001");
  await run("Flap newTokenV6 (asym 1%/5%, 0.001 ETH dev buy)", FLAP_PORTAL, encodeFlapLaunch({ ...base, quoteAmt: buy, buyTaxBps: 100, sellTaxBps: 500 }), buy, FLAP_PORTAL_ABI, "newTokenV6");
  try {
    const sim = await c.simulateCalls({
      account: from,
      stateOverrides: stateOverride,
      calls: [
        { to: FLAP_PORTAL, data: encodeFlapLaunch({ ...base, quoteAmt: BigInt(0) }) },
        { to: token, abi: FLAP_TAX_ABI, functionName: "taxProcessor" },
      ],
    } as never);
    const tp = (sim.results[1] as { result?: Address }).result;
    const sim2 = await c.simulateCalls({
      account: from,
      stateOverrides: stateOverride,
      calls: [
        { to: FLAP_PORTAL, data: encodeFlapLaunch({ ...base, quoteAmt: BigInt(0) }) },
        { to: tp!, abi: FLAP_TAX_ABI, functionName: "marketAddress" },
      ],
    } as never);
    const market = (sim2.results[1] as { result?: Address }).result;
    check("Flap TaxProcessor.marketAddress == our beneficiary (eth_simulateV1)", String(market).toLowerCase() === splitter.toLowerCase(), `${tp} → ${market}`);
  } catch (e) {
    check("Flap post-launch state via eth_simulateV1", false, (e as Error).message.split("\n")[0]);
  }
}

// ── Bags ────────────────────────────────────────────────────────────
{
  const code = await implCode(BAGS_FACTORY);
  for (const fn of ["create", "createAndBuy"]) {
    const sel = toFunctionSelector(BAGS_FACTORY_ABI.find((x) => x.type === "function" && x.name === fn) as never);
    check(`Bags ${fn} selector in factory impl bytecode`, code.includes(sel.slice(2)), sel);
  }
  const fee = (await c.readContract({ address: BAGS_FACTORY, abi: BAGS_FACTORY_ABI, functionName: "creationFee" })) as bigint;
  console.log(`  Bags creationFee = ${fee} wei`);
  const base = { name: "Claudio Check", symbol: "FLCHK", metadataURI: "ipfs://bafkreie37gmyzgufdypaszghnczn7luhlbfej5qwqsbm62czt5rykcxd2i", partner: platform, claimer: splitter };
  await run("Bags create (no dev buy)", BAGS_FACTORY, encodeBagsLaunch({ ...base, devBuy: false }), fee, BAGS_FACTORY_ABI, "create");
  const buy = parseEther("0.001");
  const out = (await run("Bags createAndBuy (0.001 ETH)", BAGS_FACTORY, encodeBagsLaunch({ ...base, devBuy: true }), fee + buy, BAGS_FACTORY_ABI, "createAndBuy")) as readonly Address[] | undefined;
  if (out) {
    try {
      const sim = await c.simulateCalls({
        account: from,
        stateOverrides: stateOverride,
        calls: [
          { to: BAGS_FACTORY, data: encodeBagsLaunch({ ...base, devBuy: true }), value: fee + buy },
          { to: BAGS_FACTORY, abi: BAGS_FACTORY_ABI, functionName: "feeShareForToken", args: [out[0]] },
        ],
      } as never);
      const fs = (sim.results[1] as { result?: Address }).result!;
      const sim2 = await c.simulateCalls({
        account: from,
        stateOverrides: stateOverride,
        calls: [
          { to: BAGS_FACTORY, data: encodeBagsLaunch({ ...base, devBuy: true }), value: fee + buy },
          { to: fs, abi: BAGS_FEE_SHARE_ABI, functionName: "getClaimers" },
          { to: fs, abi: BAGS_FEE_SHARE_ABI, functionName: "owner" },
        ],
      } as never);
      const [addrs, bps] = (sim2.results[1] as { result?: readonly [readonly Address[], readonly number[]] }).result!;
      const owner = (sim2.results[2] as { result?: Address }).result;
      check(
        "Bags fee share claimers == [our splitter] / [10000] (eth_simulateV1)",
        addrs.length === 1 && addrs[0].toLowerCase() === splitter.toLowerCase() && Number(bps[0]) === 10_000,
        `feeShare ${fs}, owner (can setClaimers) ${owner}`,
      );
    } catch (e) {
      check("Bags post-launch state via eth_simulateV1", false, (e as Error).message.split("\n")[0]);
    }
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
