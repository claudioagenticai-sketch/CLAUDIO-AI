// Switch enforcement check (in-memory defaults, no database, no RPC): effective state = the stricter of the admin
// state and what the code can do; /api/launch/plan (planLaunchFor) refuses closed pads/chains with 403
// launchpad_closed + the admin note; agent launches need allow_agents; the treasury env guard.
//
//   npx tsx server/platform/switches.check.ts
delete process.env.DATABASE_URL;
delete process.env.PLATFORM_TREASURY_SOL;
delete process.env.PLATFORM_TREASURY_SOL_TESTNET;
import type { LaunchRequest } from "@shared/types";

let failures = 0;
function ok(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? "error"}: ${err.message}`;
  }
}

async function main() {
  const sw = await import("./switches");
  const { planLaunchFor } = await import("../launch/plan");
  const { platformRecipientSol } = await import("./treasury");
  const { PLATFORM_FEE_WALLET_SOL } = await import("@shared/platform");

  console.log("\ndefaults");
  const pads = await sw.launchpadRows();
  const open = pads.filter((p) => p.effective === "open").map((p) => `${p.launchpad}:${p.chain}`);
  ok(open.join() === "pump:sol", `only pump.fun on Solana is open (open: ${open.join()})`);
  ok(pads.find((p) => p.launchpad === "pump")?.allowAgents === true, "pump allows agents");
  ok(pads.find((p) => p.launchpad === "stonkfun")?.effective === "hidden", "stonkfun hidden");
  ok((await sw.chainRows()).filter((c) => c.effective === "open").map((c) => c.chain).join() === "sol", "only Solana open");

  console.log("\nstricter of admin state and code capability");
  await sw.setLaunchpadState("stonkfun", "sol", "open", true, null, "check");
  let r = (await sw.launchpadRows()).find((p) => p.launchpad === "stonkfun")!;
  ok(r.effective === "coming_soon" && !r.allowAgents && /blocked/.test(r.reason ?? ""), `blocked adapter opened by admin stays coming_soon (${r.reason})`);
  await sw.setLaunchpadState("pons", "hood", "open", false, null, "check");
  r = (await sw.launchpadRows()).find((p) => p.launchpad === "pons")!;
  ok(r.effective === "coming_soon" && /coming soon/.test(r.reason ?? ""), `built adapter on a closed chain stays coming_soon (${r.reason})`);
  await sw.setChainState("hood", "open", null, "check");
  r = (await sw.launchpadRows()).find((p) => p.launchpad === "pons")!;
  ok(r.effective === "open", "…and opens once the chain is open (admin's call)");
  await sw.setChainState("hood", "coming_soon", "Robinhood Chain launches are coming soon", "check");
  await sw.setLaunchpadState("pons", "hood", "coming_soon", false, "Coming soon", "check");
  await sw.setLaunchpadState("stonkfun", "sol", "hidden", false, null, "check");

  console.log("\nplanLaunchFor enforcement (refused before any RPC call)");
  const req: LaunchRequest = {
    chain: "sol",
    launchpad: "pump",
    name: "Check",
    symbol: "CHK",
    imageUri: "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
    metadataUri: "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
    socials: {},
    creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    devBuyNative: 0,
    slippageBps: 500,
  };
  await sw.setLaunchpadState("pump", "sol", "coming_soon", true, "Paused for an upgrade", "check");
  let c = await code(planLaunchFor(req, { launchedBy: "human" }));
  ok(c.startsWith("launchpad_closed") && c.includes("Paused for an upgrade"), `closed pad → ${c}`);
  await sw.setLaunchpadState("pump", "sol", "open", false, null, "check");
  c = await code(planLaunchFor(req, { launchedBy: "agent", agentId: "a1" }));
  ok(c.startsWith("launchpad_closed") && /Agents/.test(c), `agent launch without allow_agents → ${c}`);
  c = await code(planLaunchFor(req, { launchedBy: "human", agentId: "a1", creatorShareTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }));
  ok(c.startsWith("launchpad_closed"), "launching WITH an agent also needs allow_agents");
  await sw.setLaunchpadState("pump", "sol", "open", true, null, "check");
  await sw.setChainState("sol", "view_only", "Read-only during maintenance", "check");
  c = await code(planLaunchFor(req, { launchedBy: "human" }));
  ok(c.startsWith("launchpad_closed") && c.includes("Read-only during maintenance"), `chain view_only → ${c}`);
  await sw.setChainState("sol", "open", null, "check");
  c = await code(planLaunchFor({ ...req, chain: "hood", launchpad: "pons", creator: "0x000000000000000000000000000000000000dEaD" }, { launchedBy: "human" }));
  ok(c.startsWith("launchpad_closed"), `EVM pad (coming soon) → ${c}`);
  c = await code(planLaunchFor({ ...req, launchpad: "stonkfun" }, { launchedBy: "human" }));
  ok(c.startsWith("adapter_planned") || c.startsWith("launchpad_closed"), `hidden stonkfun → ${c}`);
  c = await code(planLaunchFor({ ...req, symbol: "c$t" }, { launchedBy: "human" }));
  ok(c.startsWith("bad_ticker"), `ticker with symbols → ${c}`);
  c = await code(planLaunchFor({ ...req, name: "x".repeat(33) }, { launchedBy: "human" }));
  ok(c.startsWith("bad_name"), "33-byte name rejected, not truncated");
  c = await code(planLaunchFor({ ...req, beneficiary: { provider: "x", handle: "alice" } } as LaunchRequest, { launchedBy: "human" }));
  ok(c.startsWith("social_unsupported_chain"), "social fee routing refused on Solana");
  c = await code(planLaunchFor(req, { launchedBy: "human", creatorShareTo: PLATFORM_FEE_WALLET_SOL }));
  ok(c.startsWith("bad_recipient"), "creator share can't be routed to the platform wallet");

  console.log("\nplatform fee wallet guard");
  ok(platformRecipientSol() === PLATFORM_FEE_WALLET_SOL, "no env → PLATFORM_FEE_WALLET_SOL");
  process.env.PLATFORM_TREASURY_SOL = PLATFORM_FEE_WALLET_SOL;
  ok(platformRecipientSol() === PLATFORM_FEE_WALLET_SOL, "env equal to the constant → fine");
  process.env.PLATFORM_TREASURY_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  c = await code(Promise.resolve().then(() => platformRecipientSol()));
  ok(c.startsWith("treasury_mismatch"), "env differs → treasury_mismatch (never uses the env value)");
  delete process.env.PLATFORM_TREASURY_SOL;
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} failure(s)` : "\nswitches: all checks passed");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
