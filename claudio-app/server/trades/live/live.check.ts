// Live-trades checks (offline, no keys, no network):
//   npx tsx server/trades/live/live.check.ts
//  1. decoder vs real mainnet txs (fixtures/*.json — expected values derived from on-chain balance changes only)
//  2. WatchManager: ref counting, grace, caps / LRU eviction, pins never evicted
//  3. end to end with a mock PumpPortal WS + mock Alchemy WS/HTTP + the real hub: ONE PumpPortal socket, batched
//     subscribe/unsubscribe, resubscribe after reconnect, failover to Alchemy on a simulated metering error,
//     logsNotification → trades in the store → pushed to the browser socket, truncated logs → getTransaction fallback.
import { readFileSync, readdirSync } from "fs";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let passes = 0;
function ok(cond: unknown, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ok  ${msg}`);
  } else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000, step = 20): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(step);
  }
  return cond();
}

interface Fixture {
  name: string;
  signature: string;
  slot: number;
  program: "curve" | "amm";
  mint: string;
  account: string;
  expected: Record<string, string | number | null>;
  tx: import("./decode").JsonTx & { meta: { logMessages: string[] } };
}
const fixtures: Fixture[] = readdirSync(join(HERE, "fixtures"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8")) as Fixture);

// Env for part 3 must be set before the modules that read it are imported.
const ppWss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const alWss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const httpCalls: string[] = [];
const alHttp: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body) as { method: string; params: [string] };
    httpCalls.push(`${j.method}:${j.params[0]}`);
    const fx = fixtures.find((f) => f.signature === j.params[0]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: fx ? fx.tx : null }));
  });
});
await Promise.all([new Promise((r) => ppWss.once("listening", r)), new Promise((r) => alWss.once("listening", r)), new Promise<void>((r) => alHttp.listen(0, "127.0.0.1", r))]);
const port = (s: { address(): AddressInfo | string | null }) => (s.address() as AddressInfo).port;
Object.assign(process.env, {
  PUMPPORTAL_WS_URL: `ws://127.0.0.1:${port(ppWss)}/api/data`,
  PUMPPORTAL_API_KEY: "test-key",
  PUMPPORTAL_RECONNECT_MS: "150",
  ALCHEMY_SOL_WS_URL: `ws://127.0.0.1:${port(alWss)}/v2/test`,
  ALCHEMY_SOL_HTTP_URL: `http://127.0.0.1:${port(alHttp)}/v2/test`,
  ALCHEMY_TX_RPS: "50",
  LIVE_TRADES_GRACE_MS: "400",
  LIVE_TRADES_MAX: "60",
  COMING_SOON: "false",
});
delete process.env.PUMPPORTAL_WALLET_PUBLIC_KEY;

const { decodeLogs, decodeTransaction } = await import("./decode");
const { pumpAccounts } = await import("./pda");
const { WatchManager } = await import("./watch");

// ─── 1. decoder vs real chain data ──────────────────────────────────
console.log(`\n1. decoder vs ${fixtures.length} real mainnet transactions`);
const big = (v: unknown) => BigInt(String(v));
for (const f of fixtures) {
  const e = f.expected;
  const fromLogs = decodeLogs(f.tx.meta.logMessages);
  const noLogs = { ...f.tx, meta: { ...f.tx.meta, logMessages: [] } };
  const fromIx = decodeTransaction(noLogs); // self-CPI inner-instruction path only
  const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  ok(fromLogs.length > 0 && json(fromLogs) === json(fromIx), `${f.name}: logs path == inner-instruction path (${fromLogs.length} event(s))`);
  if (f.program === "curve") {
    const d = fromLogs[0];
    ok(d.program === "pump" && d.mint === f.mint, `${f.name}: TradeEvent for ${f.mint.slice(0, 6)}…`);
    ok(pumpAccounts(f.mint)?.curve === f.account, `${f.name}: bonding curve PDA == account whose balances moved`);
    ok(d.side === e.side, `${f.name}: side ${d.side}`);
    ok(d.trader === e.trader, `${f.name}: trader ${d.trader.slice(0, 6)}…`);
    ok(d.rawToken === big(e.rawToken), `${f.name}: token amount ${d.amountToken} == curve vault delta`);
    ok(d.rawLamports === big(e.rawLamports), `${f.name}: SOL amount ${d.amountSol} == curve lamport delta`);
    ok(d.priceSol === d.amountSol / d.amountToken && d.priceSol > 0, `${f.name}: price ${d.priceSol.toExponential(6)} SOL`);
    const c = d.curve!;
    ok(big(e.curveTokenVaultPost) === c.realToken + 206_900_000_000_000n, `${f.name}: post real_token_reserves match the curve's token account`);
    ok(c.vToken - c.realToken === 279_900_000_000_000n, `${f.name}: virtual − real token reserves == 279.9M`);
    if (!c.mayhem) ok(c.vSol - c.realSol === 30_000_000_000n, `${f.name}: virtual − real SOL == 30 SOL`);
    ok(Math.abs(d.spotSol - Number(c.vSol) / 1e9 / (Number(c.vToken) / 1e6)) < 1e-18, `${f.name}: spot ${d.spotSol.toExponential(6)} from post-trade reserves`);
  } else {
    ok(fromLogs.every((d) => d.program === "pump-amm" && d.pool === f.account && d.side === e.side), `${f.name}: ${fromLogs.length}× ${e.side} on pool ${f.account.slice(0, 6)}…`);
    ok(pumpAccounts(f.mint)?.pool === f.account, `${f.name}: canonical pool PDA(${f.mint.slice(0, 6)}…) == ${f.account.slice(0, 6)}…`);
    const sumBase = fromLogs.reduce((a, d) => a + d.rawToken, 0n);
    ok(sumBase === big(e.rawToken), `${f.name}: token amount(s) == pool base vault delta (${sumBase})`);
    const last = fromLogs[fromLogs.length - 1];
    ok(last.amm!.baseReserves === big(e.baseVaultPost), `${f.name}: post base reserves == base vault balance`);
    ok(last.amm!.quoteReserves - last.amm!.virtualQuote === big(e.quoteVaultPost), `${f.name}: post quote reserves == quote vault balance (+ virtual ${last.amm!.virtualQuote})`);
    const sumVault = fromLogs.reduce((a, d) => a + d.amm!.quoteVaultDelta, 0n);
    ok(sumVault === big(e.quoteVaultDelta), `${f.name}: quote vault delta ${sumVault} lamports`);
    const amountsTie = fromLogs.every((d) => d.rawLamports === (d.side === "buy" ? d.amm!.quoteVaultDelta - d.amm!.lpFee : d.amm!.quoteVaultDelta + d.amm!.lpFee));
    ok(amountsTie, `${f.name}: SOL amount = vault delta ∓ LP fee (pre-fee, same convention as the curve)`);
    if (e.trader) ok(last.trader === e.trader, `${f.name}: trader ${last.trader.slice(0, 6)}…`);
    ok(fromLogs.every((d) => d.priceSol === d.amountSol / d.amountToken), `${f.name}: price ${last.priceSol.toExponential(6)} SOL`);
    // Spot after the trade vs execution price: within the trade's own price impact (+ 2 lamports of integer rounding
    // on dust trades).
    ok(fromLogs.every((d) => d.spotSol > 0 && Math.abs(d.spotSol * d.amountToken * 1e9 - Number(d.rawLamports)) <= 0.05 * Number(d.rawLamports) + 2), `${f.name}: spot ≈ execution price`);
  }
}

// ─── 2. WatchManager ────────────────────────────────────────────────
console.log("\n2. watch manager");
{
  let changes = 0;
  const m = new WatchManager({ graceMs: 80, max: 3, onChange: () => changes++ });
  m.acquire("sol:A", "hub");
  m.acquire("sol:A", "hub");
  ok(m.active().join() === "sol:A" && changes === 1, "acquire is idempotent per holder; one change");
  m.acquire("sol:P", "pin:claudio");
  m.release("sol:A", "hub");
  ok(m.has("sol:A"), "released token stays live during grace");
  await sleep(40);
  m.acquire("sol:A", "hub");
  await sleep(80);
  ok(m.has("sol:A"), "re-acquire inside grace cancels the unwatch");
  m.release("sol:A", "hub");
  await sleep(130);
  ok(!m.has("sol:A"), "dropped after grace");
  m.acquire("sol:B", "hub");
  await sleep(2);
  m.acquire("sol:C", "hub");
  await sleep(2);
  m.release("sol:B", "hub"); // B in grace
  m.acquire("sol:D", "hub");
  ok(m.active().sort().join() === "sol:C,sol:D,sol:P", `over cap: grace token evicted first (${m.active().sort().join()})`);
  await sleep(2);
  m.acquire("sol:E", "hub");
  ok(m.active().sort().join() === "sol:D,sol:E,sol:P", `then least-recently-viewed (${m.active().sort().join()})`);
  m.acquire("sol:Q", "pin:launch");
  m.acquire("sol:R", "pin:launch");
  ok(m.isPinned("sol:P") && m.isPinned("sol:Q") && m.isPinned("sol:R") && m.has("sol:E") === false, "pins are never evicted");
  m.release("sol:Q", "pin:launch");
  await sleep(130);
  ok(!m.has("sol:Q") && m.has("sol:P"), "unpinned → grace → dropped; other pins stay");
  m.clear();
}

// ─── 3. end to end with mocks ───────────────────────────────────────
console.log("\n3. PumpPortal + Alchemy mocks through the real hub/store");
interface PPConn {
  url: string;
  msgs: { method: string; keys?: string[] }[];
  ws: WebSocket;
  open: boolean;
}
const ppConns: PPConn[] = [];
let ppConcurrent = 0;
let ppMaxConcurrent = 0;
ppWss.on("connection", (ws, req) => {
  const c: PPConn = { url: req.url ?? "", msgs: [], ws, open: true };
  ppConns.push(c);
  ppConcurrent++;
  ppMaxConcurrent = Math.max(ppMaxConcurrent, ppConcurrent);
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    if (m.method === "subscribeNewToken") ws.send(JSON.stringify({ message: "Successfully subscribed to token creation events." }));
  });
  ws.on("close", () => {
    c.open = false;
    ppConcurrent--;
  });
});
interface AlConn {
  ws: WebSocket;
  subs: Map<number, string>;
  msgs: { method: string; params: unknown[] }[];
}
const alConns: AlConn[] = [];
let alSubId = 100;
alWss.on("connection", (ws) => {
  const c: AlConn = { ws, subs: new Map(), msgs: [] };
  alConns.push(c);
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    c.msgs.push(m);
    if (m.method === "logsSubscribe") {
      const id = alSubId++;
      c.subs.set(id, (m.params[0] as { mentions: string[] }).mentions[0]);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: id }));
    } else if (m.method === "logsUnsubscribe") ws.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: true }));
  });
});
const subIdFor = (c: AlConn, address: string) => [...c.subs].find(([, a]) => a === address)?.[0];
const notify = (c: AlConn, subscription: number, signature: string, logs: string[], slot = 1) =>
  c.ws.send(JSON.stringify({ jsonrpc: "2.0", method: "logsNotification", params: { subscription, result: { context: { slot }, value: { signature, err: null, logs } } } }));

const { tokenStore, blankToken } = await import("../../store");
const { attachHub } = await import("../../hub");
const pp = await import("../../ingest/sol/pumpportal");
const live = await import("./index");

const CURVE_MINT = "GnJy8BZrxWQ2b63DvQtUegCbNEj8TgbUFKyFjKPRpump";
const AMM_MINT = "2aW6H8km7wK1hK2kb5pWGYpg9itjamQsbrgYKURMCdQZ";
const OTHER = ["5ytMXn7Bt4KgW1SDpJyG8oiqFJzy8Un2MYCEWdMRpump", "dLRWdoiVnakkqf8MzoAToDo5NLaPnxcgUtZZUbbpump"];
const reg = (mint: string, phase: "new" | "migrated") =>
  tokenStore.register(
    blankToken({ chain: "sol", address: mint, launchpad: "pump", name: mint.slice(0, 4), symbol: mint.slice(0, 3), creator: "", createdAt: Date.now() - 600_000, phase, bondingPct: phase === "migrated" ? 100 : 40, quoteSymbol: "SOL" }),
    { supply: 1e9 },
  );
reg(CURVE_MINT, "new");
reg(AMM_MINT, "migrated");
for (const m of OTHER) reg(m, "new");

const httpServer = createServer();
attachHub(httpServer);
await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
pp.startPumpPortal();
live.startLiveTrades();

ok(await until(() => ppConns.length === 1 && ppConns[0].msgs.length >= 2), "one PumpPortal connection opened");
ok(ppConns[0].url.includes("api-key=test-key"), "keyed connection (PUMPPORTAL_API_KEY set)");
ok(ppConns[0].msgs[0]?.method === "subscribeNewToken" && ppConns[0].msgs[1]?.method === "subscribeMigration", "free streams subscribed");

// New-token stream still works (free): a create event registers the coin.
const NEW_MINT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
ppConns[0].ws.send(JSON.stringify({ signature: "sigCreate", mint: NEW_MINT, traderPublicKey: "Dev1111111111111111111111111111111111111111", txType: "create", initialBuy: 1000, solAmount: 0.03, bondingCurveKey: "Curve11111111111111111111111111111111111111", vTokensInBondingCurve: 1_072_000_000, vSolInBondingCurve: 30.03, marketCapSol: 28, name: "New", symbol: "NEW", pool: "pump" }));
ok(await until(() => tokenStore.has(`sol:${NEW_MINT}`)), "new-token stream registers a launch (no trade subscription for it)");

// A browser opens 4 coin pages at once.
const browser = new WebSocket(`ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/ws`);
const browserTrades: { key: string; id: string }[] = [];
browser.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.t === "trades") for (const t of m.trades) browserTrades.push({ key: t.key, id: t.id });
});
await new Promise((r) => browser.once("open", r));
const keys = [CURVE_MINT, AMM_MINT, ...OTHER].map((m) => `sol:${m}`);
browser.send(JSON.stringify({ t: "sub", topics: keys.map((k) => `trades:${k}`) }));
const subMsgs = () => ppConns[ppConns.length - 1].msgs.filter((m) => m.method === "subscribeTokenTrade");
const unsubMsgs = () => ppConns[ppConns.length - 1].msgs.filter((m) => m.method === "unsubscribeTokenTrade");
ok(await until(() => subMsgs().length > 0), "coin pages → subscribeTokenTrade");
await sleep(400);
ok(subMsgs().length === 1 && subMsgs()[0].keys!.length === 4, `batched: ONE subscribe message with 4 keys (${subMsgs().length} msg)`);
ok(ppConns.length === 1, "still one socket (no per-token connections)");
ok(live.liveTradesStatus().source === "pumpportal" && live.liveTradesStatus().pumpportal.subscribed === 4, "status: source pumpportal, 4 subscribed");

// A PumpPortal trade reaches the store and the browser.
ppConns[0].ws.send(JSON.stringify({ signature: "ppSig1", mint: OTHER[0], traderPublicKey: "Trader1111111111111111111111111111111111111", txType: "buy", tokenAmount: 1000, solAmount: 0.05, vTokensInBondingCurve: 600_000_000, vSolInBondingCurve: 53, marketCapSol: 88, pool: "pump" }));
ok(await until(() => browserTrades.some((t) => t.id.startsWith("ppSig1"))), "PumpPortal trade → store → browser (trades:<key> topic)");
ok(live.liveTradesStatus().pumpportal.eventsPerMin === 1, "events/min counted");

// Close two pages → one batched unsubscribe after the grace period.
browser.send(JSON.stringify({ t: "unsub", topics: [`trades:sol:${OTHER[0]}`, `trades:sol:${OTHER[1]}`] }));
await sleep(200);
ok(unsubMsgs().length === 0, "no unsubscribe during grace");
ok(await until(() => unsubMsgs().length === 1), "one unsubscribe after grace");
ok(unsubMsgs()[0]?.keys?.sort().join() === [...OTHER].sort().join(), "…with both keys in it");

// Reconnect → the current set is resubscribed once.
ppConns[0].ws.terminate();
ok(await until(() => ppConns.length === 2 && subMsgs().length >= 1, 5000), "reconnected after the socket died");
await sleep(400);
ok(subMsgs().length === 1 && subMsgs()[0].keys!.sort().join() === [CURVE_MINT, AMM_MINT].sort().join(), "resubscribed the 2 watched keys in one message (no loop)");
ok(ppMaxConcurrent === 1, "never more than one PumpPortal socket at a time");

// Simulated metering error → PumpPortal paused, free socket reopened without the key, Alchemy takes over.
ppConns[1].ws.send(JSON.stringify({ errors: "Insufficient balance: please fund your wallet to continue receiving data" }));
ok(await until(() => unsubMsgs().length === 1), "metering error → trade keys unsubscribed");
ok(await until(() => ppConns.length === 3 && ppConns[2].msgs.length >= 2, 5000), "reconnected once more…");
ok(!ppConns[2].url.includes("api-key"), "…WITHOUT the API key (free launches + migrations keep flowing)");
ok(ppMaxConcurrent === 1, "still never more than one PumpPortal socket");
ok(await until(() => live.liveTradesStatus().source === "alchemy", 3000), "status: source alchemy");
const curveAcc = pumpAccounts(CURVE_MINT)!.curve;
const poolAcc = pumpAccounts(AMM_MINT)!.pool;
ok(await until(() => alConns.length === 1 && alConns[0].subs.size === 2), "Alchemy: one socket, 2 logsSubscribe (curve + pool)");
const subbed = [...alConns[0].subs.values()].sort().join();
ok(subbed === [curveAcc, poolAcc].sort().join(), "…on the bonding curve of the curve coin and the canonical pool of the migrated one");
ok(await until(() => live.liveTradesStatus().alchemy.subscribed === 2), "status: alchemy subscribed 2");

const al = alConns[0];
const fxCurve = fixtures.find((f) => f.name === "curve-buy")!;
const fxAmm = fixtures.find((f) => f.name === "amm-buy-exact-quote-in")!;
const fxMulti = fixtures.find((f) => f.name === "amm-multi-sell")!;
const before = tokenStore.trades(`sol:${CURVE_MINT}`, 500).length;
notify(al, subIdFor(al, curveAcc)!, fxCurve.signature, fxCurve.tx.meta.logMessages, fxCurve.slot);
notify(al, subIdFor(al, curveAcc)!, fxCurve.signature, fxCurve.tx.meta.logMessages, fxCurve.slot); // duplicate
notify(al, subIdFor(al, poolAcc)!, fxAmm.signature, fxAmm.tx.meta.logMessages, fxAmm.slot);
notify(al, subIdFor(al, poolAcc)!, fxMulti.signature, fxMulti.tx.meta.logMessages, fxMulti.slot);
ok(await until(() => tokenStore.trades(`sol:${CURVE_MINT}`, 500).length === before + 1), "curve TradeEvent from logs → 1 trade in the store (duplicate ignored)");
const tc = tokenStore.trades(`sol:${CURVE_MINT}`, 1)[0];
ok(tc.tx === fxCurve.signature && tc.side === "buy" && tc.trader === fxCurve.expected.trader && tc.block === fxCurve.slot, "…tx, side, trader, slot");
ok(tc.amountNative === 1.338359521 && tc.amountToken === 8115388.493702, "…SOL and token amounts");
const tok = tokenStore.get(`sol:${CURVE_MINT}`)!;
ok(tok.priceNative === 73532766363 / 1e9 / (437764030816991 / 1e6), `…token spot price = post-trade curve reserves (${tok.priceNative.toExponential(6)} SOL)`);
ok(Math.abs(tok.bondingPct - (1 - (437_764_030.816991 - 279_900_000) / 793_100_000) * 100) < 1e-9, `…bonding % from the curve reserves (${tok.bondingPct.toFixed(2)}%)`);
ok(await until(() => tokenStore.trades(`sol:${AMM_MINT}`, 500).length === 4), "PumpSwap BuyEvent + 3 SellEvents → 4 trades");
ok(await until(() => browserTrades.some((t) => t.id.startsWith(fxCurve.signature)) && browserTrades.some((t) => t.id.startsWith(fxMulti.signature))), "Alchemy trades pushed to the browser");

// Truncated logs → getTransaction over the Alchemy HTTP endpoint (once per signature).
const fxSell = fixtures.find((f) => f.name === "curve-sell")!;
const truncated = [`Program ${"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"} invoke [1]`, "Program log: Instruction: Sell", "Log truncated"];
notify(al, subIdFor(al, curveAcc)!, fxSell.signature, truncated, fxSell.slot);
ok(await until(() => tokenStore.trades(`sol:${CURVE_MINT}`, 500).some((t) => t.tx === fxSell.signature)), "truncated logs → getTransaction → trade decoded from the self-CPI event");
ok(httpCalls.length === 1 && httpCalls[0] === `getTransaction:${fxSell.signature}`, `exactly one HTTP getTransaction (${httpCalls.length})`);

// Unwatch everything → Alchemy unsubscribes after grace; nothing reconnects in a loop.
browser.send(JSON.stringify({ t: "unsub", topics: keys.map((k) => `trades:${k}`) }));
ok(await until(() => al.msgs.filter((m) => m.method === "logsUnsubscribe").length === 2, 3000), "closing the pages → 2 logsUnsubscribe after grace");
const st = live.liveTradesStatus();
ok(st.watching === 0 && st.alchemy.subscribed === 0, `status: watching ${st.watching}, alchemy subscribed ${st.alchemy.subscribed}`);
ok(alConns.length === 1 && ppConns.length === 3, `connections: PumpPortal ${ppConns.length} (sequential), Alchemy ${alConns.length}`);
const ppSubTotal = ppConns.reduce((n, c) => n + c.msgs.filter((m) => m.method === "subscribeTokenTrade").length, 0);
ok(ppSubTotal === 2, `subscribeTokenTrade messages over the whole run: ${ppSubTotal}`);
console.log("\nstatus:", JSON.stringify(live.liveTradesStatus()));

console.log(`\n${passes} passed, ${failures} failed`);
browser.close();
live.stopLiveTradesForTests();
pp.stopPumpPortalForTests();
process.exit(failures ? 1 : 0);
