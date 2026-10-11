// Token info: fee split, taxes, anti-snipe schedule, launchpad warnings, contracts, creator + dev reputation, alerts.
import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, FileCode2, Percent, Rocket, Shield, Timer, User } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { deploymentOf, FEE_SPLIT, LAUNCHPADS, type SplitSupport } from "@shared/launchpads";
import type { TokenDetail, TokenSnapshot } from "@shared/types";
import { Age, CopyAddress, SplitBadge, VenueLabel } from "@/components/kit";
import { fmtBps, fmtNative } from "@/lib/format";
import { cn } from "@/lib/utils";

function Section({ title, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 bg-bg-elev px-4 py-3.5">
      <h3 className="eyebrow mb-2.5 flex items-center gap-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3 border-b border-dashed border-line py-0.5 text-xs last:border-b-0">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="min-w-0 text-right text-text-2">{children}</span>
    </div>
  );
}

function AddressRow({ label, address, chain }: { label: string; address: string; chain: TokenSnapshot["chain"] }) {
  const url = CHAINS[chain].explorerAddress(address);
  return (
    <Row label={label}>
      <span className="inline-flex items-center gap-1">
        <CopyAddress address={address} head={6} tail={6} />
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label} on explorer`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[2px] text-text-3 hover:bg-panel-3 hover:text-text"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </span>
    </Row>
  );
}

/** Pons live curve: startBps >> floor(t·14 / window) (verified in PonsV2BondingCurve.currentSnipeTaxBps). */
function snipeSchedule(launchpad: TokenSnapshot["launchpad"], startBps: number, windowSec: number): { t: number; bps: number }[] | null {
  if (launchpad !== "pons") return null;
  const out: { t: number; bps: number }[] = [];
  for (let t = 0; t <= windowSec; t++) {
    const bps = t >= windowSec ? 0 : startBps >> Math.floor((t * 14) / windowSec);
    out.push({ t, bps });
  }
  return out;
}

const SPLIT_KIND_LABEL: Record<NonNullable<TokenSnapshot["feeSplit"]>["kind"], string> = {
  "native-locked": "Native, locked",
  splitter: "Claudio FeeSplitter",
  "native-mutable": "Native (admin can override)",
  "splitter-weak": "Splitter (admin can override)",
};

export function InfoTab({ token, detail }: { token: TokenSnapshot; detail?: TokenDetail }) {
  const lp = LAUNCHPADS[token.launchpad];
  const dep = deploymentOf(token.launchpad, token.chain);
  const chain = CHAINS[token.chain];
  const snipe = detail?.launchpadMeta.snipeTax ?? dep?.snipeTax;
  const schedule = snipe ? snipeSchedule(token.launchpad, snipe.startBps, snipe.windowSec) : null;
  const splitKind: SplitSupport = token.feeSplit?.kind ?? lp.split;
  const ageSec = (Date.now() - token.createdAt) / 1000;
  const snipeLive = snipe ? ageSec < snipe.windowSec : false;
  const alerts = token.alerts ?? [];

  return (
    <div className="grid gap-px bg-line lg:grid-cols-2 lg:[&>section:last-child:nth-child(odd)]:col-span-2">
      {alerts.length > 0 && (
        <Section title="Alerts" icon={<AlertTriangle />}>
          <ul className="space-y-1.5">
            {alerts.map((a, i) => (
              <li
                key={`${a.kind}-${a.at}-${i}`}
                className={cn("rounded-[3px] px-2.5 py-1.5 text-xs", a.severity === "danger" ? "chip-sell" : a.severity === "warn" ? "chip-warn" : "chip-info")}
              >
                <span className="font-medium">{a.message}</span> <Age from={a.at} className="text-[10px] opacity-70" />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Fee split" icon={<Shield />}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <SplitBadge kind={splitKind} />
          {token.launchedHere && <span className="chip !bg-brand !text-brand-ink !shadow-none">Launched on Claudio</span>}
          {token.feeSplit && <span className="chip">{SPLIT_KIND_LABEL[token.feeSplit.kind]}</span>}
        </div>
        <p className="text-xs leading-relaxed text-text-2">{lp.splitNote}</p>
        {token.launchedHere && (
          <p className="mt-1.5 text-xs text-text-3">
            Claudio rule: creator {FEE_SPLIT.creatorBps / 100}% / platform {FEE_SPLIT.platformBps / 100}% of the creator-fee stream.
          </p>
        )}
        {token.feeSplit?.splitter && <AddressRow label="Splitter" address={token.feeSplit.splitter} chain={token.chain} />}
        {dep && (
          <div className="mt-1.5">
            {dep.curveFeeBps !== undefined && <Row label="Curve fee">{fmtBps(dep.curveFeeBps)}</Row>}
            {dep.poolFeeBps !== undefined && <Row label="Pool fee">{fmtBps(dep.poolFeeBps)}</Row>}
            {dep.creatorFeeBpsOfVolume !== undefined && <Row label="Creator share of volume">{fmtBps(dep.creatorFeeBpsOfVolume)}</Row>}
          </div>
        )}
      </Section>

      <Section title="Tax" icon={<Percent />}>
        <Row label="Buy tax">
          <span className={cn("num", token.buyTaxBps > 0 && "text-warn")}>{fmtBps(token.buyTaxBps)}</span>
        </Row>
        <Row label="Sell tax">
          <span className={cn("num", token.sellTaxBps > 0 && "text-warn")}>{fmtBps(token.sellTaxBps)}</span>
        </Row>
        {token.taxEndsAt && (
          <Row label="Tax ends">{token.taxEndsAt > Date.now() ? new Date(token.taxEndsAt).toLocaleString() : "Ended"}</Row>
        )}
        {lp.tax.note && <p className="mt-1 text-[11px] text-text-3">{lp.tax.note}</p>}
      </Section>

      {snipe && (
        <Section title="Anti-snipe tax" icon={<Timer />}>
          <p className="mb-2 text-xs text-text-2">
            Buys in the first {snipe.windowSec}s pay a decaying tax starting at {fmtBps(snipe.startBps)}.{" "}
            {snipeLive ? <span className="font-semibold text-warn">Active now.</span> : <span className="text-text-3">Over for this token.</span>}
          </p>
          {schedule ? (
            <div className="flex items-end gap-1">
              {schedule.map((s) => (
                <div key={s.t} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-12 w-full items-end overflow-hidden rounded-[2px] bg-panel-2">
                    <div className="w-full bg-sell" style={{ height: `${Math.max(2, (s.bps / snipe.startBps) * 100)}%`, opacity: s.bps ? 0.85 : 0.2 }} />
                  </div>
                  <span className="num text-[10px] text-text-2">{fmtBps(s.bps)}</span>
                  <span className="num text-[9px] text-text-3">t={s.t}s</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-text-3">Decays to 0% over {snipe.windowSec}s.</p>
          )}
        </Section>
      )}

      <Section title="Launchpad" icon={<Rocket />}>
        <Row label="Platform">
          <a href={lp.site} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text">
            {lp.name} <ExternalLink className="h-3 w-3" />
          </a>
        </Row>
        {dep?.graduationQuote !== undefined && (
          <Row label="Graduates at">
            {fmtNative(detail?.launchpadMeta.graduationQuote ?? dep.graduationQuote)} {chain.nativeSymbol}
          </Row>
        )}
        {(detail?.launchpadMeta.migratesTo ?? dep?.migratesTo) && <Row label="Migrates to"><VenueLabel venue={(detail?.launchpadMeta.migratesTo ?? dep?.migratesTo)!} /></Row>}
        {token.venue && <Row label="Venue"><VenueLabel venue={token.venue} /></Row>}
        {lp.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {lp.warnings.map((w) => (
              <li key={w} className="flex gap-1.5 text-[11px] text-warn">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Contracts" icon={<FileCode2 />}>
        <AddressRow label="Token" address={token.address} chain={token.chain} />
        {token.pool && <AddressRow label={token.phase === "migrated" ? "Pool" : "Curve"} address={token.pool} chain={token.chain} />}
        {dep &&
          Object.entries(dep.contracts).map(([role, addr]) => (
            <AddressRow key={role} label={role.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} address={addr} chain={token.chain} />
          ))}
        {token.createTx && (
          <Row label="Create tx">
            <a href={chain.explorerTx(token.createTx)} target="_blank" rel="noopener noreferrer" className="num inline-flex items-center gap-1 hover:text-text">
              {token.createTx.slice(0, 8)}…{token.createTx.slice(-6)} <ExternalLink className="h-3 w-3" />
            </a>
          </Row>
        )}
      </Section>

      <Section title="Creator" icon={<User />}>
        {token.creator && <AddressRow label="Creator" address={token.creator} chain={token.chain} />}
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          <RepCell label="Launches" v={token.devLaunches} />
          <RepCell label="Migrated" v={token.devMigrations} tone={token.devMigrations > 0 ? "good" : undefined} />
          <RepCell label="Rugs" v={token.devRugs} tone={token.devRugs > 0 ? "bad" : undefined} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={cn("chip", token.devSold ? "chip-sell" : "chip-buy")}>{token.devSold ? "Dev sold" : "Dev holding"}</span>
          <span className="chip">Dev holds {token.devHoldPct.toFixed(1)}%</span>
        </div>
        {token.description && <p className="mt-2 whitespace-pre-line break-words text-xs text-text-2">{token.description}</p>}
      </Section>
    </div>
  );
}

function RepCell({ label, v, tone }: { label: string; v: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-[3px] border border-line px-2 py-2 text-center">
      <div className={cn("num text-[15px] font-medium", tone === "good" ? "text-buy" : tone === "bad" ? "text-sell" : "text-text")}>{v}</div>
      <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3">{label}</div>
    </div>
  );
}
