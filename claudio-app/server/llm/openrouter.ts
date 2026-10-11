// OpenRouter client restricted to FREE models. Shared by resident agents (server/agents) and hosted agents
// (server/hosted). Paid models are refused here, so no caller can spend money by mistake.
//
// Env: OPENROUTER_API_KEY (or PLATFORM_OPENROUTER_API_KEY), OPENROUTER_DAILY_BUDGET (requests/day across the
// whole server, default 800 — OpenRouter's free tier allows ~50/day without credits, ~1000/day with ≥$10 credits).
// On a 429 "free-models-per-day" the client suspends itself until the reset time it was given (or 24 h).
// OPENROUTER_BASE_URL overrides the endpoint (tests point it at a local mock). The free-only guard still applies:
// the catalogue comes from the same base, and only $0 models (or the free router / ":free" ids) are ever called.

const DEFAULT_BASE = "https://openrouter.ai/api/v1";
function base(): string {
  const b = (process.env.OPENROUTER_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/.test(b) ? b : DEFAULT_BASE;
}
export const FREE_ROUTER = "openrouter/free";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Completion {
  text: string;
  model: string;
}

function apiKey(): string | null {
  const k = (process.env.OPENROUTER_API_KEY ?? process.env.PLATFORM_OPENROUTER_API_KEY ?? "").trim();
  return k.length > 10 ? k : null;
}

export function openrouterConfigured(): boolean {
  return apiKey() !== null;
}

// ─── free-model catalogue ────────────────────────────────────────────

let catalogue: { ids: Set<string>; at: number } | null = null;

/** Ids of models whose prompt AND completion price are 0, refreshed every 6 h. */
export async function freeModels(): Promise<string[]> {
  if (catalogue && Date.now() - catalogue.at < 6 * 3600_000) return [...catalogue.ids];
  try {
    const r = await fetch(`${base()}/models`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string; request?: string } }[] };
    const ids = new Set(
      (j.data ?? [])
        .filter((m) => Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0 && Number(m.pricing?.request ?? 0) === 0)
        .map((m) => m.id),
    );
    catalogue = { ids, at: Date.now() };
  } catch (e) {
    console.warn("[openrouter] model list failed:", (e as Error).message);
    catalogue ??= { ids: new Set(), at: 0 };
  }
  return [...catalogue.ids];
}

/** A model id is usable only if it is the free router, ends in ":free", or the live catalogue lists it at $0. */
export async function isFreeModel(id: string): Promise<boolean> {
  if (id === FREE_ROUTER) return true;
  const ids = await freeModels();
  if (ids.length) return ids.includes(id);
  return id.endsWith(":free");
}

// ─── budget + suspension ─────────────────────────────────────────────

let day = new Date().toISOString().slice(0, 10);
let usedToday = 0;
let suspendedUntil = 0;

function budget(): number {
  const n = Number(process.env.OPENROUTER_DAILY_BUDGET ?? 800);
  return Number.isFinite(n) && n > 0 ? n : 800;
}

function rollDay(): void {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    usedToday = 0;
  }
}

export function llmStatus() {
  rollDay();
  return {
    configured: openrouterConfigured(),
    usedToday,
    budget: budget(),
    suspendedUntil: suspendedUntil > Date.now() ? new Date(suspendedUntil).toISOString() : null,
  };
}

/** True when a call may be made now (key present, not suspended, budget left). */
export function canSpend(reserve = 0): boolean {
  rollDay();
  return openrouterConfigured() && Date.now() >= suspendedUntil && usedToday + reserve < budget();
}

export class LlmUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailable";
  }
}

/**
 * One chat completion on a free model. Tries `models` in order (each must be free), then the free router.
 * Throws LlmUnavailable when there is no key, the budget is spent, or the provider suspended us.
 */
export async function complete(
  messages: ChatMessage[],
  opts: { models?: string[]; maxTokens?: number; temperature?: number; timeoutMs?: number; onDelta?: (text: string) => void } = {},
): Promise<Completion> {
  const key = apiKey();
  if (!key) throw new LlmUnavailable("OPENROUTER_API_KEY is not set");
  if (!canSpend()) throw new LlmUnavailable("Free-model budget spent or provider suspended");
  const candidates: string[] = [];
  for (const m of [...(opts.models ?? []), FREE_ROUTER]) {
    if (!candidates.includes(m) && (await isFreeModel(m))) candidates.push(m);
  }
  let last: Error | null = null;
  for (const model of candidates) {
    if (!canSpend()) break;
    usedToday += 1;
    try {
      const r = await fetch(`${base()}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.PUBLIC_BASE_URL ?? "https://useclaudio.xyz",
          "X-Title": "Claudio",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: opts.maxTokens ?? 300,
          temperature: opts.temperature ?? 0.8,
          ...(opts.onDelta ? { stream: true } : {}),
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
      if (r.status === 429) {
        const body = await r.text();
        if (/per-day|daily|free-models-per-day/i.test(body)) {
          const reset = Number(r.headers.get("x-ratelimit-reset"));
          suspendedUntil = Number.isFinite(reset) && reset > Date.now() ? reset : Date.now() + 24 * 3600_000;
          console.warn(`[openrouter] free daily quota hit — suspended until ${new Date(suspendedUntil).toISOString()}`);
          throw new LlmUnavailable("Free-model daily quota reached");
        }
        last = new Error(`429 on ${model}`);
        continue;
      }
      if (!r.ok) {
        last = new Error(`HTTP ${r.status} on ${model}`);
        continue;
      }
      if (opts.onDelta && (r.headers.get("content-type") ?? "").includes("text/event-stream") && r.body) {
        const streamed = await readStream(r.body, opts.onDelta);
        if (!streamed.text.trim()) {
          last = new Error(`empty completion from ${model}`);
          continue;
        }
        return { text: streamed.text.trim(), model: streamed.model ?? model };
      }
      const j = (await r.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
      const text = (j.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        last = new Error(`empty completion from ${model}`);
        continue;
      }
      opts.onDelta?.(text);
      return { text, model: j.model ?? model };
    } catch (e) {
      if (e instanceof LlmUnavailable) throw e;
      last = e as Error;
    }
  }
  throw last ?? new LlmUnavailable("No free model available");
}

/**
 * Reads an OpenAI-style SSE body (`data: {choices:[{delta:{content}}]}` … `data: [DONE]`), calling onDelta per chunk.
 * A mid-stream error object (`data: {error:…}`) ends the stream with what arrived so far.
 */
async function readStream(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<{ text: string; model: string | null }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let model: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return { text, model };
      try {
        const j = JSON.parse(data) as { model?: string; error?: unknown; choices?: { delta?: { content?: string } }[] };
        if (j.model) model = j.model;
        if (j.error) return { text, model };
        const piece = j.choices?.[0]?.delta?.content ?? "";
        if (piece) {
          text += piece;
          onDelta(piece);
        }
      } catch {
        /* keep-alive comments / partial junk */
      }
    }
  }
  return { text, model };
}
