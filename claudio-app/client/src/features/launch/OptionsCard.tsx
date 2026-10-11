// Launchpad-specific options: tax preset, Pons creator tax, pump Mayhem mode, vanity mint (beta).
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, Info, Lock, Pickaxe, ShieldCheck, Square } from "lucide-react";
import type { ChainId } from "@shared/chains";
import { LAUNCHPADS, deploymentOf, type LaunchpadId } from "@shared/launchpads";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { fmtBps, fmtCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLaunchDraft } from "./draft";
import { Callout, FieldLabel, Segmented, TextInput } from "./ui";
import { BASE58_RE, MAX_ATTEMPTS, type useVanity } from "./vanity";

type VanityApi = ReturnType<typeof useVanity>;

export function hasOptions(chain: ChainId, launchpad?: LaunchpadId): boolean {
  if (!launchpad) return false;
  return LAUNCHPADS[launchpad].tax.supported || launchpad === "pump" || chain === "sol";
}

function ToggleRow({ title, body, checked, onChange, badge }: { icon?: ReactNode; title: string; body: ReactNode; checked: boolean; onChange: (v: boolean) => void; badge?: string }) {
  return (
    <label className="flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[3px] border border-line px-3 py-2.5 transition-colors hover:border-line-2">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          {title}
          {badge && <span className="chip chip-info px-1 py-[2px] text-[9px] font-bold">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-text-3">{body}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}

function fmtDuration(sec: number): string {
  if (!sec) return "Forever";
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} d`;
}

export function OptionsCard({ chain, launchpad, vanity }: { chain: ChainId; launchpad: LaunchpadId; vanity: VanityApi }) {
  const d = useLaunchDraft();
  const lp = LAUNCHPADS[launchpad];
  const maxBps = lp.tax.maxBps ?? 1000;
  const symmetric = !lp.tax.asymmetric;
  const dep = deploymentOf(launchpad, chain);

  return (
    <div className="space-y-3">
      {lp.tax.supported && (
        <div>
          <FieldLabel label="Preset" />
          <Segmented
            layoutId="tax-mode"
            value={d.taxMode}
            onChange={(taxMode) => d.patch({ taxMode })}
            options={[
              { value: "none", label: "Non-Tax" },
              { value: "tax", label: "Tax" },
            ]}
          />
          <AnimatePresence initial={false}>
            {d.taxMode === "tax" && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="space-y-3 pt-3">
                  <TaxSlider
                    label={symmetric ? "Creator tax (buy & sell)" : "Buy tax"}
                    value={d.buyTaxBps}
                    max={maxBps}
                    onChange={(v) => d.patch(symmetric ? { buyTaxBps: v, sellTaxBps: v } : { buyTaxBps: v })}
                  />
                  {!symmetric && <TaxSlider label="Sell tax" value={d.sellTaxBps} max={maxBps} onChange={(v) => d.patch({ sellTaxBps: v })} />}
                  {!symmetric && (
                    <div>
                      <FieldLabel label="Tax duration" hint={fmtDuration(d.taxDurationSec)} />
                      <Segmented
                        layoutId="tax-dur"
                        size="sm"
                        value={String(d.taxDurationSec)}
                        onChange={(v) => d.patch({ taxDurationSec: Number(v) })}
                        options={[0, 3600, 86400, 604800].map((s) => ({ value: String(s), label: fmtDuration(s) }))}
                      />
                    </div>
                  )}
                  <Callout tone="info" icon={<Lock />}>
                    {lp.tax.note ?? "Tax is fixed at launch."} Taxes go to your fee recipient and are shared like other creator fees. Other
                    terminals show the tax on your coin's card.
                  </Callout>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {launchpad === "pump" && (
        <ToggleRow
          icon={<Flame />}
          title="Mayhem mode"
          body={
            <>
              pump.fun's Mayhem mode. Mayhem coins can't be taken over through pump.fun's CTO process, which also makes your fee split
              <b className="text-buy"> takeover-proof</b>. Uses pump.fun's Mayhem fee recipients; read pump.fun's docs for how Mayhem trading works.
            </>
          }
          checked={d.mayhem}
          onChange={(mayhem) => d.patch({ mayhem })}
        />
      )}

      {chain === "sol" && <VanityPanel vanity={vanity} suffixDefault={dep?.vanitySuffix ?? "pump"} />}
    </div>
  );
}

function TaxSlider({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <FieldLabel label={label} hint={<span className="num text-text">{fmtBps(value)}</span>} />
      <div className="flex items-center gap-3">
        <Slider value={[value]} min={0} max={max} step={25} onValueChange={(v) => onChange(v[0] ?? 0)} className="flex-1" />
        <div className="flex gap-1">
          {[100, 300, 500].filter((p) => p <= max).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn("num h-8 rounded-[3px] px-2 text-[11px] font-semibold transition-colors", value === p ? "bg-panel-3 text-text ring-1 ring-inset ring-line-2" : "text-text-3 hover:text-text")}
            >
              {p / 100}%
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function VanityPanel({ vanity, suffixDefault }: { vanity: VanityApi; suffixDefault: string }) {
  const d = useLaunchDraft();
  const st = vanity.state;
  const suffix = d.vanitySuffix || suffixDefault;
  const validSuffix = suffix.length >= 1 && suffix.length <= 5 && BASE58_RE.test(suffix);
  const running = st.status === "running";
  const pct = running ? Math.min(99, (st.attempts / st.expected) * 100) : 0;
  const etaSec = running && st.rate > 0 ? Math.max(0, (st.expected - st.attempts) / st.rate) : undefined;

  return (
    <div className="rounded-[3px] border border-line">
      <ToggleRowInner
        checked={d.vanityEnabled}
        onChange={(v) => {
          d.patch({ vanityEnabled: v });
          if (!v) vanity.reset();
        }}
      />
      <AnimatePresence initial={false}>
        {d.vanityEnabled && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-line p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FieldLabel label="Address ends with" hint="case-sensitive, base58" />
                  <TextInput
                    value={suffix}
                    disabled={running}
                    onChange={(e) => {
                      d.patch({ vanitySuffix: e.target.value.replace(/\s/g, "").slice(0, 5) });
                      vanity.reset();
                    }}
                    className="num"
                    spellCheck={false}
                    invalid={!validSuffix}
                  />
                </div>
                {running ? (
                  <button type="button" onClick={vanity.stop} className="btn-sell h-11 rounded-[3px] px-4 text-[13px] md:h-10">
                    <Square className="h-3.5 w-3.5" /> Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!validSuffix}
                    onClick={() => vanity.start(suffix, true)}
                    className="btn btn-secondary h-11 gap-1.5 px-4 md:h-10"
                  >
                    <Pickaxe className="h-4 w-4" /> {st.status === "found" ? "Regrind" : "Grind"}
                  </button>
                )}
              </div>
              {running && (
                <div>
                  <div className="h-1 overflow-hidden bg-line">
                    <motion.div className="h-full bg-brand" animate={{ width: `${pct}%` }} transition={{ duration: 0.25 }} />
                  </div>
                  <div className="num mt-1.5 flex justify-between text-[11px] text-text-3">
                    <span>
                      {fmtCompact(st.attempts)} / ~{fmtCompact(st.expected)} tries · {st.workers} workers
                    </span>
                    <span>
                      {fmtCompact(st.rate)}/s{etaSec !== undefined ? ` · ETA ${etaSec < 90 ? `${Math.ceil(etaSec)}s` : `${Math.ceil(etaSec / 60)}m`}` : ""}
                    </span>
                  </div>
                </div>
              )}
              {st.status === "found" && (
                <Callout tone="good" icon={<ShieldCheck />}>
                  Found <span className="num break-all text-text">{st.result.publicKey}</span> after {fmtCompact(st.result.attempts)} tries (
                  {(st.ms / 1000).toFixed(1)}s). The key stays in this tab and only signs your create transaction.
                </Callout>
              )}
              {st.status === "exhausted" && <Callout tone="warn">Stopped after {fmtCompact(MAX_ATTEMPTS)} tries — try a shorter suffix.</Callout>}
              {st.status === "error" && <Callout tone="bad">{st.message}</Callout>}
              <p className="flex gap-1.5 text-[11px] leading-snug text-text-3">
                <Info className="mt-[1px] h-3 w-3 shrink-0" />
                Each extra character is ~58× more work. Grinding runs in background workers; closing the tab discards the key.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToggleRowInner({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[56px] cursor-pointer items-start gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          Vanity address
          <span className="chip chip-info px-1 py-[2px] text-[9px] font-bold">BETA</span>
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-text-3">Grind a mint address that ends like pump.fun's (…pump) — in your browser.</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}
