// "Launched on Claudio": coins launched through Claudio in three lanes (New / About to graduate / Graduated)
// on desktop, one segmented lane on phones. Filter: All · Humans · Agents. Cards open the token page.
// Only coins launched on Claudio appear here — never the wider market (that's the Trenches).
import { memo, useMemo, useState } from "react";
import { Link } from "wouter";
import type { LaunchedToken } from "@shared/agents";
import type { TokenPhase } from "@shared/types";
import { Age, Progress, TokenAvatar } from "@/components/kit";
import { Segmented } from "@/features/wallet/ui";
import { PHASE_ACCENT } from "@/features/board/BoardColumn";
import { fmtUsd } from "@/lib/format";
import { fmtCount } from "@/features/token/StatsStrip";
import { cn } from "@/lib/utils";
import { inferPhase, tokenHref } from "@/features/agents/api";
import { AgentBadge } from "@/features/agents/ui";
import { useBoard } from "@/lib/store";
import { SectionHead } from "./sections";

/** Optional richer numbers a launch row may carry (home feed or the live board). */
type LaunchedExtras = { holders?: number | null; buys1h?: number | null; sells1h?: number | null };

const posNum = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

function useLaunchStats(t: LaunchedToken) {
  const live = useBoard((s) => s.tokens[t.key]);
  const x = t as LaunchedToken & LaunchedExtras;
  const lx = live as (typeof live & LaunchedExtras) | undefined;
  return {
    holders: posNum(x.holders) ?? posNum(live?.holders),
    buys1h: posNum(x.buys1h) ?? posNum(lx?.buys1h),
    sells1h: posNum(x.sells1h) ?? posNum(lx?.sells1h),
  };
}

export type WhoFilter = "all" | "human" | "agent";


const LANES: { phase: TokenPhase; title: string; short: string; hint: string }[] = [
  { phase: "new", title: "New", short: "New", hint: "Coins launched on Claudio land here first." },
  { phase: "almost", title: "About to graduate", short: "Graduating", hint: "Coins show up here as their bonding curve nears full." },
  { phase: "migrated", title: "Graduated", short: "Graduated", hint: "Coins that filled their curve and now trade in a pool." },
];

export const LaunchedCard = memo(function LaunchedCard({ t, className }: { t: LaunchedToken; className?: string }) {
  const at = Date.parse(t.createdAt) || Date.now();
  const phase = inferPhase(t);
  const pct = Math.max(0, Math.min(100, t.bondingPct ?? 0));
  const st = useLaunchStats(t);
  return (
    <Link
      href={tokenHref(t.key)}
      className={cn("group flex min-w-0 items-center gap-2.5 rounded-[3px] border border-line px-2.5 py-2 transition-colors hover:border-line-2 hover:bg-panel", className)}
    >
      <TokenAvatar image={t.imageUri ?? undefined} symbol={t.symbol} size={40} bondingPct={phase === "migrated" ? undefined : pct} launchpad="pump" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[13.5px] font-bold tracking-tight text-text">{t.symbol}</span>
          <span className="min-w-0 truncate text-[11.5px] text-text-3">{t.name}</span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          {t.launchedBy === "agent" ? (
            <AgentBadge agent={t.agent} />
          ) : (
            <span className="chip shrink-0 text-text-3" data-tip="Launched by a person">
              Human
            </span>
          )}
          <Age from={at} className="shrink-0 text-[11px] text-text-3" />
          {st.holders && (
            <span className="num shrink-0 truncate text-[11px] text-text-3" data-tip="Holders">
              · {fmtCount(st.holders)} holders
            </span>
          )}
          {(st.buys1h || st.sells1h) && (
            <span className="num hidden shrink-0 text-[11px] xs:inline" data-tip="Buys / sells in the last hour">
              <span className="text-text-3">· </span>
              <span className="text-buy">{st.buys1h ?? 0}</span>
              <span className="text-text-3">/</span>
              <span className="text-sell">{st.sells1h ?? 0}</span>
              <span className="text-text-3"> 1h</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex w-[76px] shrink-0 flex-col items-end gap-1.5">
        <span className="num text-[13px] font-medium text-text" data-tip="Market cap">
          {t.mcapUsd ? fmtUsd(t.mcapUsd) : "—"}
        </span>
        {phase === "migrated" ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-info">Graduated</span>
        ) : (
          <div className="flex w-full items-center gap-1" data-tip={`Bonding curve ${Math.round(pct)}% full`}>
            <Progress pct={pct} className="flex-1" />
            <span className="num w-7 text-right text-[10px] text-text-3">{Math.round(pct)}%</span>
          </div>
        )}
      </div>
    </Link>
  );
});

function CardSkeleton() {
  return (
    <div className="flex items-center gap-2.5 rounded-[3px] border border-line px-2.5 py-2">
      <span className="sheen h-[40px] w-[40px] rounded-[22%] bg-panel-3" />
      <div className="flex-1 space-y-1.5">
        <span className="sheen block h-3.5 w-24 rounded bg-panel-3" />
        <span className="sheen block h-3 w-32 rounded bg-panel-2" />
      </div>
    </div>
  );
}

function LaneEmptyState({ hint, filtered }: { hint: string; filtered: boolean }) {
  return (
    <div className="rounded-[3px] border border-dashed border-line px-4 py-5 text-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-2">{filtered ? "Nothing matches this filter" : "Nothing here yet"}</div>
      <div className="mx-auto mt-1.5 max-w-[16rem] text-[11.5px] leading-relaxed text-text-3">{hint}</div>
    </div>
  );
}

/** Nothing launched on Claudio yet: say so plainly and point at the launcher. */
export function LaunchFirst({ onHowItWorks, className }: { onHowItWorks?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <h3 className="display text-[26px] text-text md:text-[30px]">No coins launched on Claudio yet</h3>
      <p className="mt-2.5 max-w-md text-[13.5px] leading-relaxed text-text-2">
        Launch one on pump.fun in a single transaction. Your creator rewards are paid to your wallet automatically. Agents can launch here too, and
        every coin lands on this board.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/launch" className="btn btn-primary">
          Launch a coin
        </Link>
        {onHowItWorks && (
          <button type="button" onClick={onHowItWorks} className="btn btn-secondary">
            How it works
          </button>
        )}
      </div>
    </div>
  );
}

function useGrouped(tokens: LaunchedToken[], who: WhoFilter) {
  return useMemo(() => {
    const out: Record<TokenPhase, LaunchedToken[]> = { new: [], almost: [], migrated: [] };
    for (const t of tokens) {
      if (who !== "all" && t.launchedBy !== who) continue;
      out[inferPhase(t)].push(t);
    }
    for (const k of Object.keys(out) as TokenPhase[]) out[k].sort((a, b) => (k === "new" ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0)));
    return out;
  }, [tokens, who]);
}

export function WhoToggle({ value, onChange, size = "sm" }: { value: WhoFilter; onChange: (v: WhoFilter) => void; size?: "sm" | "md" }) {
  return (
    <Segmented
      size={size}
      value={value}
      onChange={onChange}
      options={[
        { value: "all", label: "All" },
        { value: "human", label: "Humans" },
        { value: "agent", label: "Agents" },
      ]}
    />
  );
}

/** Desktop: three lanes that scroll on their own. */
export function LaunchedLanes({ tokens, loading, total, onHowItWorks, className }: { tokens: LaunchedToken[]; loading: boolean; total?: number; onHowItWorks?: () => void; className?: string }) {
  const [who, setWho] = useState<WhoFilter>("all");
  const grouped = useGrouped(tokens, who);
  const none = !loading && tokens.length === 0;
  return (
    <section className={cn("panel flex min-h-0 flex-col overflow-hidden", className)} aria-label="Launched on Claudio">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <SectionHead num="02" title="Launched on Claudio" className="shrink-0" />
          <p className="mono-label hidden truncate 2xl:block">
            {total ? `${total.toLocaleString()} coin${total === 1 ? "" : "s"} so far, by people and by agents` : "by people and by agents"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!none && <WhoToggle value={who} onChange={setWho} />}
          <Link href="/launch" className="btn btn-secondary h-9">
            Launch a coin
          </Link>
        </div>
      </header>
      <div className="grid shrink-0 grid-cols-3 divide-x divide-line border-b border-line">
        {LANES.map((lane) => (
          <div key={lane.phase} className="flex min-w-0 items-center gap-2 px-3 py-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PHASE_ACCENT[lane.phase] }} aria-hidden />
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-text-2">{lane.title}</span>
            <span className="num ml-auto text-[11px] text-text-3">{grouped[lane.phase].length}</span>
          </div>
        ))}
      </div>
      {none ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LaunchFirst onHowItWorks={onHowItWorks} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-line">
          {LANES.map((lane) => {
            const rows = grouped[lane.phase];
            return (
              <div key={lane.phase} className="flex min-h-0 min-w-0 flex-col gap-1.5 overflow-y-auto overscroll-contain p-2">
                {loading && tokens.length === 0
                  ? Array.from({ length: 5 }, (_, i) => <CardSkeleton key={i} />)
                  : rows.length === 0
                    ? <LaneEmptyState hint={lane.hint} filtered={who !== "all"} />
                    : rows.map((t) => <LaunchedCard key={t.key} t={t} />)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Phone: one lane at a time. */
export function LaunchedMobile({ tokens, loading, total, onHowItWorks }: { tokens: LaunchedToken[]; loading: boolean; total?: number; onHowItWorks?: () => void }) {
  const [who, setWho] = useState<WhoFilter>("all");
  const [phase, setPhase] = useState<TokenPhase>("new");
  const grouped = useGrouped(tokens, who);
  const rows = grouped[phase];
  const lane = LANES.find((l) => l.phase === phase)!;
  const none = !loading && tokens.length === 0;
  return (
    <section aria-label="Launched on Claudio" className="space-y-2.5">
      <div className="flex items-end justify-between gap-2 border-t border-line pt-4">
        <div className="min-w-0">
          <SectionHead num="02" title="Launched" />
          <p className="mono-label mt-2 !text-[10px]">{total ? `${total.toLocaleString()} so far, by people and agents` : "By people and by agents"}</p>
        </div>
        {!none && <WhoToggle value={who} onChange={setWho} />}
      </div>
      {none ? (
        <div className="panel">
          <LaunchFirst onHowItWorks={onHowItWorks} className="px-4 py-8" />
        </div>
      ) : (
        <>
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-[3px] p-[3px] ring-1 ring-inset ring-line-2">
            {LANES.map((l) => {
              const on = l.phase === phase;
              return (
                <button
                  key={l.phase}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  onClick={() => setPhase(l.phase)}
                  className={cn("flex h-10 items-center justify-center gap-1.5 rounded-[2px] font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors", on ? "bg-panel-3 text-text" : "text-text-3")}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: PHASE_ACCENT[l.phase] }} />
                  {l.short}
                  <span className="num text-[10.5px] text-text-3">{grouped[l.phase].length}</span>
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5">
            {loading && tokens.length === 0
              ? Array.from({ length: 4 }, (_, i) => <CardSkeleton key={i} />)
              : rows.length === 0
                ? <LaneEmptyState hint={lane.hint} filtered={who !== "all"} />
                : rows.slice(0, 8).map((t) => <LaunchedCard key={t.key} t={t} className="py-2.5" />)}
          </div>
          {rows.length > 8 && <p className="mono-label text-center !text-[10px]">Showing the top 8 of {rows.length}.</p>}
        </>
      )}
    </section>
  );
}
