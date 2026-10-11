// Chain + launchpad switches. Each row edits locally and saves with one PUT (audited server side).
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Save } from "lucide-react";
import { CHAINS, type ChainId } from "@shared/chains";
import { LAUNCHPADS } from "@shared/launchpads";
import type { AdminChainRow, AdminLaunchpadRow, ChainSwitchState, SwitchState } from "@shared/platform";
import { ChainBadge, LaunchpadLogo } from "@/components/kit";
import { ActionButton, Card, SwitchLite } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { PLATFORM_KEY } from "@/lib/platform";
import { queryClient } from "@/lib/queryClient";
import { adminApi, invalidateAdmin, useAdminQuery } from "./api";
import { ErrorNote, Input, Loading, StateChip, fmtTime, short } from "./ui";

/** Plain button group (no shared layout animation — many rows render the same options). */
function Choice<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" className="inline-flex shrink-0 rounded-xl bg-panel p-1 ring-1 ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 whitespace-nowrap rounded-[4px] px-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50",
            o.value === value ? "bg-panel-3 text-text shadow-sm ring-1 ring-line-2" : "text-text-3 hover:text-text-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function afterSave() {
  void invalidateAdmin();
  void queryClient.invalidateQueries({ queryKey: PLATFORM_KEY });
}

function Updated({ by, at }: { by?: string | null; at?: string | null }) {
  if (!by && !at) return null;
  return (
    <span className="num text-[10.5px] text-text-3">
      updated {fmtTime(at)}
      {by ? ` by ${short(by)}` : ""}
    </span>
  );
}

const CHAIN_STATES: { value: ChainSwitchState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "view_only", label: "View only" },
  { value: "coming_soon", label: "Coming soon" },
];

function ChainEditor({ row }: { row: AdminChainRow }) {
  const [state, setState] = useState<ChainSwitchState>(row.state);
  const [note, setNote] = useState(row.note ?? "");
  useEffect(() => {
    setState(row.state);
    setNote(row.note ?? "");
  }, [row.state, row.note]);
  const save = useMutation({ mutationFn: () => adminApi.putChain({ chain: row.chain, state, note: note.trim() || null }), onSuccess: afterSave });
  const dirty = state !== row.state || (note.trim() || null) !== (row.note ?? null);
  const info = CHAINS[row.chain as ChainId];
  return (
    <li className="space-y-2.5 py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <ChainBadge chain={row.chain as ChainId} />
        <span className="text-[13.5px] font-bold">{info?.name ?? row.chain}</span>
        <span className="text-[11px] text-text-3">effective</span>
        <StateChip state={row.effective} />
        <span className="ml-auto">
          <Updated by={row.updatedBy} at={row.updatedAt} />
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Choice value={state} options={CHAIN_STATES} onChange={setState} />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note shown to users (optional)" maxLength={200} />
        <ActionButton tone={dirty ? "brand" : "soft"} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()} className="shrink-0">
          {save.isSuccess && !dirty ? <Check /> : <Save />} Save
        </ActionButton>
      </div>
      {save.error && <ErrorNote error={save.error} />}
    </li>
  );
}

export function ChainsTab() {
  const q = useAdminQuery(["chains"], adminApi.chains);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <Card title="Chains" right={<span className="text-[11px] text-text-3">Solana is the only live chain; others stay visible as "coming soon".</span>}>
      <ul className="divide-y divide-line">
        {q.data!.chains.map((r) => (
          <ChainEditor key={r.chain} row={r} />
        ))}
      </ul>
    </Card>
  );
}

const PAD_STATES: { value: SwitchState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "hidden", label: "Hidden" },
];

function LaunchpadEditor({ row }: { row: AdminLaunchpadRow }) {
  const [state, setState] = useState<SwitchState>(row.state);
  const [allowAgents, setAllowAgents] = useState(row.allowAgents);
  const [note, setNote] = useState(row.note ?? "");
  useEffect(() => {
    setState(row.state);
    setAllowAgents(row.allowAgents);
    setNote(row.note ?? "");
  }, [row.state, row.allowAgents, row.note]);
  const save = useMutation({
    mutationFn: () => adminApi.putLaunchpad({ launchpad: row.launchpad, chain: row.chain, state, allowAgents, note: note.trim() || null }),
    onSuccess: afterSave,
  });
  const dirty = state !== row.state || allowAgents !== row.allowAgents || (note.trim() || null) !== (row.note ?? null);
  const lp = LAUNCHPADS[row.launchpad];
  const stricter = row.effective !== row.state;
  return (
    <li className="space-y-2.5 py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        {lp && <LaunchpadLogo id={row.launchpad} size={18} />}
        <span className="text-[13.5px] font-bold">{lp?.name ?? row.launchpad}</span>
        <span className="chip">adapter {row.adapter}</span>
        {!row.capable && <span className="chip chip-warn">not buildable</span>}
        <span className="text-[11px] text-text-3">effective</span>
        <StateChip state={row.effective} />
        <span className="ml-auto">
          <Updated by={row.updatedBy} at={row.updatedAt} />
        </span>
      </div>
      {stricter && row.reason && <div className="text-[11.5px] leading-snug text-warn">Effective is stricter than the switch: {row.reason}</div>}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <Choice value={state} options={PAD_STATES} onChange={setState} />
          <label className="flex items-center gap-2 text-[12px] text-text-2">
            <SwitchLite checked={allowAgents} onChange={setAllowAgents} />
            Agents may launch
          </label>
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note shown next to the launchpad (optional)" maxLength={200} />
        <ActionButton tone={dirty ? "brand" : "soft"} disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()} className="shrink-0">
          {save.isSuccess && !dirty ? <Check /> : <Save />} Save
        </ActionButton>
      </div>
      {save.error && <ErrorNote error={save.error} />}
    </li>
  );
}

export function LaunchpadsTab() {
  const q = useAdminQuery(["launchpads"], adminApi.launchpads);
  const groups = useMemo(() => {
    const m = new Map<string, AdminLaunchpadRow[]>();
    for (const r of q.data?.launchpads ?? []) m.set(r.chain, [...(m.get(r.chain) ?? []), r]);
    return Array.from(m.entries());
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="space-y-4">
      {groups.map(([chain, rows]) => (
        <Card
          key={chain}
          title={
            <span className="flex items-center gap-2">
              <ChainBadge chain={chain as ChainId} /> {CHAINS[chain as ChainId]?.name ?? chain}
            </span>
          }
        >
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <LaunchpadEditor key={`${r.launchpad}:${r.chain}`} row={r} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
