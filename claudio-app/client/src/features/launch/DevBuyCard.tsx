// Dev buy amount (chain presets + custom) and the signing wallet.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { deploymentOf, type LaunchpadId } from "@shared/launchpads";
import { CopyAddress } from "@/components/kit";
import { fmtNative, fmtUsd } from "@/lib/format";
import { haptic, useSettings } from "@/lib/store";
import { cn } from "@/lib/utils";
import { openWalletPrompt, useActiveAccount, useNativeBalance } from "@/lib/wallet";
import { Callout, FieldLabel } from "./ui";

/** Minimum dev buy per launchpad (Pons LaunchAndBuy requires quoteIn > 0). */
export function minDevBuy(launchpad?: LaunchpadId): number {
  return launchpad === "pons" ? 0.0001 : 0;
}

/** Rough gas/rent reserve so the user doesn't try to spend their whole balance. */
export function gasReserve(chain: ChainId): number {
  return chain === "sol" ? 0.03 : chain === "hood" ? 0.0005 : 0.003;
}

export function DevBuyCard({
  chain,
  launchpad,
  value,
  onChange,
  nativeUsd,
}: {
  chain: ChainId;
  launchpad?: LaunchpadId;
  value: number;
  onChange: (v: number) => void;
  nativeUsd?: number;
}) {
  const presets = useSettings((s) => s.quickBuyPresets[chain]) ?? [];
  const c = CHAINS[chain];
  const [custom, setCustom] = useState<string>(presets.includes(value) ? "" : value ? String(value) : "");
  const min = minDevBuy(launchpad);
  const launchFee = launchpad ? deploymentOf(launchpad, chain)?.launchFeeNative ?? 0 : 0;

  useEffect(() => {
    if (presets.includes(value)) setCustom("");
  }, [value, presets]);

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel
          label={`Dev buy (${c.nativeSymbol})`}
          hint={min > 0 ? <span className="text-text-3">min {min}</span> : <span className="text-text-3">optional</span>}
        />
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(64px,1fr))]">
          {min === 0 && (
            <PresetBtn active={value === 0 && !custom} onClick={() => onChange(0)}>
              None
            </PresetBtn>
          )}
          {presets.map((p) => (
            <PresetBtn
              key={p}
              active={value === p && !custom}
              onClick={() => {
                haptic();
                onChange(p);
              }}
            >
              {p}
            </PresetBtn>
          ))}
        </div>
        <div className="relative mt-2">
          <input
            value={custom}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".").replace(/[^0-9.]/g, "");
              setCustom(v);
              const n = Number(v);
              if (Number.isFinite(n)) onChange(n);
            }}
            inputMode="decimal"
            placeholder="Custom amount"
            className={cn(
              "num h-12 w-full rounded-[3px] border bg-bg px-3.5 pr-16 text-[16px] font-medium outline-none transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-[14px] placeholder:font-normal placeholder:text-text-3 focus:ring-1 focus:ring-brand md:h-11 md:text-[15px]",
              custom ? "border-brand" : "border-line-2 hover:border-text-3/60 focus:border-brand",
            )}
          />
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">{c.nativeSymbol}</span>
        </div>
        {nativeUsd && value > 0 ? <div className="num mt-1 text-right text-[11px] text-text-3">≈ {fmtUsd(value * nativeUsd, 2)}</div> : null}
        {min > 0 && value < min && (
          <Callout tone="warn" icon={<AlertTriangle />} className="mt-2">
            This launchpad launches through a buy — set at least <b>{min} {c.nativeSymbol}</b>.
          </Callout>
        )}
      </div>
      <WalletRow chain={chain} spend={value + launchFee + gasReserve(chain)} />
    </div>
  );
}

function PresetBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "num relative h-10 rounded-[3px] border text-[13px] font-medium transition-colors",
        active ? "border-buy/60 bg-buy-bg text-buy" : "border-line text-text-2 hover:border-line-2 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

export function WalletRow({ chain, spend }: { chain: ChainId; spend: number }) {
  const c = CHAINS[chain];
  const acct = useActiveAccount(c.kind);
  const { balance, loading } = useNativeBalance(chain, acct?.address);
  const short = balance !== undefined && balance < spend;
  if (!acct) {
    return (
      <button
        type="button"
        onClick={() => openWalletPrompt(`Launch on ${c.short}`)}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-[3px] border border-dashed border-line-2 px-3 text-left transition-colors hover:border-brand/60"
      >
        <span className="flex-1">
          <span className="block text-[13px] font-semibold">No {c.kind === "evm" ? "EVM" : "Solana"} wallet</span>
          <span className="block text-[11px] text-text-3">Create or connect one to sign the launch.</span>
        </span>
        <ChevronRight className="h-4 w-4 text-text-3" />
      </button>
    );
  }
  return (
    <div className={cn("rounded-[3px] border px-3 py-2.5", short ? "border-sell" : "border-line")}>
      <div className="flex min-h-[36px] items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span className="truncate">{acct.label}</span>
            {acct.source === "injected" && <span className="chip px-1 py-[1px] text-[9px]">EXT</span>}
          </div>
          <CopyAddress address={acct.address} head={5} tail={5} />
        </div>
        <div className="text-right">
          <div className={cn("num text-[13px] font-semibold", short ? "text-sell" : "text-text")}>
            {loading ? "…" : balance !== undefined ? fmtNative(balance) : "—"} <span className="text-[11px] text-text-3">{c.nativeSymbol}</span>
          </div>
          <Link href="/wallets" className="text-[11px] text-text-3 hover:text-text">
            Switch ›
          </Link>
        </div>
      </div>
      {short && (
        <div className="mt-1 text-[11px] text-sell">
          Needs ~{fmtNative(spend)} {c.nativeSymbol} incl. fees & gas.
        </div>
      )}
    </div>
  );
}
