// Wallet sheet: opened from any wallet in Holders / Top traders / Trades / Tracker feeds. Dialog on desktop, bottom drawer
// on phones. Shows GMGN's wallet profile (P&L, win rate, style, score, review) when available, and always the identity we
// already know, the trades Claudio has seen from this wallet, and a way to track it.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { create } from "zustand";
import { Check as CheckIcon, ExternalLink, Plus } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import type { FeedTrade, WalletIdentity } from "@shared/insights";
import type { Trade } from "@shared/types";
import { Age, CopyAddress, ResponsiveSheet, TokenAvatar } from "@/components/kit";
import { useBoard } from "@/lib/store";
import { fmtNative, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { normAddr } from "@/lib/wallet/keys";
import { useTracker } from "@/features/tracker/store";
import { useWalletProfile } from "./api";
import { countOrDash, isNum, ratioPct, shortWallet, signedUsd, tokenHrefOf } from "./format";
import { DataNote, ScoreBlock } from "./ui";
import { TAG_META, TAG_ORDER, ToolChips, WalletTagIcon } from "./WalletTags";

interface WalletSheetState {
  address: string | null;
  chain: ChainId;
  hint: Partial<WalletIdentity> | null;
  open: (address: string, hint?: Partial<WalletIdentity> | null, chain?: ChainId) => void;
  close: () => void;
}

export const useWalletSheet = create<WalletSheetState>((set) => ({
  address: null,
  chain: "sol",
  hint: null,
  open: (address, hint, chain = "sol") => set({ address, hint: hint ?? null, chain }),
  close: () => set({ address: null }),
}));

/** Opens the wallet sheet for an address (stable function, safe in memoized rows). */
export const openWallet = (address: string, hint?: Partial<WalletIdentity> | null, chain: ChainId = "sol") => useWalletSheet.getState().open(address, hint, chain);

function Cell({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "buy" | "sell" }) {
  return (
    <div className="min-w-0 bg-bg-elev px-3 py-2">
      <div className="truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">{label}</div>
      <div className={cn("num mt-1 truncate text-[14px] font-medium leading-none", tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : "text-text")}>{children}</div>
    </div>
  );
}

const EMPTY: Trade[] = [];

function useSeenTrades(address: string | null): Trade[] {
  const trades = useBoard((s) => s.trades);
  return useMemo(() => {
    if (!address) return EMPTY;
    const n = normAddr(address);
    const out: Trade[] = [];
    for (const k of Object.keys(trades)) for (const t of trades[k]) if (normAddr(t.trader) === n) out.push(t);
    return out.sort((a, b) => b.ts - a.ts).slice(0, 12);
  }, [trades, address]);
}

function TrackButton({ address, name }: { address: string; name?: string | null }) {
  const tracked = useTracker((s) => s.wallets.some((w) => normAddr(w.address) === normAddr(address)));
  const add = useTracker((s) => s.add);
  const [err, setErr] = useState<string | null>(null);
  return (
    <button
      type="button"
      disabled={tracked}
      onClick={() => {
        try {
          add({ address, label: name ?? undefined });
          setErr(null);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      }}
      title={err ?? undefined}
      className={cn(
        "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[3px] px-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.1em] transition-colors md:h-9",
        tracked ? "border border-line-2 text-text-3" : "bg-brand text-brand-ink hover:bg-brand/90",
      )}
    >
      {tracked ? <CheckIcon className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      {tracked ? "Tracking" : "Track wallet"}
    </button>
  );
}

function ActivityRow({ symbol, tokenKey, side, usd, sub, at }: { symbol: string; tokenKey: string; side: "buy" | "sell"; usd: number; sub?: string; at: number }) {
  const buy = side === "buy";
  const close = useWalletSheet((s) => s.close);
  return (
    <li>
      <Link href={tokenHrefOf(tokenKey)} onClick={close} className="flex items-center gap-2.5 rounded-[2px] px-1.5 py-1.5 hover:bg-panel-2">
        <TokenAvatar symbol={symbol} size={24} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12.5px]">
            <span className="truncate font-bold text-text">${symbol}</span>
            <span className={cn("chip px-1 py-[2px] text-[10px] font-semibold", buy ? "chip-buy" : "chip-sell")}>{buy ? "Buy" : "Sell"}</span>
          </span>
          {sub && <span className="num block truncate text-[10.5px] text-text-3">{sub}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className={cn("num block text-[12.5px] font-semibold", buy ? "text-buy" : "text-sell")}>{fmtUsd(usd)}</span>
          <Age from={at} className="block text-[10.5px] text-text-3" />
        </span>
      </Link>
    </li>
  );
}

function WalletBody({ address, chain, hint }: { address: string; chain: ChainId; hint: Partial<WalletIdentity> | null }) {
  const q = useWalletProfile(chain, address);
  const p = q.data ?? null;
  const seen = useSeenTrades(address);
  const tokens = useBoard((s) => s.tokens);
  const name = p?.name ?? hint?.name ?? null;
  const twitter = p?.twitter ?? hint?.twitter ?? null;
  const tags = (p?.tags?.length ? p.tags : hint?.tags) ?? [];
  const tools = (p?.tools?.length ? p.tools : hint?.tools) ?? [];
  const recent: FeedTrade[] = p?.recent ?? [];
  const realized = p?.realizedPnlUsd;
  const unrealized = p?.unrealizedPnlUsd;
  const close = useWalletSheet((s) => s.close);
  const c = CHAINS[chain];

  return (
    <div className="space-y-3.5 pb-1">
      {/* identity */}
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="display truncate text-[24px] text-text">{name ?? shortWallet(address, 5, 5)}</span>
            {tags.includes("kol") && <WalletTagIcon tag="kol" size={15} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-3">
            <CopyAddress address={address} head={5} tail={5} className="text-[11.5px] text-text-2" />
            {twitter && (
              <a href={`https://x.com/${twitter.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-text">
                @{twitter.replace(/^@/, "")}
              </a>
            )}
            {isNum(p?.xFollowers) && <span className="num">{countOrDash(p!.xFollowers)} followers</span>}
            <a href={c.explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text">
              Explorer <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {(tags.length > 0 || tools.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {TAG_ORDER.filter((t) => tags.includes(t)).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-[11.5px] text-text-2">
              <WalletTagIcon tag={t} size={13} />
              {TAG_META[t].label}
            </span>
          ))}
          <ToolChips tools={tools} max={4} />
        </div>
      )}

      {/* numbers */}
      {q.isLoading ? (
        <div className="sheen h-[104px] rounded-[3px] bg-panel-2" />
      ) : p ? (
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-line bg-line">
          <Cell label="Realized P&L" tone={isNum(realized) ? (realized > 0 ? "buy" : realized < 0 ? "sell" : undefined) : undefined}>
            {isNum(realized) ? signedUsd(realized) : "—"}
          </Cell>
          <Cell label="Unrealized" tone={isNum(unrealized) ? (unrealized > 0 ? "buy" : unrealized < 0 ? "sell" : undefined) : undefined}>
            {isNum(unrealized) ? signedUsd(unrealized) : "—"}
          </Cell>
          <Cell label="Win rate">{ratioPct(p.winRate, 0)}</Cell>
          <Cell label="Buys / sells 7d">
            <span className="text-buy">{countOrDash(p.buys7d)}</span>
            <span className="text-text-3"> / </span>
            <span className="text-sell">{countOrDash(p.sells7d)}</span>
          </Cell>
          <Cell label="Coins traded">{countOrDash(p.tokensTraded)}</Cell>
          <Cell label={`${c.nativeSymbol} balance`}>{isNum(p.nativeBalance) ? fmtNative(p.nativeBalance) : "—"}</Cell>
        </div>
      ) : (
        <p className="rounded-[3px] border border-dashed border-line px-3 py-3 text-[12px] leading-relaxed text-text-3">
          No wallet profile right now. You can still track this wallet and see the trades Claudio picks up from it.
        </p>
      )}

      {p?.style && (
        <div className="rounded-[3px] border border-line border-l-2 border-l-brand px-3 py-2.5">
          <div className="text-[13px] font-semibold text-text">{p.style.title}</div>
          {p.style.subtitle && <div className="mt-0.5 text-[12px] text-text-2">{p.style.subtitle}</div>}
          {p.style.badges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.style.badges.map((b) => (
                <span key={b} className="chip">
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {p?.score && <ScoreBlock score={p.score} label="Wallet score" />}
      {p?.review && <p className="text-[12.5px] leading-relaxed text-text-2">{p.review}</p>}

      {/* activity */}
      {(recent.length > 0 || seen.length > 0) && (
        <div>
          <div className="eyebrow mb-1">Recent activity</div>
          <ul className="-mx-1.5">
            {recent.length > 0
              ? recent.slice(0, 8).map((r, i) => (
                  <ActivityRow key={`${r.tx ?? r.at}-${i}`} symbol={r.symbol ?? "?"} tokenKey={r.tokenKey} side={r.side} usd={r.amountUsd} at={r.at} />
                ))
              : seen.map((t) => (
                  <ActivityRow
                    key={t.id}
                    symbol={tokens[t.key]?.symbol ?? "?"}
                    tokenKey={t.key}
                    side={t.side}
                    usd={t.amountUsd}
                    sub={`${fmtNative(t.amountNative)} ${CHAINS[t.chain].nativeSymbol} · MC ${fmtUsd(t.mcapUsd)}`}
                    at={t.ts}
                  />
                ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <TrackButton address={address} name={name} />
        <Link
          href="/tracker"
          onClick={close}
          className="btn btn-secondary h-10 flex-1 px-3 md:h-9"
        >
          Open Tracker
        </Link>
      </div>
      {p && <DataNote source={p ? "gmgn" : null} />}
    </div>
  );
}

/** Mount once per page that shows wallets. */
export function WalletSheetHost() {
  const address = useWalletSheet((s) => s.address);
  const chain = useWalletSheet((s) => s.chain);
  const hint = useWalletSheet((s) => s.hint);
  const close = useWalletSheet((s) => s.close);
  return (
    <ResponsiveSheet open={!!address} onOpenChange={(o) => !o && close()} title="Wallet" description={address ? `${CHAINS[chain].name} wallet` : undefined}>
      {address && <WalletBody key={address} address={address} chain={chain} hint={hint} />}
    </ResponsiveSheet>
  );
}
