// Tool + resource implementations for the online MCP server.
//   Data tools → the shared handlers in @shared/mcpCatalog, reading the site's own /api over loopback (same rate limits,
//   same in-memory GMGN cache: one coin per call, cache-first, every answer says how old it is).
//   User tools (portfolio, watchlist) → the token's wallet: Solana RPC reads + the board's in-memory snapshots only.
//   Trade tools → quotes from the trade routes; prepare_* only store a 2-minute prepared action and return a
//   /confirm/<id> link. Nothing here signs or sends a transaction; the user does that in their own wallet.
import type { Request } from "express";
import {
  DATA_HANDLERS, UNTRUSTED_NOTICE, ToolError, coinKey, coinSummary, errorOutput, portfolioOutput, q as quote, readDataResource, toolOutput, usd,
  type DataContext, type ToolOutput,
} from "@shared/mcpCatalog";
import type { TokenSnapshot } from "@shared/types";
import { adminWallets } from "../auth";
import { comingSoon } from "../access";
import { tokenStore, nativeUsd } from "../store";
import { lookupToken } from "../insights";
import { primaryRpc } from "../rpc";
import { findRoute, unsupportedError } from "../trade/routes";
import { TradeError } from "../trade/types";
import { agentById } from "../agents/store";
import { submitPost } from "../agents/thread";
import { LoopbackError, loopback } from "./internal";
import { baseUrl } from "./oauth";
import { effectiveStatus, getPrepared, getWatchlist, insertPrepared, updatePrepared, type Principal, type PreparedRow } from "./store";

export interface CallContext {
  req: Request;
  principal: Principal | null;
  clientIp: string;
}

export function dataContext(c: CallContext): DataContext {
  return {
    baseUrl: baseUrl(c.req),
    get: async (path, query) => {
      try {
        return await loopback("GET", path, { query: query ?? undefined, clientIp: c.clientIp });
      } catch (e) {
        if (e instanceof LoopbackError) throw Object.assign(new Error(e.message), { status: e.status, retryAfter: e.retryAfter });
        throw e;
      }
    },
  };
}

// ─── Solana RPC reads (portfolio) ──────────────────────────────────

const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

async function rpc(method: string, params: unknown[]): Promise<any> {
  const url = primaryRpc("sol");
  if (!url) throw new ToolError("No Solana RPC is configured on this server.", "no_rpc", 503);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "RPC error");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function holdings(wallet: string): Promise<{ sol: number | null; tokens: { mint: string; amount: number }[] }> {
  const [bal, ...accts] = await Promise.all([
    rpc("getBalance", [wallet, { commitment: "confirmed" }]).catch(() => null),
    ...TOKEN_PROGRAMS.map((programId) => rpc("getTokenAccountsByOwner", [wallet, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => null)),
  ]);
  const byMint = new Map<string, number>();
  for (const a of accts) {
    for (const v of a?.value ?? []) {
      const info = v?.account?.data?.parsed?.info;
      const amt = Number(info?.tokenAmount?.uiAmount ?? 0);
      if (info?.mint && amt > 0) byMint.set(info.mint, (byMint.get(info.mint) ?? 0) + amt);
    }
  }
  return { sol: typeof bal?.value === "number" ? bal.value / 1e9 : null, tokens: [...byMint].map(([mint, amount]) => ({ mint, amount })) };
}

async function watchlistCoins(wallet: string): Promise<{ shared: boolean; coins: TokenSnapshot[] }> {
  const keys = await getWatchlist(wallet).catch(() => null);
  if (!keys) return { shared: false, coins: [] };
  return { shared: true, coins: keys.map((k) => tokenStore.get(k)).filter((t): t is TokenSnapshot => !!t) };
}

async function portfolio(c: CallContext): Promise<ToolOutput> {
  const p = c.principal!;
  const [h, w] = await Promise.all([holdings(p.wallet), watchlistCoins(p.wallet)]);
  const positions: { token: TokenSnapshot; amount: number }[] = [];
  const unknown: { mint: string; amount: number }[] = [];
  for (const t of h.tokens) {
    const snap = tokenStore.get(`sol:${t.mint}`); // board snapshot only: never a per-coin GMGN lookup here
    if (snap) positions.push({ token: snap, amount: t.amount });
    else unknown.push(t);
  }
  const out = portfolioOutput({ wallet: p.wallet, solBalance: h.sol, solUsd: nativeUsd("sol") || null, positions, watchlist: w.coins, unknown: unknown.slice(0, 50), ageSec: 0, source: "rpc" }, baseUrl(c.req));
  if (!w.shared) out.text += "\nThe watchlist isn't shared: turn on \"Share my watchlist\" at /connect.";
  return out;
}

// ─── trade ─────────────────────────────────────────────────────────

function tradingAllowed(p: Principal): void {
  if (comingSoon() && !adminWallets().has(p.wallet)) throw new ToolError("Trading and launches on Claudio open at launch. Data tools work now.", "coming_soon", 403);
}

async function snapshot(key: string): Promise<TokenSnapshot> {
  let t = tokenStore.get(key);
  if (!t) {
    await lookupToken(key).catch(() => false);
    t = tokenStore.get(key);
  }
  if (!t) throw new ToolError(`Claudio doesn't have ${key} on its board (yet).`, "not_found", 404);
  return t;
}

const sideOf = (v: unknown) => (v === "sell" ? "sell" : v === "buy" ? "buy" : null);
const clampSlippage = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(5000, Math.round(Number(v)))) : 1500);

async function tradeQuote(p: Principal, a: Record<string, unknown>) {
  const key = coinKey(a.coin);
  const side = sideOf(a.side);
  if (!side) throw new ToolError('side must be "buy" or "sell"', "bad_side", 400);
  const amount = Number(a.amount);
  if (!(amount > 0)) throw new ToolError("amount must be greater than 0", "bad_amount", 400);
  if (side === "sell" && amount > 100) throw new ToolError("For a sell, amount is a percent of your balance (1–100).", "bad_amount", 400);
  if (side === "buy" && amount > 100) throw new ToolError("Online buys are limited to 100 SOL per trade.", "bad_amount", 400);
  const token = await snapshot(key);
  const route = findRoute(token);
  if (!route) throw unsupportedError(token);
  const slippageBps = clampSlippage(a.slippage_bps);
  const q = await route.quote({ token, side, amount, trader: p.wallet, slippageBps });
  return { key, token, side, amount, slippageBps, q, route: route.label };
}

const fmt = (v: number, d = 6) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : "–");

function tradeSummary(t: Awaited<ReturnType<typeof tradeQuote>>) {
  const sym = String(t.token.symbol ?? "").slice(0, 16);
  const lines: [string, string][] = [
    ["Coin", `$${sym} — ${String(t.token.name ?? "").slice(0, 48)}`],
    ["Mint", t.token.address],
    ["Side", t.side === "buy" ? "Buy" : "Sell"],
    [t.side === "buy" ? "You spend" : "You sell", t.side === "buy" ? `${fmt(t.amount, 4)} SOL` : `${fmt(t.amount, 2)}% of your $${sym}`],
    ["You get about", t.side === "buy" ? `${fmt(t.q.expectedOut, 2)} $${sym}` : `${fmt(t.q.expectedOut, 6)} SOL`],
    ["At least", t.side === "buy" ? `${fmt(t.q.minOut, 2)} $${sym}` : `${fmt(t.q.minOut, 6)} SOL`],
    ["Max slippage", `${t.slippageBps / 100}%`],
    ["Price impact", `${fmt(t.q.priceImpactPct, 2)}%`],
    ["Fees", `about ${fmt(t.q.feeNative, 6)} SOL (venue fee${t.q.taxPct ? ` + ${t.q.taxPct}% token tax` : ""}) plus the Solana network fee`],
    ["Route", t.route],
  ];
  return { kind: "trade", side: t.side, symbol: sym, name: String(t.token.name ?? "").slice(0, 48), lines, warnings: t.q.warnings ?? [], estimate: !!t.q.estimate };
}

function preparedOutput(req: Request, p: PreparedRow, lead?: string): ToolOutput {
  const base = baseUrl(req);
  const status = effectiveStatus(p);
  const confirmUrl = `${base}/confirm/${p.id}`;
  const lines = ((p.summary as { lines?: [string, string][] }).lines ?? []).map(([k, v]) => `${k}: ${k === "Coin" || k === "Name" || k === "Ticker" ? quote(v, 70) : v}`);
  const text = [
    lead ?? `Status: ${status}.`,
    ...lines,
    status === "pending" ? `Confirm link (valid until ${new Date(p.expires_at).toISOString()}): ${confirmUrl}` : "",
    p.signatures?.length ? `Signatures: ${p.signatures.map((s) => `https://solscan.io/tx/${s}`).join(" ")}` : "",
    p.mint ? `Coin page: ${base}/t/sol/${p.mint}` : "",
    p.error ? `Error: ${p.error}` : "",
    "",
    UNTRUSTED_NOTICE,
  ].filter((l) => l !== "").join("\n");
  return {
    text,
    structured: {
      id: p.id, kind: p.kind, status, confirmUrl, expiresAt: new Date(p.expires_at).toISOString(), summary: p.summary,
      signatures: p.signatures ?? [], mint: p.mint, error: p.error,
    },
  };
}

/** signed → confirmed / failed once the cluster says so (checked at most every 5 s). */
async function refreshStatus(p: PreparedRow): Promise<PreparedRow> {
  if (p.status !== "signed" || !p.signatures?.length) return p;
  if (p.checked_at && Date.now() - new Date(p.checked_at).getTime() < 5_000) return p;
  try {
    const r = await rpc("getSignatureStatuses", [p.signatures, { searchTransactionHistory: true }]);
    const st: any[] = r?.value ?? [];
    if (st.some((s) => s?.err)) return (await updatePrepared(p.id, { status: "failed", error: "A transaction failed on-chain", touch: "checked" })) ?? p;
    if (st.length && st.every((s) => s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized"))) {
      // The signer must be the wallet this was prepared for.
      const tx = await rpc("getTransaction", [p.signatures[p.signatures.length - 1], { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null);
      const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
      const payer = keys[0]?.pubkey ?? keys[0];
      if (tx && payer && payer !== p.wallet) return (await updatePrepared(p.id, { status: "failed", error: "Signed by a different wallet", touch: "checked" })) ?? p;
      return (await updatePrepared(p.id, { status: "confirmed", touch: "confirmed" })) ?? p;
    }
    return (await updatePrepared(p.id, { touch: "checked" })) ?? p;
  } catch {
    return p;
  }
}

const NAME_MAX = 32;
const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

function launchParams(a: Record<string, unknown>) {
  const name = String(a.name ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const symbol = String(a.symbol ?? "").normalize("NFKC").trim().replace(/^\$+/, "").toUpperCase();
  if (!name || name.length > NAME_MAX) throw new ToolError(`The name must be 1–${NAME_MAX} characters.`, "bad_name", 400);
  if (!SYMBOL_RE.test(symbol)) throw new ToolError("The ticker must be 1–10 letters or digits.", "bad_symbol", 400);
  const image = String(a.image ?? "").trim();
  if (!/^(https:\/\/|ipfs:\/\/)\S{3,1000}$/i.test(image)) throw new ToolError("Online, the image must be an https:// or ipfs:// URL.", "bad_image", 400);
  const link = (v: unknown, what: string) => {
    const s = String(v ?? "").trim();
    if (!s) return undefined;
    if (!/^https:\/\/\S{3,250}$/i.test(s)) throw new ToolError(`${what} must be an https:// link.`, "bad_link", 400);
    return s;
  };
  const devBuySol = Number(a.dev_buy_sol ?? 0);
  if (!(devBuySol >= 0) || devBuySol > 100) throw new ToolError("dev_buy_sol must be between 0 and 100.", "bad_amount", 400);
  const description = String(a.description ?? "").trim().slice(0, 2048) || undefined;
  return { name, symbol, imageUri: image, description, socials: { twitter: link(a.twitter, "twitter"), telegram: link(a.telegram, "telegram"), website: link(a.website, "website") }, devBuySol, slippageBps: 1500 };
}

// ─── dispatch ──────────────────────────────────────────────────────

/** Runs one tool. Never throws: problems come back as isError results the model can read. */
export async function callTool(name: string, args: Record<string, unknown>, c: CallContext): Promise<ToolOutput> {
  try {
    if (DATA_HANDLERS[name]) return await DATA_HANDLERS[name](args, dataContext(c));
    const p = c.principal;
    switch (name) {
      case "get_my_portfolio":
        return await portfolio(c);

      case "quote": {
        tradingAllowed(p!);
        const t = await tradeQuote(p!, args);
        const s = tradeSummary(t);
        const coin = coinSummary(t.token, baseUrl(c.req));
        return toolOutput(
          [`Quote only, nothing was sent. ${t.side === "buy" ? "Buy" : "Sell"} ${quote(t.token.symbol, 16)}:`, ...s.lines.slice(2).map(([k, v]) => `${k}: ${v}`), ...(s.warnings.length ? [`Warnings: ${s.warnings.join("; ")}`] : [])],
          { coin, side: t.side, amount: t.amount, quote: { expectedOut: t.q.expectedOut, minOut: t.q.minOut, priceImpactPct: t.q.priceImpactPct, feeSol: t.q.feeNative, taxPct: t.q.taxPct, route: t.route, estimate: !!t.q.estimate }, warnings: s.warnings },
          { ageSec: Math.max(0, Math.round((Date.now() - (t.token.updatedAt || Date.now())) / 1000)), source: "claudio" },
        );
      }

      case "prepare_trade": {
        tradingAllowed(p!);
        const t = await tradeQuote(p!, args);
        const summary = tradeSummary(t);
        const params = { key: t.key, side: t.side, ...(t.side === "buy" ? { amountSol: t.amount } : { percent: t.amount }), slippageBps: t.slippageBps };
        const row = await insertPrepared({ wallet: p!.wallet, kind: "trade", params, summary, client_name: p!.clientName, grant_id: p!.kind === "oauth" ? p!.id : null, key_id: p!.kind === "key" ? p!.id : null });
        return preparedOutput(c.req, row, `Prepared, not sent. Give the user this link: they review it on useclaudio.xyz and sign with their own wallet within 2 minutes. Then call get_trade_status with id ${row.id}.`);
      }

      case "prepare_launch": {
        tradingAllowed(p!);
        const params = launchParams(args);
        const lines: [string, string][] = [
          ["Name", params.name],
          ["Ticker", `$${params.symbol}`],
          ["Launchpad", "pump.fun (Solana)"],
          ["Image", params.imageUri.slice(0, 120)],
          ...(params.description ? ([["Description", params.description.slice(0, 160)]] as [string, string][]) : []),
          ["Dev buy", params.devBuySol ? `${params.devBuySol} SOL` : "none"],
          ["Fees", "No launch fee. You pay the dev buy plus Solana network and account fees, shown before you sign"],
          ["Creator rewards", "70% of the coin's trading fees go to your wallet (Claudio keeps 30%)"],
          ["Creator wallet", p!.wallet],
        ];
        const summary = { kind: "launch", symbol: params.symbol, name: params.name, lines };
        const row = await insertPrepared({ wallet: p!.wallet, kind: "launch", params, summary, client_name: p!.clientName, grant_id: p!.kind === "oauth" ? p!.id : null, key_id: p!.kind === "key" ? p!.id : null });
        return preparedOutput(c.req, row, `Launch prepared, nothing created yet. Give the user this link: they review the real costs on useclaudio.xyz and sign with their own wallet within 2 minutes. Then call get_trade_status with id ${row.id}.`);
      }

      case "get_trade_status": {
        const id = String(args.id ?? "");
        let row = await getPrepared(id);
        if (!row || row.wallet !== p!.wallet) throw new ToolError("No prepared trade or launch with that id for this wallet.", "not_found", 404);
        row = await refreshStatus(row);
        return preparedOutput(c.req, row);
      }

      case "post_message": {
        if (!p!.agentId) throw new ToolError("No agent is linked to this connection. Reconnect at /connect and pick an agent to post as.", "agent_required", 403);
        const a = await agentById(p!.agentId);
        if (!a || a.ownerWallet !== p!.wallet) throw new ToolError("The linked agent isn't yours any more. Reconnect at /connect.", "agent_required", 403);
        const room = String(args.room ?? "").trim();
        const content = String(args.content ?? "");
        if (!room || !content.trim()) throw new ToolError("room and content are required", "bad_request", 400);
        const r = await submitPost({ agent: a, room, content: content.slice(0, 1000), replyTo: args.reply_to ? String(args.reply_to) : null, source: "external", ip: c.clientIp });
        if (!r.ok) return { text: `Not posted: ${r.message}${r.retryAfterSec ? ` (try again in ${r.retryAfterSec} s)` : ""}`, structured: { status: "rejected", error: r.code, message: r.message, retryAfterSec: r.retryAfterSec ?? null, room }, isError: true };
        if (r.hidden) return toolOutput([`Held for review (${r.reason}). It isn't public yet.`], { id: r.id, status: "held", reason: r.reason, room }, { untrusted: false });
        return toolOutput([`Posted in #${room} as @${a.slug} (message ${r.id}).`], { id: r.id, status: "posted", room, agent: a.slug }, { untrusted: false });
      }
    }
    return { text: `Unknown tool ${name}`, structured: { error: "unknown_tool" }, isError: true };
  } catch (e) {
    if (e instanceof TradeError) return errorOutput(new ToolError(e.message + (e.site ? ` (${e.site})` : ""), e.code, e.status));
    return errorOutput(e);
  }
}

// ─── resources ─────────────────────────────────────────────────────

export async function readResource(uri: string, c: CallContext): Promise<{ uri: string; mimeType: string; text: string } | null> {
  if (uri === "claudio://me/portfolio") return { uri, mimeType: "application/json", text: JSON.stringify((await portfolio(c)).structured, null, 1) };
  if (uri === "claudio://watchlist") {
    const w = await watchlistCoins(c.principal!.wallet);
    const base = baseUrl(c.req);
    return { uri, mimeType: "application/json", text: JSON.stringify({ shared: w.shared, coins: w.coins.map((t) => coinSummary(t, base)), notice: UNTRUSTED_NOTICE }, null, 1) };
  }
  return readDataResource(uri, dataContext(c));
}

export { usd };
