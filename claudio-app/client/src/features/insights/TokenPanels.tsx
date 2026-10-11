// Coin page insights: the signals bar (badges + chart pattern chip), the Safety panel and the Dev panel.
// Scores (/scores, /dev) load only once their panel scrolls into view. Without insights each panel shows our own numbers.
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { SignalKind, TokenInsights, TokenSignal } from "@shared/insights";
import type { TokenSnapshot } from "@shared/types";
import { useNow } from "@/components/kit";
import { fmtAge, fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDevProfile, useTokenScores } from "./api";
import { isNum, ratioPct, tokenHrefOf, usdOrDash } from "./format";
import { Check, CopyButton, DataNote, InsightPanel, Row, ScoreBlock, ScoreChip } from "./ui";
import { openWallet } from "./WalletSheet";

/** True once the element has been on screen (stays true). */
export function useSeen<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

// ─── signals ────────────────────────────────────────────────────────

const SIGNAL_TONE: Partial<Record<SignalKind, string>> = {
  smart_buy: "chip-buy",
  kol_buy: "chip-buy",
  ath: "bg-gold-bg text-gold",
  mcap_level: "bg-gold-bg text-gold",
  price_spike: "chip-warn",
  dex_ad: "chip-info",
  dex_boost: "chip-info",
  dex_trending: "chip-info",
  dex_link: "chip-info",
  cto: "chip-brand",
  bundler_sell: "chip-sell",
  pump_claim: "chip-copper",
  bags_claim: "chip-copper",
  live: "chip-brand",
};

export function SignalBadge({ s, now }: { s: TokenSignal; now: number }) {
  const tip = [s.label, s.detail, isNum(s.mcapUsd) ? `at MC ${fmtUsd(s.mcapUsd)}` : null].filter(Boolean).join("\n");
  return (
    <span className={cn("chip shrink-0 whitespace-nowrap py-1 font-semibold", SIGNAL_TONE[s.kind])} data-tip={tip}>
      {s.label}
      <span className="num font-medium opacity-70">{fmtAge(s.at, now)}</span>
    </span>
  );
}

/** Signals + chart pattern + attribution, one scrollable row. Renders nothing without insights. */
export function SignalsBar({ token, insights, className }: { token: TokenSnapshot; insights?: TokenInsights | null; className?: string }) {
  const now = useNow();
  // The chart-pattern chip needs /scores; fetch once the fast set says insights exist (shared with the Safety panel).
  const scores = useTokenScores(token.key, !!insights).data;
  const signals = [...(insights?.signals ?? [])].sort((a, b) => b.at - a.at).slice(0, 8);
  const chart = scores?.chart && scores.chart.grade !== "unknown" ? scores.chart : undefined;
  if (!insights && !chart) return null;
  if (!signals.length && !chart && !insights?.partial) return null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {chart && <ScoreChip score={chart} label={chart.pattern || chart.title} className="chip-info" />}
        {signals.map((s, i) => (
          <SignalBadge key={`${s.kind}-${s.at}-${i}`} s={s} now={now} />
        ))}
      </div>
      <DataNote source={insights?.source ?? "gmgn"} partial={insights?.partial} className="hidden shrink-0 md:inline-flex" />
    </div>
  );
}

// ─── safety ─────────────────────────────────────────────────────────

export function SafetyPanel({ token, insights, className }: { token: TokenSnapshot; insights?: TokenInsights | null; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const scores = useTokenScores(token.key, seen && !!insights);
  const sec = insights?.security;
  const safety = scores.data?.safety;
  const top10 = sec?.top10Pct ?? insights?.stats.top10Pct;
  const buyTax = isNum(sec?.buyTaxPct) ? sec!.buyTaxPct! : token.buyTaxBps / 100;
  const sellTax = isNum(sec?.sellTaxPct) ? sec!.sellTaxPct! : token.sellTaxBps / 100;
  const warnings = sec?.warnings ?? [];
  const burn = sec?.burnRatio;

  return (
    <div ref={ref} className={className}>
      <InsightPanel title="Safety" right={insights ? <DataNote source={insights.source} /> : undefined} className="h-full">
        {safety ? (
          <ScoreBlock score={safety} label="Safety" className="mb-2 border-b border-line pb-2.5" />
        ) : scores.isLoading && seen && insights ? (
          <div className="sheen mb-2 h-[42px] rounded-[2px] bg-panel-2" />
        ) : null}
        {sec && (
          <>
            <Row label="Mint renounced" tip="Nobody can mint more tokens">
              <Check ok={sec.mintRenounced} />
            </Row>
            <Row label="Freeze renounced" tip="Nobody can freeze your tokens">
              <Check ok={sec.freezeRenounced} />
            </Row>
            <Row label="Honeypot" tip="Can holders sell?">
              <Check ok={sec.honeypot == null ? null : !sec.honeypot} yes="No" no="Yes, can't sell" />
            </Row>
            {sec.blacklist != null && (
              <Row label="Blacklist">
                <Check ok={!sec.blacklist} yes="No" no="Yes" />
              </Row>
            )}
          </>
        )}
        <Row label="Buy / sell tax">
          <span className={cn("num", (buyTax > 0 || sellTax > 0) && "text-warn")}>
            {fmtPct(buyTax, buyTax % 1 ? 1 : 0)} / {fmtPct(sellTax, sellTax % 1 ? 1 : 0)}
          </span>
        </Row>
        <Row label="Top 10 hold">
          {(() => {
            const v = isNum(top10) ? top10 * 100 : token.top10Pct;
            return <span className={cn("num", v >= 50 ? "text-sell" : v >= 30 ? "text-warn" : "text-text-2")}>{v > 0 ? fmtPct(v, 1) : "—"}</span>;
          })()}
        </Row>
        {sec && (isNum(burn) || sec.lpLocked != null) && (
          <Row label="Liquidity" tip="Burned or locked liquidity can't be pulled">
            {isNum(burn) && burn > 0 ? (
              <span className="text-buy">{ratioPct(burn, 0)} burned</span>
            ) : sec.lpLocked ? (
              <span className="text-buy">Locked</span>
            ) : (
              <span className="text-warn">Not locked</span>
            )}
          </Row>
        )}
        {!sec && (
          <Row label="Dev holds">
            <span className={cn("num", token.devHoldPct >= 10 ? "text-sell" : token.devHoldPct >= 5 ? "text-warn" : "text-text-2")}>{fmtPct(token.devHoldPct, 1)}</span>
          </Row>
        )}
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {warnings.slice(0, 5).map((w) => (
              <li key={w} className="border-l-2 border-warn px-2 py-1 text-[11.5px] text-warn">
                {w}
              </li>
            ))}
          </ul>
        )}
        {!sec && <p className="mt-2 text-[11px] leading-snug text-text-3">Contract checks (mint, freeze, honeypot) show here when token data is available.</p>}
      </InsightPanel>
    </div>
  );
}

// ─── dev ────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; cls: string }> = {
  holding: { label: "Still holding", cls: "text-buy" },
  sold: { label: "Sold", cls: "text-sell" },
  closed: { label: "Sold everything", cls: "text-sell" },
  unknown: { label: "—", cls: "text-text-3" },
};

export function DevPanel({ token, insights, className }: { token: TokenSnapshot; insights?: TokenInsights | null; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const prof = useDevProfile(token.key, seen && !!insights);
  const p = prof.data;
  const d = p?.summary ?? insights?.dev ?? null;
  const address = d?.address || token.creator;
  const launches = d?.launches ?? token.devLaunches;
  const migrated = d?.migrated ?? token.devMigrations;
  const ratio = d ? d.migratedRatio : launches > 0 ? migrated / launches : null;
  const holds = d && isNum(d.holdsPct) ? d.holdsPct * 100 : token.devHoldPct;
  const status = d?.status ?? (token.devSold ? "sold" : holds > 0 ? "holding" : "unknown");
  const st = STATUS[status] ?? STATUS.unknown;

  return (
    <div ref={ref} className={className}>
      <InsightPanel title="Dev" right={d && insights ? <DataNote source={insights.source} /> : undefined} className="h-full">
        {p ? (
          <div className="mb-2 space-y-2 border-b border-line pb-2.5">
            <ScoreBlock score={p.total} label="Dev score" />
            <ScoreBlock score={p.conduct} label="Conduct" />
            <ScoreBlock score={p.power} label="Track record" />
          </div>
        ) : prof.isLoading && seen && insights ? (
          <div className="sheen mb-2 h-[42px] rounded-[2px] bg-panel-2" />
        ) : null}
        {address && (
          <Row label="Creator">
            <span className="inline-flex items-center gap-1">
              <button type="button" onClick={() => openWallet(address, { tags: ["dev"] }, token.chain)} className="num text-text-2 hover:text-text">
                {address.slice(0, 4)}…{address.slice(-4)}
              </button>
              <CopyButton value={address} />
            </span>
          </Row>
        )}
        <Row label="Coins launched">
          <span className="num">{launches || "—"}</span>
        </Row>
        <Row label="Graduated">
          <span className={cn("num", migrated > 0 ? "text-buy" : "text-text-2")}>
            {migrated}
            {ratio != null && launches > 0 && <span className="text-text-3"> · {ratioPct(ratio, 0)}</span>}
          </span>
        </Row>
        {d && isNum(d.bestMcapUsd) && (
          <Row label="Best market cap">
            <span className="num">{usdOrDash(d.bestMcapUsd)}</span>
          </Row>
        )}
        <Row label="Holds now">
          <span className={cn("num", holds >= 10 ? "text-sell" : holds >= 5 ? "text-warn" : "text-text-2")}>{fmtPct(holds, 1)}</span>
          <span className={cn("ml-1.5", st.cls)}>{status !== "unknown" ? `· ${st.label}` : ""}</span>
        </Row>
        {d?.fundedBy && (
          <Row label="Funded by" tip="Where the dev wallet's first SOL came from">
            <span className="inline-flex items-center gap-1">
              <button type="button" onClick={() => openWallet(d.fundedBy!, null, token.chain)} className="num text-text-2 hover:text-text">
                {d.fundedBy.length > 12 ? `${d.fundedBy.slice(0, 4)}…${d.fundedBy.slice(-4)}` : d.fundedBy}
              </button>
              {d.fundedBy.length > 12 && <CopyButton value={d.fundedBy} />}
            </span>
          </Row>
        )}
        {d && isNum(d.rugRatio) ? (
          <Row label="Rugged before" tip="Share of the dev's past coins that were rugged">
            <span className={cn("num", d.rugRatio >= 0.3 ? "text-sell" : d.rugRatio > 0 ? "text-warn" : "text-buy")}>{ratioPct(d.rugRatio, 0)}</span>
          </Row>
        ) : token.devRugs > 0 ? (
          <Row label="Rugged before">
            <span className="num text-sell">{token.devRugs}</span>
          </Row>
        ) : null}
        {p && p.coins.length > 0 && (
          <div className="mt-2">
            <div className="eyebrow mb-1">Other coins</div>
            <ul className="space-y-0.5">
              {p.coins.slice(0, 4).map((c) => (
                <li key={c.address}>
                  <Link href={tokenHrefOf(`${token.chain}:${c.address}`)} className="flex min-h-[28px] items-center justify-between gap-2 rounded-[2px] px-1 py-0.5 text-[12px] hover:bg-panel-2">
                    <span className="min-w-0 truncate font-semibold text-text-2">${c.symbol ?? c.address.slice(0, 4)}</span>
                    <span className="num shrink-0 text-text-3">
                      {c.migrated && <span className="mr-1.5 text-info">graduated</span>}
                      ATH {usdOrDash(c.athMcapUsd)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!address && <p className="text-[12px] text-text-3">Creator unknown.</p>}
        {address && !d && (
          <p className="mt-2 text-[11px] leading-snug text-text-3">Dev history across launchpads shows here when token data is available.</p>
        )}
      </InsightPanel>
    </div>
  );
}

