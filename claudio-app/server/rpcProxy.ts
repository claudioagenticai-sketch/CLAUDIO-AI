// Solana JSON-RPC proxy for the browser: POST /api/rpc/sol.
//
// Why: Solana's free public RPC answers browser requests from most websites with 403 "Access forbidden", and putting a
// paid RPC key into the client bundle would leak it. The browser sends JSON-RPC here; the server forwards it to
// SOL_RPC_URL (or SOLANA_RPC_URL; several comma-separated URLs fail over in order), falling back to the public RPC.
//
// Only read methods and transaction submission/simulation are allowed — nothing that costs much or exposes the
// endpoint beyond what the app needs. Per-IP limits; sends have their own tighter bucket.
import type { Express, Request, Response } from "express";
import { rpcUrls } from "./rpc";
import { hit } from "./auth";

const ALLOWED = new Set([
  "getLatestBlockhash",
  "isBlockhashValid",
  "sendTransaction",
  "simulateTransaction",
  "getSignatureStatuses",
  "getTransaction",
  "getSignaturesForAddress",
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountsByOwner",
  "getTokenAccountBalance",
  "getTokenSupply",
  "getTokenLargestAccounts",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getVersion",
  "getHealth",
  "getGenesisHash",
]);

const SEND_METHODS = new Set(["sendTransaction", "simulateTransaction"]);
const MAX_BATCH = 20;
const TIMEOUT_MS = 20_000;

interface RpcCall {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function forward(body: string): Promise<{ status: number; text: string }> {
  const urls = rpcUrls("sol");
  let last: { status: number; text: string } = { status: 502, text: JSON.stringify(rpcError(null, -32000, "No Solana RPC reachable")) };
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await r.text();
      // Fail over on auth/rate-limit/server errors; pass everything else (incl. JSON-RPC errors) straight through.
      if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) {
        last = { status: r.status, text };
        continue;
      }
      return { status: r.status, text };
    } catch (e) {
      last = { status: 502, text: JSON.stringify(rpcError(null, -32000, `Solana RPC unreachable: ${(e as Error).message}`)) };
    }
  }
  return last;
}

export function registerRpcProxy(app: Express): void {
  app.post("/api/rpc/sol", async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const body = req.body as RpcCall | RpcCall[];
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.length || calls.length > MAX_BATCH || calls.some((c) => !c || typeof c !== "object")) {
      return res.status(400).json(rpcError(null, -32600, "Invalid JSON-RPC request"));
    }
    for (const c of calls) {
      if (typeof c.method !== "string" || !ALLOWED.has(c.method)) {
        return res.status(403).json(rpcError(c?.id, -32601, `Method not allowed through this proxy: ${String(c?.method)}`));
      }
    }
    const ip = req.ip ?? "unknown";
    if (!hit(`rpc:${ip}`, 240, 60_000)) {
      res.set("Retry-After", "30");
      return res.status(429).json(rpcError(calls[0].id, 429, "Too many RPC requests — slow down"));
    }
    if (calls.some((c) => SEND_METHODS.has(c.method as string)) && !hit(`rpc-send:${ip}`, 40, 60_000)) {
      res.set("Retry-After", "30");
      return res.status(429).json(rpcError(calls[0].id, 429, "Too many transactions — wait a moment"));
    }
    const out = await forward(JSON.stringify(body));
    res.status(out.status).type("application/json").send(out.text);
  });
}
