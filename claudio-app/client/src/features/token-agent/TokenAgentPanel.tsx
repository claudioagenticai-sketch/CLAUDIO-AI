// The agentic layer of the token page (GET /api/token/:key/agent): Agent take, Ask Claudio, Launched by,
// Where the fees go, Agents on this coin. Additive: renders below the chart and never blocks the page.
import { CLAUDIO_TOKEN } from "@shared/platform";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight, ExternalLink, Loader2, Send } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { CATEGORY_LABEL, type TokenAgentInfo } from "@shared/agents";
import type { TokenSnapshot } from "@shared/types";
import { Age, CopyAddress } from "@/components/kit";
import { cn } from "@/lib/utils";
import { ApiError, errorText, isUnavailable, useAskToken, useTokenAgentInfo } from "@/features/agents/api";
import { AgentAvatar, AgentName, AiLabel, CategoryChip, ModeChip, PlainText, fmtSol } from "@/features/agents/ui";

function Panel({ title, right, children, className }: { title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      <header className="flex min-h-[44px] items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">{title}</h3>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      {children}
    </section>
  );
}

// ─── Agent take ─────────────────────────────────────────────────────

export function AgentTakeCard({ info, loading, unavailable }: { info?: TokenAgentInfo; loading: boolean; unavailable: boolean }) {
  const take = info?.take;
  return (
    <Panel title="Agent take" right={take ? <AiLabel /> : undefined} >
      <div className="px-4 py-3.5">
        {loading ? (
          <div className="space-y-2">
            <span className="sheen block h-3 w-full rounded bg-panel-2" />
            <span className="sheen block h-3 w-4/5 rounded bg-panel-2" />
          </div>
        ) : take ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <AgentAvatar agent={{ slug: "claudio", name: "Claudio", tier: "official" }} size={24} />
              <span className="text-[12.5px] font-semibold">Claudio</span>
              <span className="text-[11px] text-text-3">
                updated <Age from={Date.parse(take.updatedAt) || Date.now()} className="text-text-3" /> ago
              </span>
            </div>
            <PlainText text={take.text} className="text-[13.5px] leading-[1.55] text-text-2" />
          </>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-text-3">
            {unavailable ? "Agent takes are on their way — Claudio will sum up each coin in plain words." : "Claudio hasn't written a take on this coin yet. Ask his below."}
          </p>
        )}
      </div>
    </Panel>
  );
}

// ─── Ask Claudio ────────────────────────────────────────────────────

const SUGGESTIONS = ["Is the dev still holding?", "Who's buying this?", "What are the risks?"];

export function AskClaudioCard({ tokenKey, symbol }: { tokenKey: string; symbol: string }) {
  const ask = useAskToken(tokenKey);
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const e = ask.error;
    if (e instanceof ApiError && e.kind === "rate_limited") {
      setCooldown(e.retryAfter ?? 30);
      window.clearInterval(timer.current);
      timer.current = window.setInterval(() => setCooldown((c) => (c <= 1 ? (window.clearInterval(timer.current), 0) : c - 1)), 1000);
    }
    return () => window.clearInterval(timer.current);
  }, [ask.error]);

  const submit = (text = q) => {
    const question = text.trim();
    if (question.length < 3 || ask.isPending || cooldown > 0) return;
    setAsked(question);
    ask.mutate(question);
    setQ("");
  };

  const err = ask.error;
  const errMsg =
    err instanceof ApiError
      ? err.kind === "rate_limited"
        ? `Claudio needs a breather. Ask again in ${cooldown > 0 ? `${cooldown}s` : "a moment"}.`
        : err.kind === "unavailable" && (err.code === "unavailable" || err.code.startsWith("http_"))
          ? "Asking Claudio opens soon."
          : err.kind === "not_found"
            ? err.message || "Claudio can't see this coin on the live board right now."
            : errorText(err)
      : err
        ? errorText(err)
        : null;

  return (
    <Panel title={`Ask Claudio about $${symbol}`}>
      <div className="space-y-3 px-4 py-3.5">
        {asked && (
          <div className="space-y-2.5">
            <div className="ml-auto w-fit max-w-[85%] rounded-[3px] bg-panel-2 px-3 py-2 text-[13px] text-text ring-1 ring-inset ring-line-2">
              <PlainText text={asked} />
            </div>
            <div className="flex gap-2">
              <AgentAvatar agent={{ slug: "claudio", name: "Claudio", tier: "official" }} size={26} className="mt-0.5" />
              <div className="min-w-0 flex-1 rounded-[3px] border-l-2 border-brand bg-bg px-3 py-2 ring-1 ring-inset ring-line">
                {ask.isPending ? (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Claudio is reading the chart…
                  </span>
                ) : ask.data ? (
                  <>
                    <PlainText text={ask.data.answer} className="text-[13px] leading-[1.55] text-text-2" />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <AiLabel />
                    </div>
                  </>
                ) : errMsg ? (
                  <p className="text-[12.5px] text-text-3">{errMsg}</p>
                ) : null}
              </div>
            </div>
          </div>
        )}
        {!asked && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => submit(s)} className="h-9 shrink-0 rounded-[3px] px-3 text-[12px] font-medium text-text-2 ring-1 ring-inset ring-line-2 hover:bg-panel-2 hover:text-text">
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, 280))}
            placeholder={cooldown > 0 ? `Try again in ${cooldown}s` : "Ask anything about this coin"}
            disabled={cooldown > 0}
            enterKeyHint="send"
            className="h-11 min-w-0 flex-1 rounded-[3px] border border-line-2 bg-bg px-3 text-base text-text outline-none placeholder:text-text-3 focus:border-brand disabled:opacity-60 md:h-10 md:text-sm"
          />
          <button
            type="submit"
            disabled={q.trim().length < 3 || ask.isPending || cooldown > 0}
            aria-label="Ask"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] bg-brand text-brand-ink transition active:scale-95 disabled:opacity-40 md:h-10 md:w-10"
          >
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
        <p className="text-[10.5px] leading-relaxed text-text-3">Claudio reads the public data on this page. Answers are written by AI — not financial advice.</p>
      </div>
    </Panel>
  );
}

// ─── Launched by ────────────────────────────────────────────────────

export function LaunchedByCard({ info }: { info: TokenAgentInfo }) {
  const a = info.launchedBy;
  if (!a) return null;
  return (
    <Panel title="Launched by">
      <Link href={`/a/${a.slug}`} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-panel-2/50">
        <AgentAvatar agent={a} size={40} />
        <div className="min-w-0 flex-1">
          <AgentName agent={a} nameClassName="text-[14px]" />
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-text-3">
            <CategoryChip category={a.category} />
            <span className="text-line-2">·</span>
            <ModeChip mode={a.mode} short />
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-text-3 group-hover:text-text" />
      </Link>
      {a.mode === "hosted" && (
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-text-3">
          An agent launched this coin. Its creator fees go to {a.name}'s Claudio-held wallet — not to a person.
        </p>
      )}
    </Panel>
  );
}

// ─── Where the fees go ──────────────────────────────────────────────

export function FeesCard({ info }: { info: TokenAgentInfo }) {
  const fees = info.fees;
  if (!fees || (!fees.route.length && !fees.payouts.length)) return null;
  const sol = CHAINS.sol;
  const total = fees.route.reduce((s, r) => s + r.bps, 0) || 10_000;
  const tones = ["var(--brand)", "var(--info)", "var(--buy)", "var(--gold)"];
  return (
    <Panel title="Where the fees go">
      <div className="space-y-3 px-4 py-3.5">
        <div className="flex h-1.5 overflow-hidden bg-line">
          {fees.route.map((r, i) => (
            <span key={r.address + i} style={{ width: `${(r.bps / total) * 100}%`, background: tones[i % tones.length] }} />
          ))}
        </div>
        <ul className="space-y-1.5">
          {fees.route.map((r, i) => (
            <li key={r.address + i} className="flex items-center gap-2 text-[12.5px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tones[i % tones.length] }} />
              <span className="min-w-0 flex-1 truncate text-text-2">{r.label}</span>
              <span className="num font-medium text-text">{(r.bps / 100).toFixed(r.bps % 100 ? 1 : 0)}%</span>
              <CopyAddress address={r.address} />
              <a href={sol.explorerAddress(r.address)} target="_blank" rel="noopener noreferrer" aria-label={`${r.label} on Solscan`} className="flex h-7 w-7 items-center justify-center rounded-[2px] text-text-3 hover:bg-panel-3 hover:text-text">
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
        {fees.payouts.length > 0 && (
          <div className="border-t border-line pt-3">
            <div className="eyebrow mb-1.5">Recent payouts</div>
            <ul className="space-y-1">
              {fees.payouts.slice(0, 5).map((p) => (
                <li key={p.tx} className="flex items-center gap-2 text-[12px]">
                  <span className="num font-semibold text-buy">+{fmtSol(p.amountSol)} SOL</span>
                  <Age from={Date.parse(p.at)} className="text-text-3" />
                  <a href={sol.explorerTx(p.tx)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-text-3 hover:text-text">
                    tx <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── Agents on this coin ────────────────────────────────────────────

export function AgentsOnCoin({ info }: { info: TokenAgentInfo }) {
  if (!info.agents.length) return null;
  return (
    <Panel title="Agents on this coin" right={<span className="num text-[11.5px] text-text-3">{info.agents.length}</span>}>
      <ul className="divide-y divide-line/70">
        {info.agents.map(({ agent, side, amountSol }) => (
          <li key={agent.id}>
            <Link href={`/a/${agent.slug}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-panel-2/50">
              <AgentAvatar agent={agent} size={30} />
              <div className="min-w-0 flex-1">
                <AgentName agent={agent} nameClassName="text-[13px]" />
                <div className="text-[11px] text-text-3">
                  {CATEGORY_LABEL[agent.category]} · {side === "holder" ? "Holding" : "Trading"}
                </div>
              </div>
              {amountSol != null && <span className="num text-[12.5px] font-semibold text-text-2">{fmtSol(amountSol)} SOL</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Everything agentic for a token, laid out for the token page's main column. */
/** $CLAUDIO or a coin launched on Claudio: the only coins Claudio and his cast talk about. */
export function isClaudioCoin(token: Pick<TokenSnapshot, "chain" | "address" | "launchedHere">): boolean {
  return token.chain === "sol" && (token.address === CLAUDIO_TOKEN.mint || !!token.launchedHere);
}

export function TokenAgentPanel({ token, className }: { token: TokenSnapshot; className?: string }) {
  const claudioCoin = isClaudioCoin(token);
  const q = useTokenAgentInfo(claudioCoin ? token.key : undefined);
  if (!claudioCoin) return null;
  const info = q.data;
  const unavailable = !info && isUnavailable(q.error);
  const side = info && (info.launchedBy || info.fees || info.agents.length);
  return (
    <div className={cn("grid items-start gap-3", side && "xl:grid-cols-2", className)}>
      <div className="min-w-0 space-y-3">
        <AgentTakeCard info={info} loading={q.isLoading} unavailable={unavailable} />
        <AskClaudioCard tokenKey={token.key} symbol={token.symbol} />
      </div>
      {info && side ? (
        <div className="min-w-0 space-y-3">
          <LaunchedByCard info={info} />
          <FeesCard info={info} />
          <AgentsOnCoin info={info} />
        </div>
      ) : null}
    </div>
  );
}

