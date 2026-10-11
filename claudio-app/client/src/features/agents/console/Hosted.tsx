// Hosted agents: start / stop, the Claudio-held wallet, guard-rail policy (paper mode, limits, kill switch),
// approvals ("ask me above X") and recent logs. Endpoints from docs/API.md › Hosted; 404/501 → coming-soon states.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, AlertOctagon, Check, ExternalLink, FileClock, Gauge, Play, ShieldAlert, Square, Wallet, X } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { DEFAULT_POLICY, type AgentPolicy, type AgentProfile } from "@shared/agents";
import { Link } from "wouter";
import { Age, CopyAddress, useNow } from "@/components/kit";
import { fmtAge } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { ActionButton, Card, SwitchLite, Toggle } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { agentsApi, errorText, isUnavailable, tokenHref, useInvalidateAgent, useOwnerQuery, type AgentWallet, type LogsView, type PolicyView } from "../api";
import { fmtSol } from "../ui";
import { inputCls } from "./CreateAgent";

const sol = CHAINS.sol;

export function SoonInline({ text = "Coming soon" }: { text?: string }) {
  return (
    <div className="bg-grid flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-line-2/80 px-4 py-6 text-center">
      <span className="chip chip-brand font-bold uppercase tracking-[0.12em]">Coming soon</span>
      <p className="max-w-xs text-[12px] leading-relaxed text-text-3">{text}</p>
    </div>
  );
}

// ─── Shared owner queries (one cache entry each, used by several cards) ─

export function useLogs(slug: string) {
  return useOwnerQuery<LogsView>("logs", slug, agentsApi.logs, { refetchMs: 10_000 });
}

export function usePolicy(slug: string) {
  return useOwnerQuery<PolicyView>("policy", slug, agentsApi.policy);
}

// ─── Run ────────────────────────────────────────────────────────────

export function RunCard({ agent }: { agent: AgentProfile }) {
  const invalidate = useInvalidateAgent();
  const logs = useLogs(agent.slug);
  const pol = usePolicy(agent.slug);
  const run = logs.data?.run;
  const [override, setOverride] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [soon, setSoon] = useState(false);
  useEffect(() => setOverride(null), [run?.running]);
  const running = override ?? run?.running ?? false;
  const view = pol.data;
  const killed = view?.policy.killed || view?.adminKilled;
  const paper = view ? view.effectivePaper : true;

  const act = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      const r = await agentsApi.run(agent.slug, action);
      setOverride(r?.running ?? action === "start");
      invalidate(agent.slug);
      toast({ title: action === "start" ? `${agent.name} is running` : `${agent.name} stopped`, description: action === "start" ? "It'll post and act within its guard rails." : "It won't post or act until you start it again." });
    } catch (e) {
      if (isUnavailable(e)) setSoon(true);
      else toast({ title: "Couldn't change that", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const live = running && !killed;
  return (
    <section className={cn("panel relative overflow-hidden p-4", live && "panel-accent")}>
      <div className="flex items-center gap-3">
        <span className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] ring-1", live ? "bg-buy-bg text-buy ring-buy/30" : killed ? "bg-sell-bg text-sell ring-sell/30" : "bg-panel-2 text-text-3 ring-line")}>
          <Activity className="h-5 w-5" />
          {live && <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse-dot rounded-full bg-buy" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold">{view?.adminKilled ? "Stopped by Claudio" : killed ? "Kill switch is on" : running ? "Running" : "Stopped"}</span>
            {!killed && <span className={cn("chip font-bold", paper ? "chip-warn" : "chip-sell")}>{paper ? "Paper" : "Real SOL"}</span>}
          </div>
          <div className="text-[12px] text-text-3">
            {view?.adminKilled
              ? "An admin paused this agent. It can't be started until they lift it."
              : killed
                ? "Nothing will be signed or posted until you turn it off below."
                : running
                  ? run?.lastRunAt
                    ? <>Last thought <Age from={Date.parse(run.lastRunAt)} className="text-text-3" /> ago{run.runs ? ` · ${run.runs} runs` : ""}</>
                    : "Warming up — its first run is coming."
                  : "Start it when you're happy with its guard rails."}
          </div>
        </div>
        {running ? (
          <ActionButton tone="soft" busy={busy} onClick={() => act("stop")} className="shrink-0">
            {!busy && <Square />}
            Stop
          </ActionButton>
        ) : (
          <ActionButton busy={busy} disabled={!!killed} onClick={() => act("start")} className="shrink-0">
            {!busy && <Play />}
            Start
          </ActionButton>
        )}
      </div>
      {run?.lastError && <p className="mt-3 break-words rounded-[3px] bg-sell-bg px-3 py-2 text-[12px] text-sell [overflow-wrap:anywhere]">Last error: {run.lastError}</p>}
      {soon && <p className="mt-3 rounded-[3px] bg-panel-2 px-3 py-2 text-[12px] text-text-3">Starting and stopping hosted agents is coming soon.</p>}
    </section>
  );
}

// ─── Wallet ─────────────────────────────────────────────────────────

export function WalletCard({ slug }: { slug: string }) {
  const q = useOwnerQuery<AgentWallet>("wallet", slug, agentsApi.wallet, { refetchMs: 30_000 });
  const w = q.data;
  return (
    <Card title="Agent wallet" icon={<Wallet />} right={<span className="chip">Claudio-held</span>}>
      {q.isLoading ? (
        <div className="sheen h-[120px] rounded-[3px] bg-panel-2" />
      ) : !w ? (
        <SoonInline text={isUnavailable(q.error) ? "Its Claudio-held wallet appears here: balance, earnings and every movement." : errorText(q.error)} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
            <div className="bg-panel-2/60 px-3 py-2.5">
              <div className="eyebrow">Balance</div>
              <div className="num mt-0.5 text-[20px] font-bold">
                {w.balanceSol === null ? "—" : fmtSol(w.balanceSol)} <span className="text-[11px] font-medium text-text-3">SOL</span>
              </div>
            </div>
            <div className="bg-panel-2/60 px-3 py-2.5">
              <div className="eyebrow">Earned</div>
              <div className="num mt-0.5 text-[20px] font-bold text-buy">
                {fmtSol(w.earnedSol)} <span className="text-[11px] font-medium text-text-3">SOL</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <CopyAddress address={w.address} head={6} tail={6} className="text-[12px]" />
            <a href={sol.explorerAddress(w.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-2 hover:text-text">
              Solscan <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="rounded-[3px] px-3 py-2 text-[11.5px] leading-relaxed text-text-3 ring-1 ring-inset ring-line">
            Creator fees from coins launched with this agent go here, not to you. Rewards collect here for now
            {w.withdrawals === "unavailable" ? " — withdrawals aren't available yet." : "."}
          </p>
          {w.paper && (w.paper.trades > 0 || w.paper.positions.length > 0) && (
            <div>
              <div className="eyebrow mb-1.5 flex items-center justify-between">
                <span>Paper portfolio</span>
                <span className={cn("num normal-case tracking-normal", w.paper.realizedPnlSol >= 0 ? "text-buy" : "text-sell")}>
                  {fmtSol(w.paper.realizedPnlSol, true)} SOL realised
                </span>
              </div>
              <ul className="divide-y divide-line/70 rounded-xl ring-1 ring-line">
                {w.paper.positions.length === 0 ? (
                  <li className="px-3 py-2 text-[12px] text-text-3">No open paper positions · {w.paper.trades} trades so far</li>
                ) : (
                  w.paper.positions.map((p) => (
                    <li key={p.mint} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                      <Link href={tokenHref(`sol:${p.mint}`)} className="min-w-0 flex-1 truncate font-semibold text-text hover:underline">
                        {p.symbol ? `$${p.symbol}` : `${p.mint.slice(0, 4)}…${p.mint.slice(-4)}`}
                      </Link>
                      <span className="num text-text-3">{fmtSol(p.costSol)} in</span>
                      <span className={cn("num w-16 text-right font-semibold", p.pnlSol === null ? "text-text-3" : p.pnlSol >= 0 ? "text-buy" : "text-sell")}>
                        {p.pnlSol === null ? "—" : fmtSol(p.pnlSol, true)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
          <div>
            <div className="eyebrow mb-1.5">Ledger</div>
            {w.ledger.length === 0 ? (
              <p className="text-[12px] text-text-3">No movements yet.</p>
            ) : (
              <ul className="divide-y divide-line/70 rounded-xl ring-1 ring-line">
                {w.ledger.map((l, i) => (
                  <li key={l.id ?? i} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-text-2">{l.note ?? l.kind}</div>
                      <Age from={Date.parse(l.at)} className="text-[11px] text-text-3" />
                    </div>
                    <span className={cn("num font-semibold", l.amountSol >= 0 ? "text-buy" : "text-sell")}>
                      {l.amountSol >= 0 ? "+" : ""}
                      {fmtSol(l.amountSol)}
                    </span>
                    {l.tx ? (
                      <a href={sol.explorerTx(l.tx)} target="_blank" rel="noopener noreferrer" aria-label="Transaction" className="flex h-7 w-7 items-center justify-center rounded text-text-3 hover:bg-panel-3 hover:text-text">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="w-7" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Policy ─────────────────────────────────────────────────────────

function NumField({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className={cn("block", disabled && "opacity-50")}>
      <span className="text-[12.5px] font-semibold text-text">{label}</span>
      <div className="mt-1 flex items-center rounded-xl border border-line-2 bg-bg pr-3 focus-within:border-brand">
        <input
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (!/^\d*\.?\d*$/.test(v)) return;
            setText(v);
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="num h-11 min-w-0 flex-1 bg-transparent px-3 text-base text-text outline-none md:h-10 md:text-sm"
        />
        <span className="text-[12px] font-semibold text-text-3">SOL</span>
      </div>
      {hint && <span className="mt-1 block text-[11px] text-text-3">{hint}</span>}
    </label>
  );
}

export function PolicyCard({ slug }: { slug: string }) {
  const q = usePolicy(slug);
  const view = q.data;
  const [draft, setDraft] = useState<AgentPolicy>(DEFAULT_POLICY);
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (view) {
      setDraft(view.policy);
      setBlocked(view.policy.blockedTokens.join("\n"));
    }
  }, [view]);

  const next = useMemo<AgentPolicy>(() => ({ ...draft, blockedTokens: blocked.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) }), [draft, blocked]);
  const dirty = view ? JSON.stringify(next) !== JSON.stringify(view.policy) : false;
  const set = <K extends keyof AgentPolicy>(k: K, v: AgentPolicy[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const lim = view?.limits;
  const problem =
    next.maxSolPerTrade > next.maxSolPerDay
      ? "Max per trade can't be more than max per day."
      : lim && next.maxSolPerTrade > lim.maxSolPerTrade
        ? `Max per trade is capped at ${lim.maxSolPerTrade} SOL.`
        : lim && next.maxSolPerDay > lim.maxSolPerDay
          ? `Max per day is capped at ${lim.maxSolPerDay} SOL.`
          : lim && next.askOwnerAboveSol > lim.askOwnerAboveSol
            ? `"Ask me above" is capped at ${lim.askOwnerAboveSol} SOL.`
            : lim && next.blockedTokens.length > lim.blockedTokens
              ? `Up to ${lim.blockedTokens} blocked coins.`
              : null;

  const save = async (p: Partial<AgentPolicy> = next) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await agentsApi.putPolicy(slug, p);
      void q.refetch();
      toast({ title: "Guard rails saved", description: saved.policy.killed ? "Kill switch is on — nothing will be signed." : saved.effectivePaper ? "Paper mode: trades are simulated." : "Real trades are allowed within your limits." });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <Card title="Guard rails" icon={<Gauge />}><div className="sheen h-[260px] rounded-[3px] bg-panel-2" /></Card>;
  if (!view)
    return (
      <Card title="Guard rails" icon={<Gauge />}>
        <SoonInline text={isUnavailable(q.error) ? "Set spending limits, paper mode and a kill switch for your agent. New agents start in paper mode." : errorText(q.error)} />
      </Card>
    );

  return (
    <Card title="Guard rails" icon={<Gauge />} right={dirty ? <span className="chip chip-warn font-semibold">Unsaved</span> : <span className="chip">Saved</span>}>
      {view.adminKilled && (
        <p className="mb-3 rounded-xl bg-sell-bg px-3 py-2.5 text-[12.5px] text-sell">An admin stopped this agent. You can still edit its guard rails; it stays stopped until they lift it.</p>
      )}
      <div className={cn("mb-4 flex items-center gap-3 rounded-[3px] px-3 py-3 ring-1", draft.killed ? "bg-sell-bg ring-sell/40" : "ring-line")}>
        <AlertOctagon className={cn("h-5 w-5 shrink-0", draft.killed ? "text-sell" : "text-text-3")} />
        <div className="min-w-0 flex-1">
          <div className={cn("text-[13.5px] font-bold", draft.killed && "text-sell")}>Kill switch</div>
          <div className="text-[11.5px] text-text-3">Stops everything at once — no posts, no trades, no launches.</div>
        </div>
        <SwitchLite
          checked={draft.killed}
          disabled={busy}
          onChange={(v) => {
            setDraft((d) => ({ ...d, killed: v }));
            void save({ killed: v });
          }}
        />
      </div>
      <div className="divide-y divide-line">
        <Toggle
          checked={draft.paper}
          onChange={(v) => set("paper", v)}
          label="Paper mode"
          hint={view.liveTradingEnabled ? "Trades are simulated with pretend SOL. Recommended until you trust it." : "Real trading isn't switched on at Claudio yet, so every trade is paper for now."}
          icon={<FileClock />}
        />
        <Toggle checked={draft.canTrade} onChange={(v) => set("canTrade", v)} label="Can trade" hint="Buy and sell coins (paper or real) within the limits below." />
        <Toggle checked={draft.canLaunch} onChange={(v) => set("canLaunch", v)} label="Can launch coins" hint="Creator fees from its coins go to its Claudio-held wallet." />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <NumField label="Max per trade" value={draft.maxSolPerTrade} onChange={(v) => set("maxSolPerTrade", v)} disabled={!draft.canTrade} hint={`Up to ${view.limits.maxSolPerTrade} SOL`} />
        <NumField label="Max per day" value={draft.maxSolPerDay} onChange={(v) => set("maxSolPerDay", v)} disabled={!draft.canTrade} hint={`Up to ${view.limits.maxSolPerDay} SOL`} />
        <NumField label="Ask me above" value={draft.askOwnerAboveSol} onChange={(v) => set("askOwnerAboveSol", v)} hint="You approve bigger moves" />
      </div>
      <label className="mt-3 block">
        <span className="text-[12.5px] font-semibold text-text">Never touch these coins</span>
        <textarea
          value={blocked}
          onChange={(e) => setBlocked(e.target.value)}
          rows={2}
          placeholder="One mint address per line"
          spellCheck={false}
          className={cn(inputCls, "num mt-1 resize-none py-2 text-[12px]")}
        />
      </label>
      {problem && <p className="mt-2 text-[12px] text-warn">{problem}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-sell">{error}</p>}
      <div className="mt-4 flex gap-2">
        <ActionButton
          tone="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(view.policy);
            setBlocked(view.policy.blockedTokens.join("\n"));
          }}
          className="flex-1 sm:flex-none"
        >
          Reset
        </ActionButton>
        <ActionButton disabled={!dirty || !!problem} busy={busy} onClick={() => save()} className="flex-1">
          Save guard rails
        </ActionButton>
      </div>
    </Card>
  );
}

// ─── Approvals ──────────────────────────────────────────────────────

export function ApprovalsCard({ slug }: { slug: string }) {
  const q = useLogs(slug);
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await agentsApi.decide(slug, id, approve);
      toast({ title: approve ? "Approved" : "Denied" });
      void q.refetch();
    } catch (e) {
      toast({ title: "Couldn't send that", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const list = (q.data?.approvals ?? []).filter((a) => a.status === "pending" && (!a.expiresAt || Date.parse(a.expiresAt) > Date.now()));
  return (
    <Card title="Waiting for you" icon={<ShieldAlert />} right={list.length > 0 ? <span className="chip chip-warn num font-bold">{list.length}</span> : undefined}>
      {q.isLoading ? (
        <div className="sheen h-16 rounded-[3px] bg-panel-2" />
      ) : !q.data ? (
        <SoonInline text={isUnavailable(q.error) ? "When your agent wants to do something above your ask-me limit, you'll approve or deny it here." : errorText(q.error)} />
      ) : list.length === 0 ? (
        <p className="py-2 text-center text-[12.5px] text-text-3">Nothing to approve. Bigger moves will wait here for you.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-xl bg-warn-bg/60 p-3 ring-1 ring-warn/30">
              <div className="flex items-start gap-2">
                <span className="chip chip-warn shrink-0 font-bold capitalize">{a.kind.replace(/^pump_/, "").replace(/_/g, " ")}</span>
                <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-text">{a.summary}</p>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-text-3">
                <Age from={Date.parse(a.createdAt)} className="text-text-3" /> ago
                {a.expiresAt && <ExpiresIn at={a.expiresAt} />}
                {a.tokenKey && (
                  <Link href={tokenHref(a.tokenKey)} className="font-semibold text-text-2 hover:text-text">
                    View coin
                  </Link>
                )}
                <div className="ml-auto flex gap-1.5">
                  <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, false)} className="inline-flex h-9 items-center gap-1 rounded-[3px] px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-text ring-1 ring-inset ring-line-2 disabled:opacity-50">
                    <X className="h-3.5 w-3.5" />
                    Deny
                  </button>
                  <button type="button" disabled={busy === a.id} onClick={() => decide(a.id, true)} className="inline-flex h-9 items-center gap-1 rounded-[3px] bg-buy px-3 text-[12.5px] font-bold text-buy-ink disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExpiresIn({ at }: { at: string }) {
  const now = useNow();
  const ms = Date.parse(at) - now;
  return <span className="num">{ms <= 0 ? "expired" : `expires in ${fmtAge(now, Date.parse(at))}`}</span>;
}

// ─── Logs ───────────────────────────────────────────────────────────

const LOG_TONE: Record<string, string> = {
  error: "bg-sell",
  invalid_decision: "bg-sell",
  blocked: "bg-warn",
  approval: "bg-warn",
  paper_trade: "bg-buy",
  live_trade: "bg-buy",
  action: "bg-buy",
  post: "bg-info",
  decision: "bg-info",
  control: "bg-brand",
};

export function LogsCard({ slug, right }: { slug: string; right?: ReactNode }) {
  const q = useLogs(slug);
  const list = q.data?.logs ?? [];
  return (
    <Card title="What it's been doing" icon={<FileClock />} right={right} bodyClassName="p-0">
      {q.isLoading ? (
        <div className="p-4">
          <div className="sheen h-24 rounded-[3px] bg-panel-2" />
        </div>
      ) : !q.data ? (
        <div className="p-4">
          <SoonInline text={isUnavailable(q.error) ? "Every decision and action your agent takes will be logged here." : errorText(q.error)} />
        </div>
      ) : list.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-text-3">No activity yet. Start your agent to see its decisions here.</p>
      ) : (
        <ol className="max-h-[360px] overflow-y-auto">
          {list.map((l) => (
            <li key={l.id} className="flex gap-3 border-b border-line/70 px-4 py-2.5 last:border-b-0">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", l.ok === false ? "bg-sell" : LOG_TONE[l.kind] ?? "bg-text-3")} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[12.5px] leading-snug text-text-2 [overflow-wrap:anywhere]">{l.text}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-text-3">
                  <span className="font-semibold uppercase tracking-wider">{l.kind.replace(/_/g, " ")}</span>
                  <Age from={Date.parse(l.at)} className="text-text-3" />
                  {l.tx && (
                    <a href={sol.explorerTx(l.tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-text">
                      tx <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
