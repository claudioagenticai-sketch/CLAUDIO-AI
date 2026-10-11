// One launch on the Creator dashboard: status, links, splitter, accrued fees, Harvest.
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, ExternalLink, HandCoins, Loader2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS } from "@shared/launchpads";
import type { TokenAlert } from "@shared/types";
import { CopyAddress, LaunchpadBadge, ResponsiveSheet, SplitBadge, TokenAvatar } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { fmtAge, fmtNative } from "@/lib/format";
import { useBoard } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SendError, requireUnlocked, signAndSend } from "@/lib/wallet";
import { launchApi, type HarvestResponse } from "@/features/launch/api";
import { displayImage, tokenKey, type CreatorLaunch } from "./model";

const EMPTY_ALERTS: TokenAlert[] = [];

function StatusChip({ status }: { status: CreatorLaunch["status"] }) {
  const map = {
    confirmed: { cls: "chip-buy", icon: <CheckCircle2 className="h-3 w-3" />, label: "Live" },
    submitted: { cls: "chip-info", icon: <Clock className="h-3 w-3" />, label: "Pending" },
    prepared: { cls: "", icon: <Clock className="h-3 w-3" />, label: "Prepared" },
    failed: { cls: "chip-sell", icon: <XCircle className="h-3 w-3" />, label: "Failed" },
    unverified: { cls: "chip-warn", icon: <XCircle className="h-3 w-3" />, label: "Split unverified" },
    local: { cls: "chip-warn", icon: <Clock className="h-3 w-3" />, label: "Local only" },
  } as const;
  const m = map[status];
  return (
    <span className={cn("chip", m.cls)}>
      {m.icon}
      {m.label}
    </span>
  );
}

export function useLaunchAlerts(l: CreatorLaunch): TokenAlert[] {
  return useBoard((s) => (l.token ? s.tokens[tokenKey(l.chain, l.token)]?.alerts ?? EMPTY_ALERTS : EMPTY_ALERTS)).filter(
    (a) => a.kind === "fee-recipient-change-proposed" || a.kind === "fee-split-reset",
  );
}

export function LaunchCard({ launch, index }: { launch: CreatorLaunch; index: number }) {
  const c = CHAINS[launch.chain];
  const lp = LAUNCHPADS[launch.launchpad];
  const { toast } = useToast();
  const alerts = useLaunchAlerts(launch);
  const canHarvest = launch.server && launch.status === "confirmed";
  const fees = useQuery({
    queryKey: ["launch", "fees", launch.id],
    queryFn: () => launchApi.fees(launch.id),
    enabled: canHarvest,
    staleTime: 30_000,
    retry: 0,
  });
  const [harvest, setHarvest] = useState<HarvestResponse | null>(null);
  const [loadingHarvest, setLoadingHarvest] = useState(false);
  const [sending, setSending] = useState(false);

  const startHarvest = async () => {
    setLoadingHarvest(true);
    try {
      setHarvest(await launchApi.harvest(launch.id));
    } catch (e) {
      toast({ title: "Harvest unavailable", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoadingHarvest(false);
    }
  };

  const sendHarvest = async () => {
    if (!harvest?.txs.length) return;
    setSending(true);
    try {
      await requireUnlocked(`Harvest $${launch.symbol}`);
      const { hashes } = await signAndSend(launch.chain, harvest.txs);
      toast({ title: `Harvested $${launch.symbol}`, description: `${hashes.length} transaction${hashes.length === 1 ? "" : "s"} confirmed.` });
      setHarvest(null);
      void fees.refetch();
    } catch (e) {
      const sent = e instanceof SendError ? e.hashes.length : 0;
      toast({
        title: sent ? `Harvest partly sent (${sent}/${harvest.txs.length})` : "Harvest failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const items = fees.data?.items ?? [];
  const tokenPath = launch.token ? `/t/${launch.chain}/${launch.token}` : undefined;
  const creatorPct = FEE_SPLIT.creatorBps / 100;
  const platformPct = FEE_SPLIT.platformBps / 100;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className={cn("panel overflow-hidden", alerts.length > 0 && "border-sell ring-1 ring-sell/40")}
    >
      {alerts.length > 0 && (
        <div className="border-b border-sell/30 border-l-2 border-l-sell px-4 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-sell">
            <ShieldAlert className="h-3.5 w-3.5" /> Fee-split alert
          </div>
          {alerts.map((a) => (
            <div key={`${a.kind}:${a.at}`} className="text-[12.5px] leading-snug">
              <span className="text-text">
                {a.message} <span className="text-text-3">· {fmtAge(a.at)} ago — harvest now.</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="p-4">
        {/* identity */}
        <div className="flex gap-3">
          <TokenAvatar image={displayImage(launch.imageUri)} symbol={launch.symbol} launchpad={launch.launchpad} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  {tokenPath ? (
                    <Link href={tokenPath} className="truncate text-[16px] font-semibold tracking-tight hover:text-brand">
                      ${launch.symbol}
                    </Link>
                  ) : (
                    <span className="truncate text-[16px] font-semibold tracking-tight">${launch.symbol}</span>
                  )}
                  <span className="truncate text-[12.5px] text-text-3">{launch.name}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-3">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                    {c.short}
                  </span>
                  <span className="flex items-center gap-1">
                    <LaunchpadBadge id={launch.launchpad} size={13} /> {lp.name}
                  </span>
                  <span className="num">{fmtAge(launch.ts)} ago</span>
                  <SplitBadge kind={lp.split} />
                </div>
              </div>
              <StatusChip status={launch.status} />
            </div>
          </div>
        </div>

        {/* split + addresses */}
        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">Fee split</div>
            <div className="flex h-1 gap-0.5 overflow-hidden">
              <span className="h-full bg-brand" style={{ width: `${creatorPct}%` }} />
              <span className="h-full flex-1 bg-line-2" />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px]">
              <span className="text-text-2">
                You <span className="num font-semibold text-text">{creatorPct}%</span>
              </span>
              <span className="text-text-3">
                Platform <span className="num">{platformPct}%</span>
              </span>
            </div>
          </div>
          <div className="grid content-start gap-1 text-[11.5px]">
            {launch.token && (
              <div className="flex items-center gap-1.5">
                <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">Token</span>
                <CopyAddress address={launch.token} head={6} tail={5} />
                <a href={c.explorerAddress(launch.token)} target="_blank" rel="noreferrer" className="text-text-3 hover:text-text" aria-label="Explorer">
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            )}
            {launch.splitter && (
              <div className="flex items-center gap-1.5">
                <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">{launch.chain === "sol" ? "Sharing" : "Splitter"}</span>
                <CopyAddress address={launch.splitter} head={6} tail={5} />
                <a href={c.explorerAddress(launch.splitter)} target="_blank" rel="noreferrer" className="text-text-3 hover:text-text" aria-label="Explorer">
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>
            )}
            {!launch.token && !launch.splitter && <span className="text-text-3">Addresses appear once the launch confirms.</span>}
          </div>
        </div>

        {launch.error && (
          <div className="mt-3 flex gap-2 rounded-[3px] border border-line border-l-2 border-l-warn px-3 py-2 text-[11.5px] leading-snug text-warn">
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" /> {launch.error}
          </div>
        )}
      </div>

      {/* fees + harvest */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-0.5">Accrued fees</div>
          {canHarvest ? (
            fees.isLoading ? (
              <span className="flex items-center gap-1.5 text-[12px] text-text-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading fees…
              </span>
            ) : items.length ? (
              <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
                {items.map((it) => (
                  <div key={it.label} className="text-[12px]" title={it.note}>
                    <span className="mr-1 text-[10.5px] text-text-3">{it.label}</span>
                    <span className="num font-semibold">
                      {fmtNative(it.amount)} {it.symbol}
                      {it.creatorShare !== undefined && it.creatorShare !== it.amount && (
                        <span className="font-normal text-buy"> · you {fmtNative(it.creatorShare)}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-[12px] text-text-3">{fees.isError ? "Fees unreadable right now" : "No fees accrued yet"}</span>
            )
          ) : (
            <span className="text-[12px] text-text-3">
              {launch.status === "local" ? "Not on the server yet — confirm is pending." : launch.status === "failed" ? "Nothing to harvest." : "Harvest unlocks once confirmed."}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {launch.hashes[0] && (
            <a href={c.explorerTx(launch.hashes[launch.hashes.length - 1])} target="_blank" rel="noreferrer" className="flex h-10 items-center gap-1 px-2 text-[11px] text-text-3 hover:text-text">
              tx <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {canHarvest && (
            <button type="button" onClick={() => void fees.refetch()} className="flex h-10 w-10 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-2 hover:text-text" aria-label="Refresh fees">
              <RefreshCw className={cn("h-4 w-4", fees.isFetching && "animate-spin")} />
            </button>
          )}
          <button
            type="button"
            disabled={!canHarvest || loadingHarvest}
            onClick={() => void startHarvest()}
            className="btn-buy h-10 rounded-[3px] px-4 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingHarvest ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />} Harvest
          </button>
        </div>
      </div>

      <ResponsiveSheet open={!!harvest} onOpenChange={(o) => !o && !sending && setHarvest(null)} title={`Harvest $${launch.symbol}`} description="Claims accrued creator fees and splits them 70/30 on-chain.">
        {harvest && (
          <div className="space-y-3">
            <ol className="space-y-1.5">
              {harvest.txs.map((t, i) => (
                <li key={i} className="flex items-center gap-2.5 rounded-[3px] px-3 py-2.5 text-[12.5px] ring-1 ring-inset ring-line">
                  <span className="section-num w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  {t.description}
                </li>
              ))}
              {!harvest.txs.length && <li className="rounded-[3px] px-3 py-2.5 text-[12px] text-text-3 ring-1 ring-inset ring-line">Nothing to sign right now.</li>}
            </ol>
            {harvest.notes.map((n) => (
              <p key={n} className="flex gap-1.5 text-[11.5px] leading-snug text-text-3">
                <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0 text-warn" /> {n}
              </p>
            ))}
            <p className="text-[11.5px] text-text-3">Harvesting is permissionless: you pay the gas, both parties are paid their share in the same transaction.</p>
            <button
              type="button"
              disabled={!harvest.txs.length || sending}
              onClick={() => void sendHarvest()}
              className="btn btn-primary h-12 w-full disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
              {sending ? "Signing…" : `Sign ${harvest.txs.length} transaction${harvest.txs.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </ResponsiveSheet>
    </motion.div>
  );
}
