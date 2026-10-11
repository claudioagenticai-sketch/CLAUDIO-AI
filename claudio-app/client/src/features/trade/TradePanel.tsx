// Buy/Sell order ticket: side switch, wallet + balances, amount with preset chips, execution preset (P1/P2/P3),
// live quote receipt and one clear primary button.
// Signing happens in the browser wallet; the server only prepares unsigned txs. Unsupported routes say so plainly.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Fuel, Loader2, Lock, Settings2, ShieldCheck, Wallet, Zap } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { LAUNCHPADS } from "@shared/launchpads";
import type { TokenSnapshot } from "@shared/types";
import { ChainLogo, ClaudioSpark } from "@/components/kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useBoard, useSettings, type ExecPreset } from "@/lib/store";
import { buy, sell } from "@/lib/trade";
import { TradeApiError } from "@/lib/trade-impl";
import { getActiveAccount, useNativeBalance, useWallet } from "@/lib/wallet";
import { fmtCompact, fmtNative, fmtPct, fmtUsd, shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRouteInfo, useTokenBalance, useTradeQuote } from "./useTradeData";

export type Side = "buy" | "sell";

export interface TradePanelProps {
  token: TokenSnapshot;
  initialSide?: Side;
  /** Bump `n` to switch side + focus the amount input (hotkeys B / S). */
  request?: { side: Side; n: number };
  /** Called after a trade was sent successfully (e.g. close the sheet). */
  onDone?: () => void;
  /** Render without panel chrome (inside a sheet). */
  bare?: boolean;
  className?: string;
}

const PRESETS: ExecPreset[] = ["P1", "P2", "P3"];
const SLIPPAGE_CHOICES = [500, 1000, 1500, 2500, 4900];

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// ─── Unsupported route card ─────────────────────────────────────────

export function UnsupportedRoute({ token, message, site }: { token: TokenSnapshot; message?: string; site?: string }) {
  const lp = LAUNCHPADS[token.launchpad];
  const url = site ?? lp.site;
  return (
    <div className="rounded-[3px] border border-dashed border-line-2 p-4 text-center">
      <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center text-warn">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="text-sm font-semibold text-text">Not tradable in Claudio yet</div>
      <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-text-3">
        {message ?? `Trading ${lp.name} tokens isn't wired yet.`} We never simulate a fill — use the launchpad directly for now.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-secondary mt-3.5 h-11 w-full"
      >
        Trade on {hostOf(url)} <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}

// ─── Execution preset row ───────────────────────────────────────────

function ExecRow({ token }: { token: TokenSnapshot }) {
  const active = useSettings((s) => s.activePreset);
  const presets = useSettings((s) => s.presets);
  const set = useSettings((s) => s.set);
  const chain = CHAINS[token.chain];
  const p = presets[active];
  const [custom, setCustom] = useState("");

  const setSlippage = (bps: number) => {
    const clamped = Math.max(10, Math.min(9_900, Math.round(bps)));
    set({ presets: { ...presets, [active]: { ...p, slippageBps: clamped } } });
  };

  let execNote: string;
  if (chain.ordering === "fcfs-sequencer") execNote = "FCFS sequencer: priority fees don't matter";
  else if (chain.ordering === "jito-bundles") execNote = `Prio ${fmtNative(p.priorityFee)} SOL · Tip ${fmtNative(p.jitoTip)} SOL`;
  else execNote = `Prio +${fmtNative(p.priorityFee)} gwei${p.mevProtect ? " · MEV protect" : ""}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="eyebrow mr-auto">Execution</span>
        <div className="flex rounded-[3px] p-0.5 ring-1 ring-inset ring-line-2" role="radiogroup" aria-label="Execution preset">
          {PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active === id}
              onClick={() => set({ activePreset: id })}
              className={cn(
                "num h-7 min-w-[36px] rounded-[2px] px-2 text-[11px] font-medium transition-colors",
                active === id ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2",
              )}
              title={`Preset ${id}: slippage ${fmtPct(presets[id].slippageBps / 100, 0)}`}
            >
              {id}
            </button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="num inline-flex h-8 items-center gap-1 rounded-[3px] border border-line px-2.5 text-[11px] text-text-2 transition-colors hover:border-line-2 hover:text-text"
              title="Slippage tolerance"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Slip {fmtPct(p.slippageBps / 100, p.slippageBps % 100 ? 1 : 0)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 rounded-[4px] border-line-2 bg-bg-elev p-3">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-2">Slippage · {active}</div>
            <div className="grid grid-cols-5 gap-1">
              {SLIPPAGE_CHOICES.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippage(bps)}
                  className={cn(
                    "num h-9 rounded-[2px] border text-[11px] transition-colors",
                    p.slippageBps === bps ? "border-brand bg-brand text-brand-ink" : "border-line text-text-2 hover:border-line-2 hover:text-text",
                  )}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                inputMode="decimal"
                placeholder="Custom %"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && parseNum(custom) > 0) setSlippage(parseNum(custom) * 100);
                }}
                className="num h-9 min-w-0 flex-1 rounded-[3px] border border-line-2 bg-bg px-2 text-xs text-text outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={!(parseNum(custom) > 0)}
                onClick={() => setSlippage(parseNum(custom) * 100)}
                className="btn btn-secondary h-9 px-3 disabled:opacity-40"
              >
                Set
              </button>
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-text-3">
              Memecoins move fast; too-low slippage fails, too-high invites worse fills. Other preset fields live in Settings.
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center gap-1.5 text-[10.5px] text-text-3">
        {chain.ordering === "fcfs-sequencer" ? <Zap className="h-3 w-3 shrink-0 text-brand" /> : <Fuel className="h-3 w-3 shrink-0" />}
        <span className="truncate">{execNote}</span>
      </div>
    </div>
  );
}

// ─── Quote preview ──────────────────────────────────────────────────

function QuoteRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[21px] items-center justify-between gap-2 text-[11.5px]", className)}>
      <span className="text-text-3">{label}</span>
      <span className="num text-right text-text-2">{children}</span>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────

export default function TradePanel({ token, initialSide = "buy", request, onDone, bare = false, className }: TradePanelProps) {
  const reduce = useReducedMotion();
  const uid = useId();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const chain = CHAINS[token.chain];

  const [side, setSide] = useState<Side>(initialSide);
  const quickBuyPresets = useSettings((s) => s.quickBuyPresets[token.chain]);
  const defaultBuy = useSettings((s) => s.quickBuy[token.chain]);
  const sellPresets = useSettings((s) => s.sellPresets);
  const slippageBps = useSettings((s) => s.presets[s.activePreset].slippageBps);
  const [buyText, setBuyText] = useState<string>(() => String(defaultBuy ?? quickBuyPresets?.[1] ?? ""));
  const [sellText, setSellText] = useState<string>("50");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hotkey requests from the page.
  useEffect(() => {
    if (!request) return;
    setSide(request.side);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(t);
  }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wallet (subscribe to store changes, then resolve through the contract helper).
  useWallet((s) => s.active);
  useWallet((s) => s.accounts);
  const unlocked = useWallet((s) => s.unlocked);
  const account = getActiveAccount(chain.kind);
  const native = useNativeBalance(token.chain, account?.address);
  const bal = useTokenBalance(token, account?.address);
  const nativeUsd = useBoard((s) => s.status[token.chain]?.nativeUsd ?? 0);

  const route = useRouteInfo(token);
  const unsupported = route.data?.supported === false;

  const amount = side === "buy" ? parseNum(buyText) : Math.min(100, parseNum(sellText));
  const q = useTradeQuote({ token, side, amount, trader: account?.address, slippageBps, enabled: route.data?.supported === true });
  const quoteErr = q.error;
  const quoteUnsupported = quoteErr?.code === "route_unsupported";

  const tokenBal = bal.data;
  const holdingsUsd = tokenBal !== undefined ? tokenBal * token.priceUsd : undefined;

  // Validation → button state.
  const problem = useMemo<string | null>(() => {
    if (!account) return null; // handled by the "set up wallet" button
    if (side === "buy") {
      if (!(amount > 0)) return "Enter an amount";
      if (native.balance !== undefined && amount > native.balance) return `Insufficient ${chain.nativeSymbol}`;
    } else {
      if (!(amount > 0)) return "Choose an amount";
      if (tokenBal !== undefined && tokenBal <= 0) return `No ${token.symbol} to sell`;
    }
    return null;
  }, [account, side, amount, native.balance, chain.nativeSymbol, tokenBal, token.symbol]);

  const submit = async () => {
    if (busy) return;
    if (!account) {
      navigate("/wallets");
      return;
    }
    if (problem || unsupported) return;
    setBusy(true);
    try {
      const res = side === "buy" ? await buy(token, amount) : await sell(token, amount);
      if (res.ok) {
        const hash = res.hashes[res.hashes.length - 1];
        const url = chain.explorerTx(hash);
        toast({
          title: side === "buy" ? `Buy sent · ${token.symbol}` : `Sell sent · ${token.symbol}`,
          description:
            side === "buy"
              ? `${fmtNative(amount)} ${chain.nativeSymbol} → ${token.symbol}. Waiting for confirmation.`
              : `${fmtPct(amount, 0)} of your ${token.symbol}. Waiting for confirmation.`,
          action: (
            <ToastAction altText="View on explorer" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
              View
            </ToastAction>
          ),
        });
        void qc.invalidateQueries({ queryKey: ["trade-balance", token.key] });
        window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["trade-balance", token.key] }), 3_000);
        onDone?.();
      } else {
        toast({ variant: "destructive", title: side === "buy" ? "Buy failed" : "Sell failed", description: res.error ?? "Unknown error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  const isBuy = side === "buy";
  const quote = q.data;
  const showQuote = !unsupported && q.enabled && !!(quote || q.isFetching || quoteErr);

  let cta: string;
  if (!account) cta = `Set up ${chain.kind === "svm" ? "Solana" : "EVM"} wallet`;
  else if (busy) cta = isBuy ? "Signing buy…" : "Signing sell…";
  else if (problem) cta = problem;
  else cta = isBuy ? `Buy ${fmtNative(amount)} ${chain.nativeSymbol}` : `Sell ${fmtPct(amount, 0)} ${token.symbol}`;
  const ctaDisabled = busy || (!!account && (!!problem || unsupported || quoteUnsupported));

  const body = (
    <div className="space-y-3">
      {/* Side switch */}
      <div className="relative grid grid-cols-2 gap-1 rounded-[3px] p-[3px] ring-1 ring-inset ring-line-2" role="tablist" aria-label="Trade side">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={cn(
              "relative z-[1] flex h-10 items-center justify-center rounded-[2px] font-mono text-[12px] font-medium uppercase tracking-[0.14em] transition-colors",
              side === s ? (s === "buy" ? "text-buy" : "text-sell") : "text-text-3 hover:text-text-2",
            )}
          >
            {side === s && (
              <motion.span
                layoutId={`side-pill-${uid}`}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
                className={cn(
                  "absolute inset-0 -z-[1] rounded-[2px] ring-1 ring-inset",
                  s === "buy" ? "bg-buy-bg ring-buy/35" : "bg-sell-bg ring-sell/35",
                )}
              />
            )}
            {s}
            <kbd className="ml-1.5 hidden rounded border border-current px-1 text-[9px] font-medium leading-[14px] opacity-40 lg:inline">{s === "buy" ? "B" : "S"}</kbd>
          </button>
        ))}
      </div>

      {/* Wallet */}
      <div className="overflow-hidden rounded-[3px] border border-line">
        <div className="flex h-9 items-center gap-2 px-3 text-[11.5px]">
          <Wallet className="h-3.5 w-3.5 shrink-0 text-text-3" />
          {account ? (
            <>
              <span className="min-w-0 truncate font-medium text-text-2" title={account.address}>
                {account.label || shortAddr(account.address)}
              </span>
              {!unlocked && account.source === "local" && <Lock className="h-3 w-3 shrink-0 text-warn" aria-label="Locked" />}
              <span className="num ml-auto shrink-0 font-semibold text-text">
                {native.loading && native.balance === undefined ? "…" : native.balance !== undefined ? fmtNative(native.balance) : "—"}{" "}
                <span className="font-normal text-text-3">{chain.nativeSymbol}</span>
              </span>
            </>
          ) : (
            <span className="text-text-3">No {chain.kind === "svm" ? "Solana" : "EVM"} wallet</span>
          )}
        </div>
        {account && (
          <div className="flex h-8 items-center justify-between border-t border-dashed border-line px-3 text-[11px] text-text-3">
            <span>You hold</span>
            <span className="num text-text-2">
              {bal.isLoading ? "…" : tokenBal !== undefined ? `${fmtCompact(tokenBal, 2)} ${token.symbol}` : "—"}
              {holdingsUsd !== undefined && holdingsUsd > 0 && <span className="text-text-3"> · {fmtUsd(holdingsUsd)}</span>}
            </span>
          </div>
        )}
      </div>

      {unsupported || quoteUnsupported ? (
        <UnsupportedRoute token={token} message={quoteUnsupported ? quoteErr?.message : route.data?.message} site={quoteUnsupported ? quoteErr?.site : route.data?.site} />
      ) : (
        <>
          {/* Amount */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={side}
              initial={reduce ? false : { opacity: 0, x: isBuy ? -8 : 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: isBuy ? 8 : -8 }}
              transition={{ duration: 0.14 }}
              className="space-y-2"
            >
              <label
                className={cn(
                  "flex h-12 items-center gap-2 rounded-[3px] border border-line-2 bg-bg px-3.5 transition-colors",
                  isBuy ? "focus-within:border-buy/60" : "focus-within:border-sell/60",
                )}
              >
                <span className="eyebrow">{isBuy ? "Amount" : "Sell"}</span>
                <input
                  ref={inputRef}
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={isBuy ? `Amount in ${chain.nativeSymbol}` : "Percent of balance to sell"}
                  value={isBuy ? buyText : sellText}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.,]/g, "");
                    if (isBuy) setBuyText(v);
                    else setSellText(v);
                  }}
                  onKeyDown={onKey}
                  className="num min-w-0 flex-1 bg-transparent text-right text-[20px] font-medium text-text outline-none placeholder:text-text-3"
                  placeholder="0"
                />
                <span className="num shrink-0 rounded-[2px] px-1.5 py-1 text-[11px] leading-none text-text-2 ring-1 ring-inset ring-line-2">{isBuy ? chain.nativeSymbol : "%"}</span>
              </label>
              {isBuy ? (
                <div className="grid grid-cols-5 gap-1.5">
                  {(quickBuyPresets ?? []).slice(0, 5).map((v) => {
                    const on = parseNum(buyText) === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setBuyText(String(v))}
                        className={cn(
                          "num h-9 rounded-[2px] border text-[11.5px] font-medium transition-colors",
                          on ? "border-buy/50 bg-buy-bg text-buy" : "border-line text-text-2 hover:border-line-2 hover:text-text",
                        )}
                      >
                        {fmtNative(v)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {sellPresets.slice(0, 4).map((v) => {
                    const on = parseNum(sellText) === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSellText(String(v))}
                        className={cn(
                          "num h-9 rounded-[2px] border text-[11.5px] font-medium transition-colors",
                          on ? "border-sell/50 bg-sell-bg text-sell" : "border-line text-text-2 hover:border-line-2 hover:text-text",
                        )}
                      >
                        {v === 100 ? "MAX" : `${v}%`}
                      </button>
                    );
                  })}
                </div>
              )}
              {!isBuy && tokenBal !== undefined && tokenBal > 0 && amount > 0 && (
                <div className="px-1 text-right text-[11px] text-text-3">
                  ≈ <span className="num text-text-2">{fmtCompact((tokenBal * amount) / 100, 2)}</span> {token.symbol}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <ExecRow token={token} />

          {/* Quote */}
          <AnimatePresence initial={false}>
            {showQuote && (
              <motion.div
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduce ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className={cn("relative rounded-[3px] border border-line px-3 py-2.5", (q.isFetching || q.debouncing) && "sheen")}>
                  {quoteErr && !quote ? (
                    <div className="flex items-start gap-1.5 text-[11.5px] text-warn">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{quoteErr.message}</span>
                    </div>
                  ) : quote ? (
                    <>
                      <div className="flex items-start justify-between gap-2 pb-1.5">
                        <span className="eyebrow pt-1">You receive</span>
                        <div className="min-w-0 text-right">
                          <div className="num text-[15px] font-medium text-text">
                            {quote.estimate ? "≈ " : ""}
                            {isBuy ? `${fmtCompact(quote.expectedOut, 2)} ${token.symbol}` : `${fmtNative(quote.expectedOut)} ${chain.nativeSymbol}`}
                          </div>
                          <div className="text-[10.5px] text-text-3">
                            {isBuy
                              ? token.priceUsd > 0 && <span className="num">≈ {fmtUsd(quote.expectedOut * token.priceUsd, 2)}</span>
                              : nativeUsd > 0 && <span className="num">≈ {fmtUsd(quote.expectedOut * nativeUsd, 2)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-dashed border-line-2 pt-1.5">
                        <QuoteRow label="Min received">
                          {isBuy ? `${fmtCompact(quote.minOut, 2)} ${token.symbol}` : `${fmtNative(quote.minOut)} ${chain.nativeSymbol}`}
                        </QuoteRow>
                        <QuoteRow label="Price impact">
                          <span className={cn(quote.priceImpactPct > 15 ? "text-sell" : quote.priceImpactPct > 5 ? "text-warn" : "text-text-2")}>
                            {quote.priceImpactPct < 0.01 ? "<0.01%" : fmtPct(quote.priceImpactPct, 2)}
                          </span>
                        </QuoteRow>
                        <QuoteRow label="Fees">
                          {fmtNative(quote.feeNative)} {chain.nativeSymbol}
                        </QuoteRow>
                        {quote.taxPct > 0 && (
                          <QuoteRow label="Tax">
                            <span className="text-warn">{fmtPct(quote.taxPct, quote.taxPct % 1 ? 2 : 0)}</span>
                          </QuoteRow>
                        )}
                        <QuoteRow label="Route">
                          <span className="inline-flex items-center gap-1">
                            {quote.route}
                            {quote.estimate && <span className="chip chip-info px-1 py-[2px] text-[9.5px]">estimate</span>}
                          </span>
                        </QuoteRow>
                      </div>
                      {quote.warnings && quote.warnings.length > 0 && (
                        <ul className="space-y-0.5 pt-1.5">
                          {quote.warnings.map((w) => (
                            <li key={w} className="flex gap-1 text-[10.5px] leading-snug text-warn">
                              <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <div className="h-16" />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!isBuy && !account && <p className="px-1 text-[11px] text-text-3">Add a wallet to preview sells.</p>}
          {route.error && (
            <p className="flex items-start gap-1 px-1 text-[11px] text-warn">
              <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
              {route.error.message}
            </p>
          )}
        </>
      )}

      {/* CTA */}
      {!(unsupported || quoteUnsupported) && (
        <motion.button
          type="button"
          whileTap={reduce || ctaDisabled ? undefined : { scale: 0.98 }}
          onClick={() => void submit()}
          disabled={ctaDisabled}
          className={cn(
            "relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-[3px] font-mono text-[13px] font-medium uppercase tracking-[0.12em] transition-[filter,opacity]",
            !account
              ? "bg-brand text-brand-ink hover:brightness-105"
              : isBuy
                ? "bg-buy text-buy-ink hover:brightness-110"
                : "bg-sell text-sell-ink hover:brightness-110",
            ctaDisabled && "cursor-not-allowed opacity-50 hover:brightness-100",
          )}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {cta}
        </motion.button>
      )}

      {bare && (
        <div className="flex items-center justify-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
          <ShieldCheck className="h-3 w-3" />
          Non-custodial · signed on this device
        </div>
      )}
    </div>
  );

  if (bare) return <div className={className}>{body}</div>;
  return (
    <div className={cn("panel overflow-hidden", className)}>
      <div className="flex h-10 items-center justify-between gap-2 border-b border-line px-3.5">
        <span className="flex min-w-0 items-center gap-2">
          <ClaudioSpark />
          <span className="truncate font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-2">Trade {token.symbol}</span>
          <ChainLogo chain={token.chain} size={12} className="shrink-0" />
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3" title="Non-custodial · signed on this device">
          <ShieldCheck className="h-3 w-3" />
          Signed on this device
        </span>
      </div>
      <div className="p-3.5">{body}</div>
    </div>
  );
}
