// Cloud workspace checks (not part of the app). Needs a throwaway Postgres; OpenRouter and the Solana RPC are local
// mocks — nothing leaves the machine and no paid model is ever called.
//   DATABASE_URL=postgres://claudio:claudio@localhost:55440/c_cloud npx tsx server/hosted/workspace.check.ts
// Covers: auth (owner / non-owner / admin / flag off), offline, streaming chat, a delegated helper, tool calls
// (coin_facts refused for a non-Claudio coin, paper_trade through policy and never live, thread_post queued for
// approval then posted), skill switches, memory + files CRUD and quotas, the daily cap, the paid-model refusal.
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { createHash, randomBytes } from "crypto";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (a throwaway database)");
  process.exit(2);
}

// ─── mock OpenRouter (scripted replies, streaming when asked) + Solana RPC ───
const FREE = "mock/nemotron-3.5-lightning:free";
const PAID = "mock/paid-model";
const seenModels: string[] = [];
const seenStream: boolean[] = [];
const seenPrompts: string[] = [];
let queue: string[] = [];
const script = (...replies: string[]) => {
  queue = [...replies];
};
const mock = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/or/models") {
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          data: [
            { id: FREE, pricing: { prompt: "0", completion: "0" } },
            { id: PAID, pricing: { prompt: "0.000002", completion: "0.000004" } },
          ],
        }),
      );
    }
    if (req.url === "/or/chat/completions") {
      const j = JSON.parse(body);
      seenModels.push(j.model);
      seenStream.push(!!j.stream);
      seenPrompts.push(String(j.messages?.[0]?.content ?? ""));
      const text = queue.shift() ?? "Okay, noted.";
      if (j.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const parts = [text.slice(0, 5), text.slice(5, 17), text.slice(17)].filter(Boolean);
        for (const p of parts) res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: p } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ model: j.model, choices: [{ message: { content: text } }] }));
    }
    if (req.url === "/rpc") {
      res.setHeader("Content-Type", "application/json");
      const j = JSON.parse(body || "{}");
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: j.id, error: { message: "mock rpc" } }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.VAULT_MASTER_KEY = randomBytes(32).toString("hex");
delete process.env.HOSTED_LIVE_TRADING;
delete process.env.HOSTED_KILL;
const OR_KEY = "test-key-not-real-0000";
process.env.OPENROUTER_API_KEY = OR_KEY;
process.env.OPENROUTER_BASE_URL = `${mockUrl}/or`;
process.env.SOL_RPC_URL = `${mockUrl}/rpc`;
process.env.SOLANA_RPC_URL = `${mockUrl}/rpc`;
process.env.CLOUD_FILES_MAX = "3";
process.env.CLOUD_FILE_MAX_BYTES = "1024";
process.env.CLOUD_FILES_TOTAL_BYTES = "2000";
process.env.CLOUD_MEMORY_MAX = "12";
process.env.CLOUD_MESSAGES_PER_MIN = "500";
process.env.CLOUD_DAILY_MESSAGES = "500";
process.env.AGENT_POST_INTERVAL_SCALE = "0.001";

const { Keypair } = await import("@solana/web3.js");
const ADMIN = Keypair.generate().publicKey.toBase58();
const OWNER = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const CLDX = Keypair.generate().publicKey.toBase58();
const BONK = Keypair.generate().publicKey.toBase58();
process.env.ADMIN_WALLETS = ADMIN;
process.env.ADMIN_PASSWORD = "test-password-123";

const { pool } = await import("../db");
const { migrate } = await import("../migrate");
if (!pool) throw new Error("no pool");
await migrate();
const { seedRooms } = await import("../agents/thread");
await seedRooms();
const { registerHostedRoutes } = await import("./index");
const { tokenStore, blankToken } = await import("../store");
const { complete } = await import("../llm/openrouter");
const { normPath } = await import("./workspace/store");
const { parseToolCall, cleanReply } = await import("./workspace/turn");

// Leftovers from earlier runs.
const OLD = `SELECT id FROM agents WHERE id LIKE 'w-%'`;
for (const t of ["chat_sessions", "chat_messages", "agent_memories", "agent_files", "agent_workspace", "cloud_usage", "agent_policies", "agent_paper_trades", "agent_approvals", "agent_actions", "agent_runtime", "agent_ledger"]) {
  await pool.query(`DELETE FROM ${t} WHERE agent_id IN (${OLD})`);
}
await pool.query(`DELETE FROM messages WHERE agent_id IN (${OLD})`);
await pool.query(`DELETE FROM agents WHERE id LIKE 'w-%'`);
await pool.query(`DELETE FROM feature_flags WHERE key = 'cloud_workspace'`);
await pool.query(`DELETE FROM hosted_settings WHERE key = 'kill'`);

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, extra: unknown = ""): void {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && extra !== "" ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra).slice(0, 400)}` : ""}`);
}
const section = (s: string) => console.log(`\n── ${s}`);

const run = randomBytes(3).toString("hex");
async function mkAgent(mode: string, owner: string, model: string | null = FREE): Promise<{ id: string; slug: string }> {
  const id = `w-${run}-${randomBytes(4).toString("hex")}`;
  const slug = `w-${run}-${randomBytes(3).toString("hex")}`;
  await pool!.query(`INSERT INTO agents (id, slug, name, mode, status, persona, bio, model, owner_wallet) VALUES ($1,$2,$3,$4,'active',$5,'',$6,$7)`, [
    id,
    slug,
    `Agent ${slug.slice(-4)}`,
    mode,
    "A calm, data-first watcher of Claudio's coins.",
    model,
    owner,
  ]);
  return { id, slug };
}

const mine = await mkAgent("hosted", OWNER);
const theirs = await mkAgent("hosted", OTHER);
const ext = await mkAgent("external", OWNER);
const adminsOwn = await mkAgent("hosted", ADMIN);

tokenStore.register(blankToken({ chain: "sol", address: CLDX, launchpad: "pump", name: "Cloud Dex", symbol: "CLDX", creator: OTHER, createdAt: Date.now() - 3600_000, volume1hUsd: 9000, launchedHere: true, holders: 120 }));
tokenStore.updateMarket(`sol:${CLDX}`, { spotPriceNative: 3e-8 });
tokenStore.register(blankToken({ chain: "sol", address: BONK, launchpad: "pump", name: "Bonk Copy", symbol: "BONKX", creator: OTHER, createdAt: Date.now() - 7200_000, volume1hUsd: 50000, launchedHere: false }));
tokenStore.updateMarket(`sol:${BONK}`, { spotPriceNative: 2e-8 });

const express = (await import("express")).default;
const app = express();
app.use(express.json({ limit: "6mb" }));
registerHostedRoutes(app);
const srv = app.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

async function session(wallet: string, admin = false): Promise<string> {
  const token = randomBytes(32).toString("hex");
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

async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers }> {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: r.status, json, headers: r.headers };
}

interface Sse {
  status: number;
  events: { type: string; [k: string]: any }[];
  json?: any;
}
async function send(slug: string, chatId: string, content: string, cookie = cOwner): Promise<Sse> {
  const r = await fetch(`${base}/api/cloud/agents/${slug}/chats/${chatId}/messages`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ content }) });
  const text = await r.text();
  if (!(r.headers.get("content-type") ?? "").includes("text/event-stream")) return { status: r.status, events: [], json: JSON.parse(text) };
  const events = text
    .split("\n\n")
    .map((b) => b.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => !!l)
    .map((l) => JSON.parse(l.slice(6)));
  return { status: r.status, events };
}
const msgs = (s: Sse, role?: string) => s.events.filter((e) => e.type === "message" && (!role || e.message.role === role)).map((e) => e.message);

// ═════════════════════════════════════════════════════════════════════
section("pure helpers");
check("path: /notes/plan.md ok", normPath("/notes/plan.md") === "/notes/plan.md");
check("path: traversal refused", normPath("/../etc/passwd.txt") === null && normPath("notes/../../x.md") === null);
check("path: html refused", normPath("/index.html") === null && normPath("/x.svg") === null);
check("path: hidden + deep refused", normPath("/.env.txt") === null && normPath("/a/b/c/d/e/f/g.md") === null);
check("tool call parsed through fences", parseToolCall('```json\n{"tool":"coin_facts","args":{"symbol":"CLDX"}}\n```')?.name === "coin_facts");
check("plain text is not a tool call", parseToolCall("CLDX looks steady today.") === null);
check("reply cleaned: links removed", !/https?:/.test(cleanReply("see https://evil.example.com/x now")));

section("auth + the platform switch");
check("access: anonymous → closed", (await call("GET", "/api/cloud/access")).json.allowed === false);
check("agents: no session → 401", (await call("GET", "/api/cloud/agents")).status === 401);
const closed = await call("GET", "/api/cloud/agents", cOwner);
check("flag off: owner → 403 cloud_closed", closed.status === 403 && closed.json.error === "cloud_closed", closed.json);
check("flag off: owner workspace → 403", (await call("GET", `/api/cloud/agents/${mine.slug}`, cOwner)).status === 403);
const adm = await call("GET", `/api/cloud/agents/${adminsOwn.slug}`, cAdmin);
check("flag off: admin can use their own agent", adm.status === 200 && adm.json.role === "owner" && adm.json.access.allowed === true, adm.json);
check("access: admin allowed while off", (await call("GET", "/api/cloud/access", cAdmin)).json.allowed === true);
check("admin switch: owner → 403", (await call("PUT", "/api/admin/cloud", cOwner, { enabled: true })).status === 403);
const on = await call("PUT", "/api/admin/cloud", cAdmin, { enabled: true });
check("admin switch: admin turns it on", on.status === 200 && on.json.enabled === true, on.json);
check("access: owner allowed once on", (await call("GET", "/api/cloud/access", cOwner)).json.allowed === true);
const list = await call("GET", "/api/cloud/agents", cOwner);
check("my agents: only my hosted agents", list.status === 200 && list.json.agents.some((a: any) => a.slug === mine.slug) && !list.json.agents.some((a: any) => a.slug === ext.slug || a.slug === theirs.slug), list.json);
check("non-owner → 403", (await call("GET", `/api/cloud/agents/${mine.slug}`, cOther)).status === 403);
const asAdmin = await call("GET", `/api/cloud/agents/${mine.slug}`, cAdmin);
check("admin may read an owner's workspace", asAdmin.status === 200 && asAdmin.json.role === "admin");
check("admin can't create chats for an owner", (await call("POST", `/api/cloud/agents/${mine.slug}/chats`, cAdmin, {})).status === 403);
check("admin can't write an owner's files", (await call("PUT", `/api/cloud/agents/${mine.slug}/files`, cAdmin, { path: "/x.md", content: "x" })).status === 403);
check("external agent → 409 not_hosted", (await call("GET", `/api/cloud/agents/${ext.slug}`, cOwner)).status === 409);
check("unknown agent → 404", (await call("GET", `/api/cloud/agents/nope-${run}`, cOwner)).status === 404);

section("chat: offline without a key");
const chat = (await call("POST", `/api/cloud/agents/${mine.slug}/chats`, cOwner, {})).json.chat;
check("chat created", !!chat?.id && /^chat_/.test(chat.id), chat);
delete process.env.OPENROUTER_API_KEY;
const off = await send(mine.slug, chat.id, "hello?");
check("no key → 503 llm_offline (JSON, not a stream)", off.status === 503 && off.json?.error === "llm_offline", off);
check("offline message not counted", (await call("GET", "/api/cloud/access", cOwner)).json.usedToday === 0);
process.env.OPENROUTER_API_KEY = OR_KEY;

section("chat: streaming reply");
script("Hello! Claudio's board is quiet this hour, and $CLDX is the coin to watch.");
let n0 = seenModels.length;
const s1 = await send(mine.slug, chat.id, "Hi, how is it going?");
const deltas = s1.events.filter((e) => e.type === "delta").map((e) => e.text).join("");
const reply1 = msgs(s1, "agent")[0];
check("SSE: start → deltas → agent message → done", s1.events[0]?.type === "start" && s1.events.at(-1)?.type === "done" && !!reply1, s1.events.map((e) => e.type));
check("streamed in pieces", s1.events.filter((e) => e.type === "delta").length >= 2 && deltas.startsWith("Hello!"), deltas);
check("reply stored with the model", reply1?.model === FREE && reply1.content.includes("$CLDX"), reply1);
check("upstream asked to stream, free model only", seenStream[n0] === true && seenModels.slice(n0).every((m) => m === FREE));
check("system prompt keeps the Claudio-only rule", /Only talk about \$CLAUDIO and coins launched on Claudio/.test(seenPrompts[n0] ?? ""));
check("done carries today's count", s1.events.at(-1)?.usedToday === 1, s1.events.at(-1));
const detail = await call("GET", `/api/cloud/agents/${mine.slug}/chats/${chat.id}`, cOwner);
check("chat detail: user + agent messages, titled", detail.status === 200 && detail.json.messages.length === 2 && detail.json.session.title.startsWith("Hi, how"), detail.json);

section("chat: a delegated helper");
script(
  '{"tool":"delegate","args":{"role":"market","task":"How is $CLDX doing this hour?"}}',
  '{"tool":"coin_facts","args":{"symbol":"CLDX"}}',
  "CLDX has 120 holders and steady volume; nothing unusual.",
  "The market helper says $CLDX is steady: 120 holders, normal volume.",
);
const s2 = await send(mine.slug, chat.id, "Ask the market helper about CLDX");
const helperMsg = msgs(s2, "helper")[0];
check("helper_start event for market", s2.events.some((e) => e.type === "helper_start" && e.role === "market"), s2.events.map((e) => e.type));
check("helper answer stored with its role", helperMsg?.helper === "market" && helperMsg.content.includes("120 holders"), helperMsg);
check("helper used coin_facts (allowed for market)", helperMsg?.meta?.tools?.[0]?.name === "coin_facts" && helperMsg.meta.tools[0].ok === true, helperMsg?.meta);
const final2 = msgs(s2, "agent")[0];
check("final reply notes which helper answered", final2?.meta?.helpers?.includes("market") && final2.content.includes("steady"), final2);

section("tools: Claudio coins only");
script('{"tool":"coin_facts","args":{"symbol":"BONKX"}}', "I only look at Claudio coins, so I skipped that one.");
const s3 = await send(mine.slug, chat.id, "What about BONKX?");
const t3 = msgs(s3, "tool")[0];
check("coin_facts on a non-Claudio coin → refused", t3?.meta?.name === "coin_facts" && t3.meta.ok === false && t3.meta.code === "not_claudio_coin", t3);
check("tool event streamed before the result", s3.events.some((e) => e.type === "tool" && e.name === "coin_facts"));
script(`{"tool":"coin_facts","args":{"mint":"${BONK}"}}`, "Skipped.");
const s3b = await send(mine.slug, chat.id, "Look up this mint");
check("…also refused by mint", msgs(s3b, "tool")[0]?.meta?.code === "not_claudio_coin");
script('{"tool":"claudio_coins","args":{"sort":"volume"}}', "Here are Claudio's coins.");
const s3c = await send(mine.slug, chat.id, "List Claudio coins");
const t3c = msgs(s3c, "tool")[0];
check("claudio_coins lists only Claudio coins", t3c?.meta?.ok === true && /CLDX/.test(t3c.content) && !/BONKX/.test(t3c.content), t3c);
script('{"tool":"shell","args":{"cmd":"ls /"}}', "No shell here.");
const s3d = await send(mine.slug, chat.id, "run ls");
check("unknown tool (shell) → refused", msgs(s3d, "tool")[0]?.meta?.code === "unknown_tool");
script('{"tool":"coin_facts","args":{"symbol":"CLDX","extra":1}}', "ok");
check("extra arguments → bad_args", msgs(await send(mine.slug, chat.id, "facts"), "tool")[0]?.meta?.code === "bad_args");

section("tools: paper_trade through the policy");
script('{"tool":"paper_trade","args":{"side":"buy","symbol":"CLDX","amountSol":0.1,"reason":"test"}}', "Trading is off for me.");
check("default policy (trading off) → refused", msgs(await send(mine.slug, chat.id, "buy 0.1 CLDX"), "tool")[0]?.meta?.code === "trading_disabled");
const pol = await call("PUT", `/api/agents/${mine.slug}/policy`, cOwner, { canTrade: true, maxSolPerTrade: 0.5, maxSolPerDay: 2, askOwnerAboveSol: 0.2 });
check("owner turns trading on", pol.status === 200 && pol.json.policy.canTrade === true, pol.json);
script('{"tool":"paper_trade","args":{"side":"buy","symbol":"CLDX","amountSol":0.1,"reason":"test"}}', "Done, a small paper buy.");
const s4 = await send(mine.slug, chat.id, "paper buy 0.1 CLDX");
const t4 = msgs(s4, "tool")[0];
const fills = await pool.query(`SELECT count(*)::int AS n FROM agent_paper_trades WHERE agent_id = $1`, [mine.id]);
check("small paper buy fills", t4?.meta?.ok === true && fills.rows[0].n === 1, t4);
script('{"tool":"paper_trade","args":{"side":"buy","symbol":"CLDX","amountSol":0.3,"reason":"bigger"}}', "That one needs your approval.");
const s5 = await send(mine.slug, chat.id, "paper buy 0.3 CLDX");
const ap5 = msgs(s5, "approval")[0];
check("above ask-me → approval card", ap5?.meta?.approvalKind === "pump_buy" && /^apr_/.test(ap5.meta.approvalId ?? ""), ap5);
script(`{"tool":"paper_trade","args":{"side":"buy","mint":"${BONK}","amountSol":0.1}}`, "Not that one.");
check("paper_trade on a non-Claudio coin → refused", msgs(await send(mine.slug, chat.id, "buy bonk"), "tool")[0]?.meta?.code === "not_claudio_coin");
process.env.HOSTED_LIVE_TRADING = "true";
await call("PUT", `/api/agents/${mine.slug}/policy`, cOwner, { paper: false });
script('{"tool":"paper_trade","args":{"side":"buy","symbol":"CLDX","amountSol":0.1,"reason":"live on"}}', "Paper only from chat.");
const s6 = await send(mine.slug, chat.id, "buy while live is on");
const fills2 = await pool.query(`SELECT count(*)::int AS n FROM agent_paper_trades WHERE agent_id = $1`, [mine.id]);
const live = await pool.query(`SELECT count(*)::int AS n FROM agent_actions WHERE agent_id = $1 AND kind = 'live_trade'`, [mine.id]);
check("live trading on + policy live → chat trade is still paper", msgs(s6, "tool")[0]?.meta?.ok === true && fills2.rows[0].n === 2 && live.rows[0].n === 0, msgs(s6, "tool")[0]);
const apr = await call("POST", `/api/agents/${mine.slug}/approvals/${ap5.meta.approvalId}`, cOwner, { approve: true });
check("approving a chat trade while live is on → paper fill", apr.status === 200 && apr.json.outcome?.ok === true && apr.json.outcome?.mode === "paper", apr.json);
delete process.env.HOSTED_LIVE_TRADING;
await call("PUT", `/api/agents/${mine.slug}/policy`, cOwner, { paper: true });

section("tools: thread_post waits for the owner");
const postText = `Holders on $CLDX keep climbing on Claudio this hour ${run}.`;
script(`{"tool":"thread_post","args":{"room":"general","content":"${postText}"}}`, "I drafted a post; it's waiting for you.");
const s7 = await send(mine.slug, chat.id, "post an update in general");
const ap7 = msgs(s7, "approval")[0];
check("thread_post → approval card", ap7?.meta?.approvalKind === "thread_post" && /^apr_/.test(ap7.meta.approvalId ?? ""), ap7);
const notYet = await pool.query(`SELECT count(*)::int AS n FROM messages WHERE agent_id = $1`, [mine.id]);
check("nothing posted before approval", notYet.rows[0].n === 0);
const logs = await call("GET", `/api/agents/${mine.slug}/logs`, cOwner);
const pend = logs.json.approvals.find((a: any) => a.id === ap7?.meta?.approvalId);
check("approval listed with a plain summary", pend?.kind === "thread_post" && pend.summary?.startsWith("Post in #general"), pend);
check("non-owner can't approve the post", (await call("POST", `/api/agents/${mine.slug}/approvals/${ap7.meta.approvalId}`, cOther, { approve: true })).status === 403);
const ok7 = await call("POST", `/api/agents/${mine.slug}/approvals/${ap7.meta.approvalId}`, cOwner, { approve: true });
const posted = await pool.query(`SELECT content FROM messages WHERE agent_id = $1`, [mine.id]);
check("owner approves → posted through postAsAgent", ok7.status === 200 && ok7.json.outcome?.ok === true && posted.rows.length === 1 && posted.rows[0].content.includes("$CLDX"), ok7.json);
check("approval can't post twice", (await call("POST", `/api/agents/${mine.slug}/approvals/${ap7.meta.approvalId}`, cOwner, { approve: true })).status === 409);
const d7 = await call("GET", `/api/cloud/agents/${mine.slug}/chats/${chat.id}`, cOwner);
check("chat detail shows the live approval status", d7.json.approvals?.[ap7.meta.approvalId] === "executed", d7.json.approvals);
script('{"tool":"thread_post","args":{"room":"secret-room","content":"hi"}}', "Can't post there.");
check("thread_post outside allowed rooms → refused", msgs(await send(mine.slug, chat.id, "post in secret"), "tool")[0]?.meta?.code === "room_not_allowed");

section("skills + helper switches");
check("settings: non-owner → 403", (await call("PUT", `/api/cloud/agents/${mine.slug}/settings`, cOther, { skills: { coin_facts: false } })).status === 403);
check("settings: unknown skill → 400", (await call("PUT", `/api/cloud/agents/${mine.slug}/settings`, cOwner, { skills: { shell: true } })).status === 400);
const st = await call("PUT", `/api/cloud/agents/${mine.slug}/settings`, cOwner, { skills: { coin_facts: false }, helpers: { security: false } });
check("settings saved", st.status === 200 && st.json.settings.skills.coin_facts === false && st.json.settings.helpers.security === false, st.json);
script('{"tool":"coin_facts","args":{"symbol":"CLDX"}}', "That tool is off.");
n0 = seenPrompts.length;
const s8 = await send(mine.slug, chat.id, "facts on CLDX");
check("switched-off skill → refused by the dispatcher", msgs(s8, "tool")[0]?.meta?.code === "skill_off");
check("switched-off skill left out of the prompt", !seenPrompts[n0]?.includes("- coin_facts"));
script('{"tool":"delegate","args":{"role":"security","task":"check CLDX"}}', "The security helper is off.");
const s9 = await send(mine.slug, chat.id, "security check");
check("switched-off helper → no helper runs", msgs(s9, "helper").length === 0 && !!msgs(s9, "agent")[0]);
const sk = await call("GET", `/api/cloud/agents/${mine.slug}/skills`, cOwner);
check("skills list with plain labels", sk.status === 200 && sk.json.skills.find((x: any) => x.name === "coin_facts")?.enabled === false && sk.json.skills.every((x: any) => x.label));
await call("PUT", `/api/cloud/agents/${mine.slug}/settings`, cOwner, { skills: { coin_facts: true }, helpers: { security: true } });
const hp = await call("GET", `/api/cloud/agents/${mine.slug}/helpers`, cOwner);
check("helpers: market used once", hp.status === 200 && hp.json.helpers.find((x: any) => x.role === "market")?.uses === 1, hp.json);

section("memory");
script('{"tool":"memory_save","args":{"text":"Owner prefers short answers about CLDX.","pin":true}}', "Noted.");
check("memory_save tool", msgs(await send(mine.slug, chat.id, "remember I like short answers"), "tool")[0]?.meta?.ok === true);
const m1 = await call("POST", `/api/cloud/agents/${mine.slug}/memory`, cOwner, { content: "Check $CLAUDIO holders every morning." });
check("owner adds a memory", m1.status === 201 && m1.json.item.kind === "owner", m1.json);
check("non-owner can't add memory", (await call("POST", `/api/cloud/agents/${mine.slug}/memory`, cOther, { content: "x y z" })).status === 403);
const ms = await call("GET", `/api/cloud/agents/${mine.slug}/memory?q=short answers`, cOwner);
check("memory search finds it", ms.status === 200 && ms.json.items[0]?.content.includes("short answers"), ms.json);
const pin = await call("PATCH", `/api/cloud/agents/${mine.slug}/memory/${m1.json.item.id}`, cOwner, { pinned: true });
check("pin a memory", pin.status === 200 && pin.json.item.pinned === true);
for (let i = 0; i < 15; i++) await call("POST", `/api/cloud/agents/${mine.slug}/memory`, cOwner, { content: `filler note number ${i} ${run}` });
const all = await call("GET", `/api/cloud/agents/${mine.slug}/memory`, cOwner);
check("memory quota: capped, pinned kept", all.json.items.length <= 12 && all.json.items.some((m: any) => m.id === m1.json.item.id), all.json.items.length);
check("memory: delete", (await call("DELETE", `/api/cloud/agents/${mine.slug}/memory/${m1.json.item.id}`, cOwner)).status === 200);
check("memory: delete again → 404", (await call("DELETE", `/api/cloud/agents/${mine.slug}/memory/${m1.json.item.id}`, cOwner)).status === 404);
await pool.query(`INSERT INTO agent_runtime (agent_id, memory) VALUES ($1, 'runner note') ON CONFLICT (agent_id) DO UPDATE SET memory = 'runner note'`, [mine.id]);
check("rolling summary shown", (await call("GET", `/api/cloud/agents/${mine.slug}/memory`, cOwner)).json.summary === "runner note");
check("rolling summary cleared", (await call("DELETE", `/api/cloud/agents/${mine.slug}/memory/summary`, cOwner)).status === 200 && (await call("GET", `/api/cloud/agents/${mine.slug}/memory`, cOwner)).json.summary === "");

section("files");
const P = `/api/cloud/agents/${mine.slug}/files`;
check("bad path → 400", (await call("PUT", P, cOwner, { path: "/../../etc/passwd", content: "x" })).status === 400);
check("html file → 400", (await call("PUT", P, cOwner, { path: "/page.html", content: "<script>alert(1)</script>" })).status === 400);
check("binary content → 400", (await call("PUT", P, cOwner, { path: "/bin.txt", content: "a\u0000b" })).status === 400);
check("too big → 413", (await call("PUT", P, cOwner, { path: "/big.txt", content: "x".repeat(2000) })).status === 413);
const w1 = await call("PUT", P, cOwner, { path: "/notes/plan.md", content: "# Plan\nWatch CLDX." });
check("write a file", w1.status === 200 && w1.json.file.path === "/notes/plan.md" && w1.json.file.size > 0, w1.json);
const r1 = await call("GET", `${P}/content?path=/notes/plan.md`, cOwner);
check("read it back as JSON (nosniff, never HTML)", r1.status === 200 && r1.json.file.content.includes("Watch CLDX") && r1.headers.get("x-content-type-options") === "nosniff" && (r1.headers.get("content-type") ?? "").includes("application/json"));
check("non-owner can't read files", (await call("GET", `${P}/content?path=/notes/plan.md`, cOther)).status === 403);
script('{"tool":"files_write","args":{"path":"/notes/agent.md","content":"written by the agent"}}', "Saved.");
check("files_write tool", msgs(await send(mine.slug, chat.id, "save a note file"), "tool")[0]?.meta?.ok === true);
check("third file ok", (await call("PUT", P, cOwner, { path: "/c.txt", content: "c".repeat(900) })).status === 200);
const fourth = await call("PUT", P, cOwner, { path: "/d.txt", content: "d" });
check("file count quota → 413 too_many_files", fourth.status === 413 && fourth.json.error === "too_many_files", fourth.json);
const full = await call("PUT", P, cOwner, { path: "/c.txt", content: "c".repeat(1024) });
const full2 = await call("PUT", P, cOwner, { path: "/notes/plan.md", content: "p".repeat(1000) });
check("total quota → 413 workspace_full", full.status === 200 && full2.status === 413 && full2.json.error === "workspace_full", [full.status, full2.json]);
const fl = await call("GET", P, cOwner);
check("list files + quota", fl.status === 200 && fl.json.files.length === 3 && fl.json.quota.maxFiles === 3, fl.json);
check("delete file", (await call("DELETE", `${P}?path=/c.txt`, cOwner)).status === 200 && (await call("GET", P, cOwner)).json.files.length === 2);

section("daily cap + paid models");
const used = (await call("GET", "/api/cloud/access", cOwner)).json.usedToday;
process.env.CLOUD_DAILY_MESSAGES = String(used + 1);
script("Last one for today.");
check("message under the cap streams", (await send(mine.slug, chat.id, "one more")).status === 200);
const capped = await send(mine.slug, chat.id, "and another");
check("over the cap → 429 daily_cap", capped.status === 429 && capped.json?.error === "daily_cap", capped);
const mine2 = await mkAgent("hosted", OWNER);
const chat2 = (await call("POST", `/api/cloud/agents/${mine2.slug}/chats`, cOwner, {})).json.chat;
check("cap counts per owner across agents", (await send(mine2.slug, chat2.id, "hello other agent")).status === 429);
process.env.CLOUD_DAILY_MESSAGES = "500";
await pool.query(`UPDATE agents SET model = $2 WHERE id = $1`, [mine.id, PAID]);
script("Still on a free model.");
n0 = seenModels.length;
const s10 = await send(mine.slug, chat.id, "which model?");
check("agent set to a paid model → only free models called", s10.status === 200 && seenModels.length > n0 && !seenModels.slice(n0).includes(PAID), seenModels.slice(n0));
n0 = seenModels.length;
await complete([{ role: "user", content: "hi" }], { models: [PAID] }).catch(() => null);
check("complete() refuses a paid model in-process", !seenModels.slice(n0).includes(PAID) && !seenModels.includes(PAID), seenModels.slice(n0));
await pool.query(`UPDATE agents SET model = $2 WHERE id = $1`, [mine.id, FREE]);

section("activity + usage");
const act = await call("GET", `/api/cloud/agents/${mine.slug}/activity`, cOwner);
const kinds = new Set((act.json.items ?? []).map((x: any) => x.kind));
check("activity: tools, helper, chat, paper trades, approvals, post", ["tool", "helper", "chat", "paper_trade", "approval", "post"].every((k) => kinds.has(k)), [...kinds]);
const us = await call("GET", `/api/cloud/agents/${mine.slug}/usage`, cOwner);
const today = us.json.days?.at(-1);
check("usage: today's messages, model and tool calls", us.status === 200 && today?.messages > 5 && today.modelCalls > today.messages && today.toolCalls > 5 && today.paperTrades >= 2 && today.posts === 1, today);
check("non-owner can't read activity", (await call("GET", `/api/cloud/agents/${mine.slug}/activity`, cOther)).status === 403);

section("chats + switch off again");
const c2 = (await call("POST", `/api/cloud/agents/${mine.slug}/chats`, cOwner, { title: "Second" })).json.chat;
check("rename chat", (await call("PATCH", `/api/cloud/agents/${mine.slug}/chats/${c2.id}`, cOwner, { title: "Renamed" })).json.chat?.title === "Renamed");
check("delete chat", (await call("DELETE", `/api/cloud/agents/${mine.slug}/chats/${c2.id}`, cOwner)).status === 200);
check("deleted chat → 404", (await call("GET", `/api/cloud/agents/${mine.slug}/chats/${c2.id}`, cOwner)).status === 404);
check("other agent's chat id → 404", (await call("GET", `/api/cloud/agents/${adminsOwn.slug}/chats/${chat.id}`, cAdmin)).status === 404);
const offAgain = await call("PUT", "/api/admin/cloud", cAdmin, { enabled: false });
check("admin turns it off", offAgain.json.enabled === false);
check("owner closed out again", (await call("GET", `/api/cloud/agents/${mine.slug}`, cOwner)).status === 403);
const audits = await pool.query(`SELECT action FROM audit_events WHERE action LIKE 'cloud.%' AND created_at > now() - interval '10 minutes'`);
const acts = new Set(audits.rows.map((r) => r.action));
check("mutations audited", ["cloud.workspace_on", "cloud.workspace_off", "cloud.admin_read", "cloud.chat_message", "cloud.file_write", "cloud.memory_add", "cloud.settings_update", "cloud.denied"].every((a) => acts.has(a)), [...acts]);

srv.close();
mock.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
