// Overview: collector, platform fee wallet, launch counts, switches, config warnings, recent audit.
import { Activity, Bot, Coins, ScrollText, Settings2, Wallet } from "lucide-react";
import type { AdminAuditEvent, CollectorStatus } from "@shared/platform";
import { CHAINS } from "@shared/chains";
import { CopyAddress } from "@/components/kit";
import { Card } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { adminApi, useAdminQuery } from "./api";
import { InsightsCard } from "./Insights";
import { ErrorNote, KV, Loading, Metric, SeverityChip, Table, Td, Warn, fmtSol, fmtTime, short } from "./ui";

export function CollectorSummary({ status }: { status: CollectorStatus }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cn("chip", status.enabled ? "chip-buy" : "chip-warn")}>{status.enabled ? "enabled" : "disabled"}</span>
        {status.running && <span className="chip chip-info">running</span>}
        {status.lowBalance && <span className="chip chip-sell">low balance</span>}
        {!status.enabled && status.reason && <span className="text-[11.5px] text-text-3">{status.reason}</span>}
      </div>
      <KV label="Bot wallet">{status.wallet ? <CopyAddress address={status.wallet} head={6} tail={6} /> : "—"}</KV>
      <KV label="Bot balance">
        <span className={cn("num", status.lowBalance && "text-sell")}>{status.balanceSol === null ? "—" : fmtSol(status.balanceSol)}</span>
      </KV>
      <KV label="Interval / min payout">
        <span className="num">
          every {status.intervalMin} min · ≥ {status.minSol} SOL
        </span>
      </KV>
      <KV label="Last run">
        {status.lastRun ? (
          <span className="num">
            {fmtTime(status.lastRun.startedAt)} · {status.lastRun.coinsChecked} checked · {status.lastRun.distributed} paid
            {status.lastRun.errors.length ? <span className="text-sell"> · {status.lastRun.errors.length} errors</span> : null}
          </span>
        ) : (
          "never"
        )}
      </KV>
      <KV label="Next run">{fmtTime(status.nextRunAt)}</KV>
      <KV label="Paid out (total)">
        <span className="num">
          {fmtSol(status.totals.paidOutSol)} · {status.totals.payouts} payouts · {status.totals.runs} runs
        </span>
      </KV>
    </div>
  );
}

export function AuditTable({ events }: { events: AdminAuditEvent[] }) {
  return (
    <Table head={["When", "Severity", "Action", "Actor", "Target", "Detail"]} empty={!events.length}>
      {events.map((e, i) => (
        <tr key={e.id ?? `${e.at}:${i}`}>
          <Td className="num whitespace-nowrap">{fmtTime(e.at)}</Td>
          <Td>
            <SeverityChip severity={e.severity} />
          </Td>
          <Td className="whitespace-nowrap font-semibold text-text">{e.action}</Td>
          <Td className="num whitespace-nowrap">{short(e.actor)}</Td>
          <Td className="max-w-[180px] truncate">{e.target ?? "—"}</Td>
          <Td className="max-w-[260px]">
            <span className="num block truncate text-[11px] text-text-3" title={JSON.stringify(e.detail)}>
              {e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail) : ""}
            </span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export function OverviewTab() {
  const q = useAdminQuery(["overview"], adminApi.overview, { refetchInterval: 30_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const o = q.data!;
  const c = o.config;
  const warnings = [...o.warnings];
  if (c.treasuryEnvConflict) warnings.unshift(`PLATFORM_TREASURY_SOL (${c.treasuryEnvConflict}) differs from the hard-coded fee wallet — Solana launches are refused until it is removed or fixed.`);
  if (!c.pumpLut) warnings.push("PUMP_LUT_ADDRESS is not set: pump.fun launches can't fit create + fee split + dev buy into one transaction. Create the lookup table (POST /api/launch/pump/lut with an operator wallet as authority, sign the returned transactions, wait one slot), then set PUMP_LUT_ADDRESS and restart.");
  if (!c.pinata && c.network === "mainnet") warnings.push("PINATA_JWT is not set: mainnet launches are refused because metadata/images can't be pinned to IPFS.");
  if (!c.collectorKey) warnings.push("COLLECTOR_KEY is not set: creator fees are not distributed automatically.");
  const dedup = Array.from(new Set(warnings));

  return (
    <div className="space-y-4">
      {dedup.length > 0 && (
        <div className="space-y-2">
          {dedup.map((w) => (
            <Warn key={w}>{w}</Warn>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Launches" value={o.counts.launches} sub={`${o.counts.last24h} in 24 h`} />
        <Metric label="Confirmed" value={o.counts.confirmed} tone="buy" sub={`${o.counts.submitted} submitted`} />
        <Metric label="Failed / unverified" value={`${o.counts.failed} / ${o.counts.unverified}`} tone={o.counts.unverified ? "warn" : undefined} />
        <Metric label="By agents" value={o.counts.byAgents} sub={`${o.switches.chainsOpen} chains · ${o.switches.launchpadsOpen} pads open`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Platform fee wallet" icon={<Wallet />}>
          <KV label="Address">
            <CopyAddress address={o.feeWallet.address} head={6} tail={6} />
          </KV>
          <KV label="Balance">
            <span className="num font-semibold">{o.feeWallet.balanceSol === null ? "—" : fmtSol(o.feeWallet.balanceSol)}</span>
          </KV>
          <KV label="Explorer">
            <a className="text-[12px] text-text-2 underline-offset-2 hover:text-text hover:underline" href={CHAINS.sol.explorerAddress(o.feeWallet.address)} target="_blank" rel="noreferrer">
              Solscan ↗
            </a>
          </KV>
        </Card>
        <Card title="Collector" icon={<Bot />}>
          <CollectorSummary status={o.collector} />
        </Card>
        <Card title="Config" icon={<Settings2 />}>
          <KV label="Network">{c.network}</KV>
          <KV label="Database">{c.database ? "connected" : <span className="text-warn">none (memory only)</span>}</KV>
          <KV label="pump.fun lookup table">{c.pumpLut ? <CopyAddress address={c.pumpLut} head={6} tail={6} /> : <span className="text-warn">not set</span>}</KV>
          <KV label="IPFS pinning">{c.pinata ? "Pinata" : <span className="text-warn">local only</span>}</KV>
          <KV label="Collector key">{c.collectorKey ? "set" : <span className="text-warn">not set</span>}</KV>
          <KV label="Split layout (testing)">{c.splitLayoutAllowed ? <span className="text-sell">allowed</span> : "refused"}</KV>
        </Card>
        <Card title="Switches" icon={<Coins />}>
          <KV label="Chains open">{o.switches.chainsOpen}</KV>
          <KV label="Launchpads open">{o.switches.launchpadsOpen}</KV>
          <p className="mt-2 text-[11.5px] leading-snug text-text-3">
            A launchpad is only ever as open as its code allows: an unbuilt adapter stays "coming soon" whatever is set here.
          </p>
        </Card>
        <InsightsCard />
      </div>
      <Card title="Recent audit events" icon={<ScrollText />} right={<Activity className="h-4 w-4 text-text-3" />}>
        <AuditTable events={o.recentAudit} />
      </Card>
    </div>
  );
}
