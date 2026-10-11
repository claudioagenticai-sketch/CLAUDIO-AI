// /confirm/:id — review and sign a trade or launch that an AI app prepared (non-custodial: the app never holds keys).
// Shows exactly what will happen, checks that the connected Solana wallet is the one the app was allowed for, then
// builds the transactions with the site's normal trade / launch APIs and signs them with the user's own wallet.
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CHAINS } from "@shared/chains";
import type { PreparedTx, TokenSnapshot } from "@shared/types";
import { shortAddr, fmtNative } from "@/lib/format";
import { useHistory } from "@/lib/history";
import { SendError, requireUnlocked, signAndSend, useActiveAccount } from "@/lib/wallet";
import { launchApi, launchErrorMessage, type PlanResponse } from "@/features/launch/api";
import { ActionButton, useCountdown } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { mcpCall, preparedApi, type LaunchParams, type Prepared, type PreparedStatus, type TradeParams } from "./api";

/** Solana blockhashes expire after ~60–90 s: re-plan a launch if the review sat longer than this. */
const PLAN_TTL_MS = 45_000;

const STATUS_LABEL: Record<PreparedStatus, string> = {
  pending: "Waiting for you",
  signed: "Sent, confirming",
  confirmed: "Confirmed",
  failed: "Failed",
  expired: "Expired",
};

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/cancel/i.test(msg)) return "Cancelled. Nothing was signed.";
  if (/reject/i.test(msg)) return "You declined in your wallet. Nothing was sent.";
  return msg;
}

function Lines({ lines }: { lines: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5">
      {lines.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="contents">
          <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">{k}</dt>
          <dd className="break-words text-right text-[13.5px] font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Signatures({ hashes }: { hashes: string[] }) {
  if (!hashes.length) return null;
  return (
    <div className="mt-4 rounded-[3px] border border-line p-3">
      <div className="mono-label">Transactions</div>
      <ul className="mt-1.5 grid gap-1">
        {hashes.map((h) => (
          <li key={h}>
            <a href={CHAINS.sol.explorerTx(h)} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] text-brand">
              {shortAddr(h, 8, 8)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function fetchToken(key: string): Promise<TokenSnapshot> {
  return mcpCall<TokenSnapshot>("GET", `/api/token/${encodeURIComponent(key)}`);
}

export default function ConfirmPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["mcp", "prepared", id],
    queryFn: () => preparedApi.get(id),
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "pending" || s === "signed" ? 3_000 : false;
    },
  });
  const acct = useActiveAccount("svm");
  const recordTrade = useHistory((s) => s.recordTrade);
  const recordLaunch = useHistory((s) => s.recordLaunch);
  const [phase, setPhase] = useState<"idle" | "building" | "review" | "signing" | "reporting">("idle");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<string[]>([]);

  const p: Prepared | undefined = q.data;
  const left = useCountdown(() => (p ? Date.parse(p.expiresAt) - Date.now() : 0), [p?.expiresAt]);

  useEffect(() => {
    if (p?.signatures?.length && !hashes.length) setHashes(p.signatures);
  }, [p, hashes.length]);

  if (q.isLoading) return <div className="panel sheen h-[360px]" />;
  if (q.error || !p) {
    return (
      <div className="panel p-6">
        <h1 className="display text-[30px] text-text">This link doesn't work</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-3">
          It may have expired or never existed. Ask your assistant to prepare the trade or launch again.
        </p>
      </div>
    );
  }

  const expired = p.status === "expired" || (p.status === "pending" && left <= 0);
  const pending = p.status === "pending" && !expired;
  const walletOk = !!acct && acct.address === p.wallet;
  const title =
    p.kind === "launch"
      ? `Launch $${(p.params as LaunchParams).symbol}`
      : `${(p.params as TradeParams).side === "sell" ? "Sell" : "Buy"} ${p.summary.symbol ? `$${p.summary.symbol}` : "coin"}`;
  const busy = phase === "building" || phase === "signing" || phase === "reporting";

  const report = async (sigs: string[], extra: { mint?: string; launchId?: string; error?: string } = {}) => {
    setPhase("reporting");
    try {
      await preparedApi.result(p.id, { signatures: sigs, ...extra });
    } catch {
      /* the chain is the source of truth; the status refresh still picks it up */
    }
    await qc.invalidateQueries({ queryKey: ["mcp", "prepared", id] });
  };

  const send = async (txs: PreparedTx[]): Promise<{ hashes: string[]; err?: string }> => {
    try {
      return { hashes: (await signAndSend("sol", txs)).hashes };
    } catch (e) {
      if (e instanceof SendError && e.hashes.length) return { hashes: e.hashes, err: e.message };
      throw e;
    }
  };

  const ensureWallet = async () => {
    await requireUnlocked(title);
  };

  const signTrade = async () => {
    const t = p.params as TradeParams;
    setError(null);
    setPhase("building");
    try {
      await ensureWallet();
      if (!walletOk) throw new Error(`Switch to ${shortAddr(p.wallet)} first.`);
      const token = await fetchToken(t.key);
      const prepared = await mcpCall<{ txs: PreparedTx[]; quote: { amountIn: number; expectedOut: number } }>("POST", "/api/trade/prepare", {
        key: t.key,
        side: t.side,
        ...(t.side === "buy" ? { amountNative: t.amountSol } : { pct: t.percent }),
        trader: p.wallet,
        slippageBps: t.slippageBps,
        priorityFee: 0,
        jitoTip: 0,
        approveMax: false,
      });
      if (!prepared.txs.length) throw new Error("The server returned no transactions.");
      setPhase("signing");
      const r = await send(prepared.txs);
      setHashes(r.hashes);
      if (r.hashes.length) {
        recordTrade({
          id: r.hashes[r.hashes.length - 1],
          key: t.key,
          chain: "sol",
          symbol: token.symbol,
          side: t.side,
          wallet: p.wallet,
          amountNative: t.side === "buy" ? prepared.quote.amountIn : prepared.quote.expectedOut,
          amountToken: t.side === "buy" ? prepared.quote.expectedOut : prepared.quote.amountIn,
          priceUsd: token.priceUsd,
          ts: Date.now(),
          status: "sent",
        });
      }
      await report(r.hashes, r.err ? { error: r.err } : {});
      if (r.err) setError(`${r.err}. Sent ${r.hashes.length}/${prepared.txs.length}.`);
      setPhase("idle");
    } catch (e) {
      setError(errText(e));
      setPhase("idle");
    }
  };

  const buildLaunch = async (): Promise<PlanResponse | null> => {
    const l = p.params as LaunchParams;
    setError(null);
    setPhase("building");
    try {
      await ensureWallet();
      if (!walletOk) throw new Error(`Switch to ${shortAddr(p.wallet)} first.`);
      const meta = await launchApi.uploadMetadata({
        name: l.name,
        symbol: l.symbol,
        description: l.description ?? "",
        image: l.imageUri,
        twitter: l.socials.twitter,
        telegram: l.socials.telegram,
        website: l.socials.website,
        showName: true,
      });
      const planned = await launchApi.plan({
        chain: "sol",
        launchpad: "pump",
        name: l.name,
        symbol: l.symbol,
        description: l.description || undefined,
        imageUri: l.imageUri,
        metadataUri: meta.url,
        socials: l.socials,
        creator: p.wallet,
        devBuyNative: l.devBuySol,
        slippageBps: l.slippageBps,
      });
      setPlan(planned);
      setPhase("review");
      return planned;
    } catch (e) {
      setError(e instanceof Error && "code" in e ? launchErrorMessage(e) : errText(e));
      setPhase("idle");
      return null;
    }
  };

  const signLaunch = async () => {
    let planned = plan;
    if (!planned) return;
    try {
      if (Date.now() - planned.createdAt > PLAN_TTL_MS) {
        planned = await buildLaunch();
        if (!planned) return;
      }
      if (planned.plan.simulation && !planned.plan.simulation.ok) throw new Error(`The launch would fail: ${planned.plan.simulation.error ?? "simulation failed"}`);
      setError(null);
      setPhase("signing");
      await ensureWallet();
      const r = await send(planned.plan.txs);
      setHashes(r.hashes);
      const req = planned.plan.request;
      recordLaunch({
        id: planned.id,
        chain: "sol",
        launchpad: req.launchpad,
        name: req.name,
        symbol: req.symbol,
        creator: req.creator,
        token: planned.plan.predicted.token,
        splitter: planned.plan.predicted.splitter,
        hashes: r.hashes,
        ts: Date.now(),
      });
      let mint = planned.plan.predicted.token;
      if (r.hashes.length) {
        try {
          const c = await launchApi.confirm(planned.id, r.hashes);
          mint = c.launch.token ?? mint;
        } catch {
          /* the chain is the source of truth */
        }
      }
      await report(r.hashes, { launchId: planned.id, ...(mint ? { mint } : {}), ...(r.err ? { error: r.err } : {}) });
      if (r.err) setError(`${r.err}. Sent ${r.hashes.length}/${planned.plan.txs.length}.`);
      setPhase("idle");
    } catch (e) {
      setError(errText(e));
      setPhase("review");
    }
  };

  const split = plan?.plan.split;
  const fees = plan?.plan.fees;

  return (
    <div className="grid gap-4">
      <div className="panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mono-label">
              {p.clientName ? `Prepared by ${p.clientName}` : "Prepared by an app you connected"}
            </div>
            <h1 className="display mt-3 break-words text-[34px] text-text md:text-[44px]">{title}</h1>
          </div>
          <span
            className={cn(
              "chip shrink-0 px-2 py-1",
              p.status === "confirmed" || p.status === "signed" ? "chip-buy" : p.status === "failed" || expired ? "chip-sell" : "chip-warn",
            )}
          >
            {expired ? STATUS_LABEL.expired : STATUS_LABEL[p.status]}
          </span>
        </div>

        <div className="mt-4">
          <Lines lines={p.summary.lines} />
        </div>

        <div className="mt-4 grid gap-1 border-t border-line pt-3 text-[12.5px] text-text-3">
          <div>
            Signs with <span className="font-mono text-text-2">{shortAddr(p.wallet)}</span> (your wallet, on Solana)
          </div>
          {p.kind === "trade" && <div>Max slippage {((p.params as TradeParams).slippageBps / 100).toFixed(1)}%</div>}
          {pending && <div>This link expires in {Math.ceil(left / 1000)} s.</div>}
        </div>

        {p.kind === "launch" && phase === "review" && plan && (
          <div className="mt-4 rounded-[3px] border border-line p-3.5">
            <div className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text">Ready to sign</div>
            <Lines
              lines={[
                ["Total cost", `${fmtNative(fees?.totalNative ?? 0)} SOL`],
                ["Launch fee", `${fmtNative(fees?.launchFeeNative ?? 0)} SOL`],
                ["Dev buy", `${fmtNative(fees?.devBuyNative ?? 0)} SOL`],
                ["Network fees (est.)", `${fmtNative(fees?.estGasNative ?? 0)} SOL`],
                ["Trading fee split", split ? `${split.creatorBps / 100}% to you · ${split.platformBps / 100}% to Claudio` : "—"],
                ...(plan.plan.predicted.token ? ([["Coin address", shortAddr(plan.plan.predicted.token, 6, 6)]] as [string, string][]) : []),
              ]}
            />
            {split?.warnings?.length ? <p className="mt-2 text-[12px] text-warn">{split.warnings.join(" · ")}</p> : null}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-sell">
            {error}
          </p>
        )}

        {pending && (
          <div className="mt-5">
            {!acct ? (
              <ActionButton className="w-full" onClick={() => void requireUnlocked("Connect the wallet this app was allowed for").catch(() => undefined)}>
                Connect your wallet
              </ActionButton>
            ) : !walletOk ? (
              <div className="rounded-[3px] border border-line border-l-2 border-l-warn px-3.5 py-3 text-[13px] text-warn">
                Switch to {shortAddr(p.wallet)} to sign. The connected wallet is {shortAddr(acct.address)}, which isn't the one this app was allowed for.
              </div>
            ) : p.kind === "trade" ? (
              <ActionButton className="w-full" busy={busy} onClick={signTrade}>
                Sign and send
              </ActionButton>
            ) : phase === "review" ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <ActionButton tone="ghost" className="sm:flex-1" disabled={busy} onClick={() => void buildLaunch()}>
                  Rebuild
                </ActionButton>
                <ActionButton className="sm:flex-[2]" busy={busy} onClick={signLaunch}>
                  Sign and launch
                </ActionButton>
              </div>
            ) : (
              <ActionButton className="w-full" busy={busy} onClick={() => void buildLaunch()}>
                Review the launch
              </ActionButton>
            )}
            <p className="mt-2.5 text-center text-[11.5px] text-text-3">
              Your wallet shows the transaction before anything is sent. Nothing moves until you approve it there.
            </p>
          </div>
        )}

        {expired && (
          <p className="mt-4 text-[13px] text-text-3">
            This link has expired. Ask your assistant to prepare it again; each link works for 2 minutes.
          </p>
        )}
        {p.status === "failed" && p.error && <p className="mt-4 text-[13px] text-sell">{p.error}</p>}
        {p.mint && (
          <p className="mt-4 text-[13px]">
            <a className="text-brand" href={`/t/sol/${p.mint}`}>
              Open the coin page
            </a>
          </p>
        )}
        <Signatures hashes={hashes} />
      </div>
      <p className="text-center text-[11.5px] text-text-3">Not financial advice. Memecoins are risky; only use money you can afford to lose.</p>
    </div>
  );
}
