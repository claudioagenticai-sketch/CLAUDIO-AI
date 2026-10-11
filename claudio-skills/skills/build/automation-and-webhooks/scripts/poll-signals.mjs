#!/usr/bin/env node
// poll-signals.mjs — cron-friendly poller for Claudio's market feeds (signals, KOL or smart-money trades). Keeps a small
// state file so each run emits only NEW items, as JSON lines on stdout, and can forward them to the person's own webhook.
// Research alerts only: it never posts publicly, signs, trades or spends. Not financial advice.
//
// Setup:  npm i @useclaudio/sdk              (Node >= 20)
// Usage:  node poll-signals.mjs [--feed signals|kol|smart] [--kinds smart_buy,kol_buy,ath] [--side buy] [--min-usd 500]
//                               [--state ./.claudio-poll.json] [--webhook <url>] [--send] [--max 20] [--json-only]
//   Without --send, a --webhook is only previewed (the URL's query string is redacted). Add --send to POST for real.
//
// Network: 1 public GET to useclaudio.xyz per run (/api/insights/feed/<feed>); with --send, 1 POST per new item to your
//          webhook (max --max per run, default 20). Run it at most every 2 minutes; feeds are cached server-side ~30 s.
// Webhook body: { "source": "claudio-poll", "feed", "text", "data", "at" } — same shape as `claudio watch --notify webhook`
//          but with source "claudio-poll", so one receiver handles both.
// Exit codes: 0 ok (even with nothing new) · 1 API/network/webhook error · 2 bad usage · 5 rate limited.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { ClaudioApiError, ClaudioClient } from "@useclaudio/sdk";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
if (argv.includes("--help")) {
  console.log("Usage: node poll-signals.mjs [--feed signals|kol|smart] [--kinds a,b] [--side buy|sell] [--min-usd n] [--state file] [--webhook url] [--send] [--max 20] [--json-only]");
  process.exit(0);
}
const feed = flag("--feed", "signals");
if (!["signals", "kol", "smart"].includes(feed)) { console.error("--feed must be signals, kol or smart"); process.exit(2); }
const kinds = (flag("--kinds", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const side = flag("--side");
const minUsd = Number(flag("--min-usd", 0)) || 0;
const statePath = flag("--state", "./.claudio-poll.json");
const webhook = flag("--webhook");
const send = argv.includes("--send");
const max = Math.max(1, Math.min(50, Number(flag("--max", 20)) || 20));
const quiet = argv.includes("--json-only");
const log = (...a) => { if (!quiet) console.error(...a); };

let state = { seen: [] };
try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* first run */ }
const seen = new Set(state.seen ?? []);

const claudio = new ClaudioClient();
const idOf = (x) => (feed === "signals" ? `${x.kind}:${x.tokenKey}:${x.at}` : `${x.tx ?? ""}:${x.wallet?.address}:${x.at}`);
const usd = (n) => (typeof n === "number" ? `$${n >= 1000 ? (n / 1000).toFixed(1) + "K" : n.toFixed(0)}` : "?");
const textOf = (x) => feed === "signals"
  ? `${x.label}: $${x.symbol ?? "?"} ${x.detail ?? ""}`.trim()
  : `${x.wallet?.name ?? x.wallet?.address?.slice(0, 4) + "…"} ${x.side === "buy" ? "bought" : "sold"} ${usd(x.amountUsd)} of $${x.symbol ?? "?"} [${(x.wallet?.tags ?? []).join(", ")}]`;

let res;
try {
  res = feed === "signals" ? await claudio.feeds.signals() : feed === "kol" ? await claudio.feeds.kol(side ? { side } : {}) : await claudio.feeds.smart(side ? { side } : {});
} catch (e) {
  if (e instanceof ClaudioApiError && e.rateLimited) { log(`rate limited; retry after ${e.retryAfter ?? 60}s`); process.exit(5); }
  log(`feed failed: ${e.message}`);
  process.exit(1);
}

const fresh = (res.data ?? [])
  .filter((x) => !seen.has(idOf(x)))
  .filter((x) => (feed === "signals" ? !kinds.length || kinds.includes(x.kind) : true))
  .filter((x) => (feed !== "signals" ? (x.amountUsd ?? 0) >= minUsd : true))
  .sort((a, b) => a.at - b.at)
  .slice(-max);

let failed = 0;
for (const x of fresh) {
  const line = { source: "claudio-poll", feed, text: textOf(x), data: x, at: new Date().toISOString() };
  console.log(JSON.stringify(line));
  if (webhook) {
    if (!send) log(`[preview] POST ${webhook.replace(/\?.*/, "?***")} ${line.text}`);
    else {
      try {
        const r = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json", "user-agent": "claudio-poll" }, body: JSON.stringify(line), signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) { failed++; log(`webhook failed: ${e.message}`); }
    }
  }
}
// Remember everything we saw this run (not only what passed the filters), capped at 2,000 ids.
for (const x of res.data ?? []) seen.add(idOf(x));
const next = { seen: [...seen].slice(-2000), lastRunAt: Date.now(), feedUpdatedAt: res.updatedAt ?? null };
writeFileSync(`${statePath}.tmp`, JSON.stringify(next), { mode: 0o600 });
renameSync(`${statePath}.tmp`, statePath);
log(`${fresh.length} new · feed updated ${res.updatedAt ? Math.round((Date.now() - res.updatedAt) / 1000) + "s ago" : "?"}${res.partial ? ` · partial: ${res.partial}` : ""}`);
process.exit(failed ? 1 : 0);
