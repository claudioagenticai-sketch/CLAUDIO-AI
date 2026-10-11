// Review step: exact amounts, the transactions you'll sign, simulation result and every warning.
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, FileSignature, KeyRound, Loader2, Rocket, ShieldAlert, XCircle } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { LAUNCHPADS } from "@shared/launchpads";
import { CopyAddress, LaunchpadBadge, TokenAvatar } from "@/components/kit";
import { fmtCompact, fmtNative, fmtPct, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlanResponse } from "./api";
import type { FlowState } from "./useLaunchFlow";
import { Callout, KV, TargetRings } from "./ui";
import { SOCIAL_PROVIDER_LABEL } from "@shared/social";

export function ReviewPanel({
  flow,
  imageUrl,
  nativeUsd,
  balance,
  onConfirm,
  onBack,
  ack,
  setAck,
  showActions = true,
}: {
  flow: FlowState;
  imageUrl?: string;
  nativeUsd?: number;
  balance?: number;
  onConfirm: () => void;
  onBack: () => void;
  /** Controlled so a sticky mobile CTA outside the panel can read it. */
  ack: boolean;
  setAck: (v: boolean) => void;
  showActions?: boolean;
}) {
  const res = flow.plan;
  if (flow.phase === "preparing" || !res) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
        {flow.error ? (
          <>
            <XCircle className="h-8 w-8 text-sell" />
            <div className="max-w-sm text-[13px] text-text-2">{flow.error}</div>
            <button type="button" onClick={onBack} className="btn btn-secondary h-10">
              Back to edit
            </button>
          </>
        ) : (
          <>
            <span className="relative flex h-20 w-20 items-center justify-center">
              <TargetRings className="absolute inset-0 h-full w-full animate-pulse text-brand/60" rings={4} />
              <Loader2 className="relative h-7 w-7 animate-spin text-brand" />
            </span>
            <div className="text-[14px] font-semibold text-text">{flow.step ?? "Preparing…"}</div>
            <div className="max-w-xs text-[11.5px] leading-snug text-text-3">Pinning metadata, building transactions and simulating them against the chain.</div>
          </>
        )}
      </div>
    );
  }
  return <ReviewBody res={res} flow={flow} imageUrl={imageUrl} nativeUsd={nativeUsd} balance={balance} ack={ack} setAck={setAck} onConfirm={onConfirm} onBack={onBack} showActions={showActions} />;
}

/** The one honest split line shown before signing: "Fee split: you 70% · platform 30%". */
export function feeSplitLine(plan: PlanResponse["plan"]): string {
  const c = plan.split.creatorBps / 100;
  const p = plan.split.platformBps / 100;
  const who = plan.split.recipientKind === "agent" ? `${plan.split.agent?.name ?? "your agent"} agent wallet` : "you";
  return `Fee split: ${who} ${c}% · platform ${p}%`;
}

export function canSign(res: PlanResponse | undefined, ack: boolean): boolean {
  if (!res || res.plan.txs.length === 0) return false;
  return ack;
}

function ReviewBody({
  res,
  flow,
  imageUrl,
  nativeUsd,
  balance,
  ack,
  setAck,
  onConfirm,
  onBack,
  showActions,
}: {
  res: PlanResponse;
  flow: FlowState;
  imageUrl?: string;
  nativeUsd?: number;
  balance?: number;
  ack: boolean;
  setAck: (v: boolean) => void;
  onConfirm: () => void;
  onBack: () => void;
  showActions: boolean;
}) {
  const { plan } = res;
  const req = plan.request;
  const chain = CHAINS[req.chain];
  const lp = LAUNCHPADS[req.launchpad];
  const sim = plan.simulation;
  const blocked = plan.txs.length === 0;
  const busy = flow.phase === "signing" || flow.phase === "confirming";
  const insufficient = balance !== undefined && balance < plan.fees.totalNative;
  const usd = (n: number) => (nativeUsd ? <span className="text-text-3"> · {fmtUsd(n * nativeUsd, 2)}</span> : null);

  const splitWarn = plan.split.warnings.length > 0;
  const splitLine = feeSplitLine(plan);
  const simGas = sim?.gasUsed ? (sim.gasUsed.includes("CU") ? sim.gasUsed : `${fmtCompact(Number(sim.gasUsed))} gas`) : undefined;

  return (
    <div className="space-y-4">
      {/* Coin header */}
      <div className="flex items-center gap-3 rounded-[4px] border border-line bg-bg-elev p-3">
        <TokenAvatar image={imageUrl} symbol={req.symbol} launchpad={req.launchpad} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-bold tracking-tight">${req.symbol}</div>
          <div className="truncate text-[12px] text-text-3">{req.name}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-text-2">
          <span className="chip">
            <LaunchpadBadge id={req.launchpad} size={12} /> {lp.name}
          </span>
          <span className="chip">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: chain.color }} />
            {chain.name}
          </span>
        </div>
      </div>

      {/* Checks before signing */}
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
        <div className="eyebrow mb-2">Checks before you sign</div>
        <ul className="divide-y divide-line overflow-hidden rounded-[4px] border border-line">
          {sim?.ok ? (
            <CheckRow state="ok" title="Simulation passed" detail={<>The chain accepted these transactions as your wallet just now.</>} meta={simGas} />
          ) : blocked ? (
            <CheckRow state="bad" icon={<ShieldAlert />} title="Launch blocked" detail={sim?.error ?? "No transactions were produced."} />
          ) : (
            <CheckRow state="bad" title="Simulation failed" detail={<span className="break-words">{sim?.error ?? "unknown error"}</span>} />
          )}
          {balance !== undefined && (
            <CheckRow
              state={insufficient ? "bad" : "ok"}
              title={insufficient ? "Balance too low" : "Balance covers the launch"}
              detail={
                <>
                  Wallet holds <span className="num text-text-2">{fmtNative(balance)} {chain.nativeSymbol}</span>, launch needs{" "}
                  <span className="num text-text-2">{fmtNative(plan.fees.totalNative)} {chain.nativeSymbol}</span>
                </>
              }
            />
          )}
          <CheckRow
            state={splitWarn ? "warn" : "ok"}
            title={splitLine}
            detail={
              plan.split.recipientKind === "agent"
                ? "Creator rewards go to the agent's wallet, run by Claudio — not to you. Locked when the coin is created."
                : splitWarn
                  ? `Locked when the coin is created · ${plan.split.warnings.length} note${plan.split.warnings.length === 1 ? "" : "s"} below`
                  : "Locked when the coin is created."
            }
          />
          <CheckRow
            state={blocked ? "bad" : "info"}
            icon={<FileSignature />}
            title={`You will sign ${plan.txs.length} transaction${plan.txs.length === 1 ? "" : "s"}`}
            detail={blocked ? undefined : "Listed below in signing order."}
          />
        </ul>
      </motion.div>

      {/* Amounts — receipt */}
      <div>
        <div className="eyebrow mb-2">Amounts</div>
        <div className="rounded-[4px] border border-line bg-bg-elev px-3.5 py-2">
          <KV label="Launch fee" value={<>{fmtNative(plan.fees.launchFeeNative)} {chain.nativeSymbol}{usd(plan.fees.launchFeeNative)}</>} />
          <KV label="Dev buy" value={<>{fmtNative(plan.fees.devBuyNative)} {chain.nativeSymbol}{usd(plan.fees.devBuyNative)}</>} />
          <KV
            label={chain.kind === "svm" ? "Rent + fees (est.)" : "Gas (est.)"}
            value={<>~{fmtNative(plan.fees.estGasNative)} {chain.nativeSymbol}</>}
            tone="muted"
          />
          <div className="my-1.5 border-t border-dashed border-line-2" />
          <KV
            label={<span className="font-bold text-text">Total</span>}
            value={
              <span className="text-[15px] font-bold">
                {fmtNative(plan.fees.totalNative)} {chain.nativeSymbol}
                {usd(plan.fees.totalNative)}
              </span>
            }
          />
          {insufficient && <div className="pb-1 text-right text-[11px] text-sell">Wallet balance {fmtNative(balance ?? 0)} {chain.nativeSymbol} is not enough</div>}
        </div>
      </div>

      {/* Dev buy preview (server math) */}
      {plan.fees.devBuyNative > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Tokens" value={fmtCompact(plan.devBuyPreview.tokensOut, 2)} />
          <Stat label="Of supply" value={fmtPct(plan.devBuyPreview.supplyPct, 2)} tone={plan.devBuyPreview.supplyPct > 5 ? "warn" : undefined} />
          <Stat label="Impact" value={fmtPct(plan.devBuyPreview.priceImpactPct, 1)} />
        </div>
      )}

      {/* Transactions */}
      <div>
        <div className="eyebrow mb-2">Transactions</div>
        <ol className="relative space-y-1.5">
          {plan.txs.map((t, i) => (
            <li key={i} className="flex items-start gap-3 rounded-[3px] border border-line bg-bg-elev px-3 py-2.5">
              <span className="section-num mt-px w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-text">{t.description}</div>
                <div className="num mt-0.5 flex flex-wrap gap-x-2 text-[10.5px] text-text-3">
                  {t.kind === "evm" ? (
                    <>
                      <span>to {t.to.slice(0, 8)}…{t.to.slice(-4)}</span>
                      {t.value !== "0" && <span>value {fmtNative(Number(t.value) / 1e18)} {chain.nativeSymbol}</span>}
                    </>
                  ) : (
                    <>
                      <span>{t.signers.length} signer{t.signers.length === 1 ? "" : "s"}</span>
                      {t.partiallySigned && (
                        <span className="inline-flex items-center gap-0.5 font-sans text-info">
                          <KeyRound className="h-2.5 w-2.5" /> pre-signed by the new mint
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
          {blocked && <li className="rounded-[3px] border border-dashed border-line px-3 py-2.5 text-[12px] text-text-3">Nothing to sign until the issue above is fixed.</li>}
        </ol>
      </div>

      {/* Predicted addresses */}
      {(plan.predicted.token || plan.predicted.splitter || plan.predicted.curve) && (
        <div>
          <div className="eyebrow mb-2">Addresses</div>
          <div className="rounded-[4px] border border-line px-3.5 py-1">
            {plan.predicted.token && <KV label="Token (mint)" value={<CopyAddress address={plan.predicted.token} head={6} tail={6} />} />}
            {plan.predicted.curve && <KV label="Bonding curve" value={<CopyAddress address={plan.predicted.curve} head={6} tail={6} />} />}
            {plan.predicted.splitter && <KV label="Fee splitter" value={<CopyAddress address={plan.predicted.splitter} head={6} tail={6} />} />}
            {plan.predicted.shareSplitter && (
              <KV label="Fee-share splitter" value={<CopyAddress address={plan.predicted.shareSplitter} head={6} tail={6} />} />
            )}
          </div>
        </div>
      )}

      {/* Split + warnings */}
      <div>
        <div className="eyebrow mb-2">Fee split</div>
        <div className="rounded-[4px] border border-line px-3.5 py-3">
          <div className="text-[12.5px] font-semibold text-text">{splitLine}</div>
          {plan.split.creator && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-text-3">
              {plan.split.recipientKind === "agent" ? "Agent wallet" : "Your wallet"} <CopyAddress address={plan.split.creator} head={6} tail={6} />
            </div>
          )}
          <p className="mt-2 break-words text-[11.5px] leading-snug text-text-3">{plan.split.mechanism}</p>
          {plan.split.shares && plan.split.shares.length > 0 ? (
            <div className="mt-2 space-y-1.5 rounded-[3px] bg-bg-elev px-3 py-2 text-[12px]">
              <div className="text-text-3">The creator {plan.split.creatorBps / 100}% is shared (fixed on-chain):</div>
              {plan.split.shares.map((sh) => (
                <div key={sh.address} className="flex items-center gap-2">
                  {sh.avatarUrl && <img src={sh.avatarUrl} alt="" className="h-5 w-5 rounded-full" />}
                  <span className="min-w-0 flex-1 truncate">
                    {sh.kind === "launcher" ? (
                      <b>You</b>
                    ) : (
                      <>
                        <b>{sh.handle ? `@${sh.handle}` : sh.identityKey}</b>
                        {sh.provider && <span className="text-text-3"> ({SOCIAL_PROVIDER_LABEL[sh.provider]}) — claimable only by them</span>}
                      </>
                    )}
                  </span>
                  <span className="num font-semibold">{sh.bps / 100}%</span>
                </div>
              ))}
            </div>
          ) : res?.beneficiary && (
            <div className="mt-2 flex items-center gap-2 rounded-[3px] bg-bg-elev px-3 py-2 text-[12px]">
              {res.beneficiary.avatarUrl && <img src={res.beneficiary.avatarUrl} alt="" className="h-6 w-6 rounded-full" />}
              <span className="min-w-0">
                The creator share goes to <b>{res.beneficiary.handle ? `@${res.beneficiary.handle}` : res.beneficiary.identityKey}</b>
                <span className="text-text-3"> ({SOCIAL_PROVIDER_LABEL[res.beneficiary.provider]}) — claimable only by them</span>
              </span>
            </div>
          )}
          {plan.split.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {plan.split.warnings.map((w) => (
                <li key={w} className="flex gap-1.5 text-[11.5px] leading-snug">
                  <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0 text-warn" />
                  <span className="text-text-2">{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {flow.error && (
        <Callout tone="bad" icon={<XCircle />}>
          {flow.error}
        </Callout>
      )}

      {!blocked && (
        <label
          className={cn(
            "flex min-h-[48px] cursor-pointer items-start gap-3 rounded-[3px] border px-3 py-3 text-[12px] leading-snug text-text-2 transition-colors",
            ack ? "border-brand/60 bg-brand-bg" : "border-line-2 bg-bg-elev hover:border-text-3",
          )}
        >
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-px h-4 w-4 shrink-0 accent-[var(--brand)]" />
          <span>
            I understand this spends real {chain.nativeSymbol}, can't be undone, and that {lp.name} is a third-party launchpad.
            {!sim?.ok && <b className="text-sell"> The simulation failed — signing will very likely revert.</b>}
          </span>
        </label>
      )}

      {showActions && (
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onBack} disabled={busy} className="h-12 rounded-[3px] border border-line-2 px-5 text-[13px] font-semibold text-text-2 transition-colors hover:text-text disabled:opacity-50">
            Edit
          </button>
          <ConfirmButton flow={flow} canSign={canSign(res, ack)} simOk={!!sim?.ok} onConfirm={onConfirm} className="flex-1" />
        </div>
      )}
    </div>
  );
}

function CheckRow({
  state,
  title,
  detail,
  meta,
  icon,
}: {
  state: "ok" | "warn" | "bad" | "info";
  title: string;
  detail?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
}) {
  const glyph =
    icon ?? (state === "ok" ? <CheckCircle2 /> : state === "bad" ? <XCircle /> : state === "warn" ? <AlertTriangle /> : <CheckCircle2 />);
  return (
    <li className="flex items-start gap-3 bg-bg-elev px-3.5 py-2.5">
      <span
        className={cn(
          "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] [&>svg]:h-3.5 [&>svg]:w-3.5",
          state === "ok" ? "bg-buy-bg text-buy" : state === "bad" ? "bg-sell-bg text-sell" : state === "warn" ? "bg-warn-bg text-warn" : "bg-panel-3 text-text-2",
        )}
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("text-[13px] font-semibold", state === "bad" ? "text-sell" : "text-text")}>{title}</span>
          {meta && <span className="num ml-auto shrink-0 text-[10.5px] text-text-3">{meta}</span>}
        </div>
        {detail && <div className="mt-0.5 text-[11.5px] leading-snug text-text-3">{detail}</div>}
      </div>
    </li>
  );
}

export function ConfirmButton({ flow, canSign, simOk, onConfirm, className }: { flow: FlowState; canSign: boolean; simOk: boolean; onConfirm: () => void; className?: string }) {
  const busy = flow.phase === "signing" || flow.phase === "confirming" || flow.phase === "preparing";
  return (
    <button
      type="button"
      onClick={onConfirm}
      disabled={!canSign || busy}
      className={cn(
        "relative flex h-12 items-center justify-center gap-2 overflow-hidden rounded-[3px] px-5 font-mono text-[12.5px] font-medium uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed",
        simOk
          ? "brand-gradient text-brand-ink disabled:opacity-40"
          : "bg-sell text-sell-ink disabled:opacity-40",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
      {busy ? flow.step ?? "Working…" : simOk ? "Sign & launch" : "Sign anyway"}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-[3px] border border-line bg-bg-elev px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{label}</div>
      <div className={cn("num mt-0.5 text-[13.5px] font-semibold", tone === "warn" ? "text-warn" : "text-text")}>{value}</div>
    </div>
  );
}
