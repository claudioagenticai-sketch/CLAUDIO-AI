// Loopback calls from the MCP server to the site's own /api (so MCP tools reuse exactly the same handlers, rate limits
// and in-memory GMGN cache as the website). A per-process random secret marks them so the coming-soon gate lets them
// through; it never leaves the process and is only honoured on loopback connections.
import type { Request } from "express";
import { randomBytes } from "crypto";

export const INTERNAL_HEADER = "x-claudio-internal";
const SECRET = randomBytes(32).toString("base64url");

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** True for a request made by loopbackGet() in this same process. */
export function isInternalRequest(req: Request): boolean {
  const got = req.get(INTERNAL_HEADER);
  return !!got && got === SECRET && LOOPBACK.has(req.socket.remoteAddress ?? "");
}

export class LoopbackError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
    this.name = "LoopbackError";
  }
}

function base(): string {
  return `http://127.0.0.1:${parseInt(process.env.PORT || "5000", 10)}`;
}

/** GET/POST a site API path over loopback. `clientIp` keeps the site's per-IP limits per real caller. */
export async function loopback(method: "GET" | "POST", path: string, opts: { query?: Record<string, unknown>; body?: unknown; clientIp?: string; timeoutMs?: number } = {}): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const url = `${base()}${path}${qs.toString() ? `?${qs}` : ""}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      method,
      signal: ctl.signal,
      headers: {
        accept: "application/json",
        [INTERNAL_HEADER]: SECRET,
        ...(opts.clientIp ? { "x-forwarded-for": opts.clientIp } : {}),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const ra = Number(res.headers.get("retry-after"));
      throw new LoopbackError(res.status, (data && (data.message || data.error)) || `HTTP ${res.status}`, Number.isFinite(ra) ? ra : undefined);
    }
    return data;
  } catch (e) {
    if (e instanceof LoopbackError) throw e;
    throw new LoopbackError(502, ctl.signal.aborted ? "Timed out reading Claudio data" : `Couldn't read Claudio data: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
