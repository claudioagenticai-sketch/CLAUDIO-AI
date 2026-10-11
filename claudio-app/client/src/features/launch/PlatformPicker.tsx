// Chain switcher + launchpad chips + detail card. Availability = the platform switches (GET /api/platform/config,
// admin-controlled, already capped by what the code can do) AND the adapter status: only Solana · pump.fun is open
// today; everything else is shown as "Coming soon" with the admin's note, and hidden pads aren't rendered.
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, Coins, Layers, Percent, Target } from "lucide-react";
import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS, deploymentOf, launchpadsForChain, type AdapterStatus, type LaunchpadId, type LaunchpadInfo } from "@shared/launchpads";
import { DEFAULT_CHAIN, DEFAULT_LAUNCHPAD, type SwitchState } from "@shared/platform";
import { useChainState, useLaunchpadState, usePlatformConfig } from "@/lib/platform";
import { ChainBadge, LaunchpadLogo, SplitBadge } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtNative, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdapterInfo } from "./api";
import { Segmented } from "./ui";

/** Chains with at least one launchpad, Solana (the default) first. */
export const LAUNCH_CHAINS: ChainId[] = ENABLED_CHAINS.filter((c) => launchpadsForChain(c).length > 0).sort(
  (a, b) => Number(b === DEFAULT_CHAIN) - Number(a === DEFAULT_CHAIN),
);

export function adapterStatus(id: LaunchpadId, adapters?: AdapterInfo[]): AdapterStatus {
  return adapters?.find((a) => a.id === id)?.status ?? LAUNCHPADS[id].adapter;
}

export function isLaunchable(status: AdapterStatus): boolean {
  return status === "live" || status === "beta";
}

export interface PadAvailability {
  /** Effective platform state of this pad on this chain. */
  state: SwitchState;
  note?: string | null;
  /** Selectable: platform open (pad + chain) and the adapter is beta/live. */
  open: boolean;
}

/**
 * Availability of every launchpad on `chain`, for selection logic outside the chips (one hook call, stable count).
 * Same fallbacks as useLaunchpadState: before the config loads only Solana · pump.fun counts as open.
 */
export function usePadAvailability(chain: ChainId, adapters?: AdapterInfo[]): (id: LaunchpadId) => PadAvailability {
  const { data } = usePlatformConfig();
  const chainState = useChainState(chain);
  return (id) => {
    const row = data?.launchpads.find((l) => l.launchpad === id && l.chain === chain);
    const state: SwitchState = row ? row.effective : id === DEFAULT_LAUNCHPAD && chain === DEFAULT_CHAIN ? "open" : "coming_soon";
    return { state, note: row?.note, open: state === "open" && chainState === "open" && isLaunchable(adapterStatus(id, adapters)) };
  };
}

/** Admin note + state of a chain (for the "coming soon" callout). */
export function useChainNote(chain: ChainId): { state: ReturnType<typeof useChainState>; note?: string | null } {
  const { data } = usePlatformConfig();
  const state = useChainState(chain);
  return { state, note: data?.chains.find((c) => c.chain === chain)?.note };
}

function ChainTabLabel({ chain }: { chain: ChainId }) {
  const state = useChainState(chain);
  return (
    <>
      <ChainBadge chain={chain} />
      {CHAINS[chain].short}
      {state !== "open" && <span className="ml-1 text-[9px] font-bold uppercase tracking-wider text-text-3">soon</span>}
    </>
  );
}

export function ChainSwitch({ chain, onChange }: { chain: ChainId; onChange: (c: ChainId) => void }) {
  return (
    <Segmented
      layoutId="launch-chain"
      size="sm"
      value={chain}
      onChange={onChange}
      className="w-full sm:w-auto"
      options={LAUNCH_CHAINS.map((c) => ({
        value: c,
        label: <ChainTabLabel chain={c} />,
      }))}
    />
  );
}

function StatusPill({ status }: { status: AdapterStatus }) {
  const map: Record<AdapterStatus, { label: string; cls: string }> = {
    live: { label: "LIVE", cls: "chip-buy" },
    beta: { label: "BETA", cls: "chip-info" },
    planned: { label: "SOON", cls: "" },
    blocked: { label: "N/A", cls: "chip-sell" },
  };
  const m = map[status];
  return <span className={cn("chip px-1 py-[2px] text-[8.5px] font-bold tracking-wider", m.cls)}>{m.label}</span>;
}

export function PlatformChips({
  chain,
  value,
  onChange,
  adapters,
}: {
  chain: ChainId;
  value?: LaunchpadId;
  onChange: (id: LaunchpadId) => void;
  adapters?: AdapterInfo[];
}) {
  const list = launchpadsForChain(chain);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {list.map((lp) => (
        <PlatformChip key={`${chain}:${lp.id}`} lp={lp} chain={chain} active={value === lp.id} onChange={onChange} adapters={adapters} />
      ))}
    </div>
  );
}

function PlatformChip({
  lp,
  chain,
  active,
  onChange,
  adapters,
}: {
  lp: LaunchpadInfo;
  chain: ChainId;
  active: boolean;
  onChange: (id: LaunchpadId) => void;
  adapters?: AdapterInfo[];
}) {
  const pad = useLaunchpadState(lp.id, chain);
  const chainState = useChainState(chain);
  if (pad.state === "hidden") return null;
  const status = adapterStatus(lp.id, adapters);
  const enabled = pad.state === "open" && chainState === "open" && isLaunchable(status);
  const adapterNote = adapters?.find((a) => a.id === lp.id)?.note;
  const chip = (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => onChange(lp.id)}
      aria-pressed={active}
      className={cn(
        "relative flex min-h-[58px] w-full items-center gap-2.5 rounded-[3px] border px-2.5 py-2 text-left transition-[border-color,background-color]",
        active ? "border-brand/70 bg-brand-bg/60" : "border-line hover:border-line-2",
        !enabled && "cursor-not-allowed opacity-45 hover:border-line",
      )}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] ring-1 ring-inset ring-line-2"
        aria-hidden
      >
        <LaunchpadLogo id={lp.id} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center gap-1.5 text-[13px] font-bold", active ? "text-text" : "text-text-2")}>
          <span className="truncate">{lp.name}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-text-3">
          {enabled ? <StatusPill status={status} /> : <SoonPill />}
          <span className="truncate">{lp.model === "curve" ? "Curve" : "Instant"}</span>
        </span>
      </span>
      {active && enabled && (
        <motion.span
          layoutId="platform-active"
          className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-[2px] bg-brand text-brand-ink"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
        </motion.span>
      )}
    </button>
  );
  if (enabled) return <div>{chip}</div>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="block rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-brand">
          {chip}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">
        Coming soon{pad.note ? ` — ${pad.note}` : chainState !== "open" ? ` — ${CHAINS[chain].name} launches aren't open yet` : adapterNote ? ` — ${adapterNote}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function SoonPill() {
  return <span className="chip px-1 py-[2px] text-[8.5px] font-bold tracking-wider">SOON</span>;
}

function Spec({ label, children, sub }: { icon?: ReactNode; label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[3px] border border-line px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{label}</div>
      <div className="mt-1 text-[13px] font-semibold leading-snug text-text">{children}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-text-3">{sub}</div>}
    </div>
  );
}

export function PlatformDetail({ lp, chain, nativeUsd }: { lp: LaunchpadInfo; chain: ChainId; nativeUsd?: number }) {
  const d = deploymentOf(lp.id, chain);
  const native = CHAINS[chain].nativeSymbol;
  const creatorVol = d?.creatorFeeBpsOfVolume;
  const postGrad = d?.postGradCreatorFee;
  const postGradRange = postGrad?.tiers.length
    ? `${(Math.max(...postGrad.tiers.map((t) => t.creatorBps)) / 100).toFixed(2)}% → ${(Math.min(...postGrad.tiers.map((t) => t.creatorBps)) / 100).toFixed(2)}%`
    : undefined;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={`${lp.id}:${chain}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.16 }}
        className="mt-3"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold">{lp.name}</span>
          <SplitBadge kind={lp.split} />
          {lp.tax.supported && <span className="chip chip-info">Tax ≤ {((lp.tax.maxBps ?? 0) / 100).toFixed(0)}%</span>}
          <a href={lp.site} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-text-3 hover:text-text">
            {lp.site.replace(/^https?:\/\//, "")} ↗
          </a>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Spec icon={<Layers />} label="Model">
            {lp.model === "curve" ? "Bonding curve → migrates" : "Instant pool (no curve)"}
          </Spec>
          {lp.model === "curve" ? (
            <Spec
              icon={<Target />}
              label="Graduation"
              sub={
                d?.graduationQuote && (nativeUsd || d.migratesTo) ? (
                  <>
                    {nativeUsd ? <>~{fmtUsd(d.graduationQuote * nativeUsd)}</> : null}
                    {d.migratesTo && (
                      <>
                        {nativeUsd ? " " : ""}
                        <ArrowRight className="inline h-3 w-3" /> {d.migratesTo}
                      </>
                    )}
                  </>
                ) : undefined
              }
            >
              {d?.graduationQuote ? (
                <>
                  <span className="num">{fmtNative(d.graduationQuote)}</span> {native}
                </>
              ) : (
                <span className="text-text-3">{d?.migratesTo ?? "—"}</span>
              )}
            </Spec>
          ) : d?.milestone ? (
            <Spec icon={<Target />} label="Milestone">
              {d.milestone.unit === "native-liquidity" ? `${d.milestone.value} ${native} liquidity` : `${fmtUsd(d.milestone.value)} ${d.milestone.unit === "usd-fdv" ? "FDV" : "mcap"}`}
            </Spec>
          ) : (
            <Spec icon={<Target />} label="Milestone">
              <span className="text-text-3">—</span>
            </Spec>
          )}
          <Spec icon={<Coins />} label="Launch fee">
            {d?.launchFeeNative ? (
              <>
                <span className="num">{fmtNative(d.launchFeeNative)}</span> {native}
              </>
            ) : (
              "None"
            )}
          </Spec>
          <Spec
            icon={<Percent />}
            label="Creator fee"
            sub={
              postGradRange ? (
                <span title={postGrad?.note}>
                  after graduation: <span className="num">{postGradRange}</span> by market cap
                </span>
              ) : undefined
            }
          >
            {creatorVol !== undefined ? (
              <>
                <span className="num">{(creatorVol / 100).toFixed(2)}%</span> of volume
              </>
            ) : (
              <span className="text-text-3">Set by the platform</span>
            )}
          </Spec>
        </div>
        <div className="mt-2.5 space-y-1 text-[11.5px] leading-snug text-text-3">
          <p>{lp.splitNote}</p>
          {lp.tax.note && <p>Tax: {lp.tax.note}</p>}
        </div>
        {lp.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {lp.warnings.map((w) => (
              <li key={w} className="flex gap-1.5 text-[11.5px] leading-snug text-warn">
                <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
                <span className="text-text-2">{w}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
