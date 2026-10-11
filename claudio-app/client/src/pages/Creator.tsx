// Creator dashboard: launches made through Claudio, accrued fees, Harvest, and fee-split risk alerts.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Crown, HandCoins, Loader2, Lock, Rocket, ShieldAlert, ShieldCheck, Eye, TrendingUp } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { FEE_SPLIT, LAUNCHPADS, type LaunchpadId } from "@shared/launchpads";
import { BRAND } from "@shared/brand";
import { LaunchpadBadge } from "@/components/kit";
import { useBoard } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Page, PageHeader, Segmented } from "@/features/wallet/ui";
import { LaunchCard } from "@/features/creator/LaunchCard";
import { SPLIT_RISK, tokenKey, useCreatorLaunches, type CreatorLaunch } from "@/features/creator/model";
import { Callout, HeroEmpty, SectionTitle, StatTile, Steps, linkButton } from "@/features/portfolio/pageKit";

type Filter = "all" | ChainId;

export default function Creator() {
  const { launches, creators, query } = useCreatorLaunches();
  const [filter, setFilter] = useState<Filter>("all");
  const tokens = useBoard((s) => s.tokens);
  const mobile = useIsMobile();

  const visible = filter === "all" ? launches : launches.filter((l) => l.chain === filter);
  const chains = useMemo(() => Array.from(new Set(launches.map((l) => l.chain))), [launches]);
  const live = launches.filter((l) => l.status === "confirmed").length;
  const pads = useMemo(() => Array.from(new Set(launches.map((l) => l.launchpad))), [launches]);
  const creatorPct = FEE_SPLIT.creatorBps / 100;
  const platformPct = FEE_SPLIT.platformBps / 100;

  const alertCount = useMemo(
    () =>
      launches.reduce((n, l) => {
        if (!l.token) return n;
        const t = tokens[tokenKey(l.chain, l.token)];
        return n + (t?.alerts.filter((a) => a.kind === "fee-recipient-change-proposed" || a.kind === "fee-split-reset").length ?? 0);
      }, 0),
    [launches, tokens],
  );

  return (
    <Page>
      <PageHeader
        title="Creator"
        icon={<Crown />}
        subtitle={
          <>
            Your launches through {BRAND.full}. Fees split {creatorPct}/{platformPct} on-chain; harvest any time.
          </>
        }
        actions={
          mobile ? undefined : (
            <Link href="/launch" className={linkButton("brand")}>
              <Rocket /> New launch
            </Link>
          )
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatTile label="Launches" value={launches.length} icon={<Rocket />} sub={chains.length ? `on ${chains.map((c) => CHAINS[c].short).join(", ")}` : "none yet"} />
        <StatTile label="Live" value={live} tone={live ? "buy" : "neutral"} icon={<TrendingUp />} sub={`${launches.length - live} pending or local`} />
        <StatTile
          label="Split alerts"
          value={alertCount}
          tone={alertCount ? "sell" : "neutral"}
          icon={alertCount ? <ShieldAlert /> : <ShieldCheck />}
          sub={alertCount ? "harvest now" : "all clear"}
          className={cn(alertCount > 0 && "border-sell/50")}
        />
        <StatTile label="Your share" value={`${creatorPct}%`} icon={<HandCoins />}>
          <div className="mt-2.5 flex h-1 gap-0.5 overflow-hidden">
            <span className="h-full bg-brand" style={{ width: `${creatorPct}%` }} />
            <span className="h-full flex-1 bg-line-2" />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-text-3">
            <span>you {creatorPct}%</span>
            <span>
              {BRAND.full} {platformPct}%
            </span>
          </div>
        </StatTile>
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-5">
        <section className="min-w-0 space-y-3">
          <SectionTitle
            num="01"
            rule
            title="Your launches"
            count={visible.length}
            right={
              chains.length > 1 ? (
                <Segmented
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  options={(["all", ...chains] as Filter[]).map((f) => ({ value: f, label: f === "all" ? "All" : CHAINS[f].short }))}
                />
              ) : undefined
            }
          />
          {query.isLoading && !launches.length ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="panel h-[168px] sheen" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <HeroEmpty
              icon={<Rocket />}
              eyebrow={creators.length ? "No launches yet" : "No wallet connected"}
              title={creators.length ? "Your first coin is one shot away" : "Connect a wallet to start creating"}
              hint={
                creators.length
                  ? "Coins you launch here show up with their fee split, accrued fees and a Harvest button."
                  : "Create or connect a wallet, then launch your first coin."
              }
              actions={
                <Link href="/launch" className={linkButton("brand")}>
                  <Rocket /> Launch a coin
                </Link>
              }
            >
              <Steps
                steps={[
                  { title: "Launch", body: "Pick a launchpad, name it, ship it." },
                  { title: "Trade", body: `Every trade pays ${creatorPct}% of creator fees to you.` },
                  { title: "Harvest", body: "Claim accrued fees any time, on-chain." },
                ]}
              />
            </HeroEmpty>
          ) : (
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {visible.map((l, i) => (
                  <LaunchCard key={l.id} launch={l} index={i} />
                ))}
              </AnimatePresence>
            </div>
          )}
          {query.isError && (
            <Callout tone="warn" icon={<AlertTriangle />}>
              Couldn't load launches from the server — showing this browser's history.
            </Callout>
          )}
          {query.isFetching && launches.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-3">
              <Loader2 className="h-3 w-3 animate-spin" /> refreshing
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start">
          <SectionTitle num="02" rule title="Fee-split risks" />
          <RiskPanel pads={pads.length ? pads : (["pons", "pump", "clanker"] as LaunchpadId[])} launches={launches} />
        </aside>
      </div>
    </Page>
  );
}

const LEVEL = {
  locked: { label: "Locked", Icon: Lock, text: "text-buy", edge: "bg-buy", chip: "chip-buy" },
  watch: { label: "Watch", Icon: Eye, text: "text-warn", edge: "bg-warn", chip: "chip-warn" },
  risk: { label: "Admin override", Icon: AlertTriangle, text: "text-sell", edge: "bg-sell", chip: "chip-sell" },
} as const;

function RiskPanel({ pads, launches }: { pads: LaunchpadId[]; launches: CreatorLaunch[] }) {
  return (
    <div className="space-y-2.5">
      <p className="text-[12px] leading-relaxed text-text-3">
        Your share can never be lowered by you or {BRAND.full}. Some launchpads' admins can still redirect or reset fee recipients — here's what we watch
        for each one you use.
      </p>
      {pads.map((id) => {
        const risk = SPLIT_RISK[id];
        const lp = LAUNCHPADS[id];
        const count = launches.filter((l) => l.launchpad === id).length;
        const lv = LEVEL[risk?.level ?? "watch"];
        return (
          <motion.div key={id} layout className="panel relative overflow-hidden py-3 pl-4 pr-3.5">
            <span aria-hidden className={cn("absolute bottom-3 left-0 top-3 w-[2px]", lv.edge)} />
            <div className="flex items-center gap-2">
              <LaunchpadBadge id={id} size={18} />
              <span className="text-[13px] font-semibold">{lp.name}</span>
              {count > 0 && <span className="num text-[11px] text-text-3">×{count}</span>}
              <span className={cn("chip ml-auto", lv.chip)}>
                <lv.Icon className="h-3 w-3" />
                {lv.label}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-text-2">{risk?.text ?? lp.splitNote}</p>
            {risk && risk.events.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {risk.events.map((e) => (
                  <span key={e} className="chip normal-case tracking-normal">
                    {e}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        );
      })}
      <Callout tone="buy" icon={<ShieldCheck />} title="If an alert fires">
        When a fee-recipient change is proposed or a split is reset, the launch card turns red and shows the alert. Harvest right away — fees already credited to
        your splitter stay yours.
      </Callout>
    </div>
  );
}
