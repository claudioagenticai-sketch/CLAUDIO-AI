// Token (spl_config), Collector (run now, runs, payouts) and Audit tabs.
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Coins, History, Play, ReceiptText, Save, ScrollText } from "lucide-react";
import { CHAINS } from "@shared/chains";
import { PLATFORM_KEY } from "@/lib/platform";
import { queryClient } from "@/lib/queryClient";
import { ActionButton, Card } from "@/features/wallet/ui";
import { adminApi, invalidateAdmin, useAdminQuery } from "./api";
import { AuditTable, CollectorSummary } from "./Overview";
import { ErrorNote, Input, KV, Loading, Table, Td, Warn, fmtSol, fmtTime, short } from "./ui";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px] font-semibold text-text-2">
        {label}
        {hint && <span className="font-normal text-text-3">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-[11px] text-sell">{error}</span>}
    </label>
  );
}

export function TokenTab() {
  const q = useAdminQuery(["spl-config"], adminApi.splConfig);
  const [mint, setMint] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [decimals, setDecimals] = useState("6");
  const t = q.data?.token;
  useEffect(() => {
    if (!t) return;
    setMint(t.mint);
    setSymbol(t.symbol);
    setName(t.name);
    setDecimals(String(t.decimals));
  }, [t]);
  const save = useMutation({
    mutationFn: () => adminApi.putSplConfig({ mint: mint.trim(), symbol: symbol.trim(), name: name.trim(), decimals: Number(decimals) }),
    onSuccess: () => {
      void invalidateAdmin();
      void queryClient.invalidateQueries({ queryKey: PLATFORM_KEY });
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;

  const errs = {
    mint: BASE58.test(mint.trim()) ? null : "Not a base58 Solana address",
    symbol: /^[A-Z0-9]{1,10}$/.test(symbol.trim()) ? null : "1–10 characters, A–Z and 0–9 only",
    name: name.trim().length >= 1 && name.trim().length <= 32 ? null : "1–32 characters",
    decimals: /^\d$/.test(decimals) ? null : "0–9",
  };
  const valid = !Object.values(errs).some(Boolean);
  const dirty = !!t && (mint.trim() !== t.mint || symbol.trim() !== t.symbol || name.trim() !== t.name || Number(decimals) !== t.decimals);

  return (
    <Card title="$CLAUDIO token (spl_config)" icon={<Coins />}>
      <div className="space-y-3">
        <Warn>
          This is the single site-wide token row: the coming-soon page, Home and every "$CLAUDIO" link read it. Change it only if the official mint
          really changed — a wrong mint sends people to the wrong coin.
        </Warn>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Mint" hint="Solana, base58" error={mint && errs.mint}>
              <Input value={mint} onChange={(e) => setMint(e.target.value)} invalid={!!errs.mint} spellCheck={false} autoCapitalize="off" className="num" />
            </Field>
          </div>
          <Field label="Symbol" hint="A–Z 0–9, ≤ 10" error={errs.symbol}>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} invalid={!!errs.symbol} maxLength={10} />
          </Field>
          <Field label="Name" error={errs.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} invalid={!!errs.name} maxLength={32} />
          </Field>
          <Field label="Decimals" hint="0–9" error={errs.decimals}>
            <Input value={decimals} onChange={(e) => setDecimals(e.target.value.replace(/[^0-9]/g, "").slice(0, 1))} inputMode="numeric" invalid={!!errs.decimals} />
          </Field>
          <div className="flex items-end">
            <div className="w-full rounded-xl border border-line bg-bg-elev px-3 py-1">
              <KV label="Key / chain">
                {t?.key ?? "claudio"} · {t?.chain ?? "solana"}
              </KV>
              <KV label="Updated">
                {fmtTime(q.data?.updatedAt)}
                {q.data?.updatedBy ? ` by ${short(q.data.updatedBy)}` : ""}
              </KV>
            </div>
          </div>
        </div>
        {save.error && <ErrorNote error={save.error} />}
        <div className="flex justify-end">
          <ActionButton disabled={!valid || !dirty} busy={save.isPending} onClick={() => save.mutate()}>
            <Save /> Save token
          </ActionButton>
        </div>
      </div>
    </Card>
  );
}

export function CollectorTab() {
  const q = useAdminQuery(["collector"], adminApi.collector, { refetchInterval: 20_000 });
  const run = useMutation({ mutationFn: adminApi.runCollector, onSuccess: () => void invalidateAdmin() });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const last = run.data?.run;
  return (
    <div className="space-y-4">
      <Card
        title="Collector bot"
        icon={<Bot />}
        right={
          <ActionButton tone="brand" busy={run.isPending || d.status.running} disabled={!d.status.enabled} onClick={() => run.mutate()} className="h-9 md:h-9">
            <Play /> Run now
          </ActionButton>
        }
      >
        <CollectorSummary status={d.status} />
        <p className="mt-3 text-[11.5px] leading-snug text-text-3">
          The bot only calls pump.fun's permissionless distribute instruction (and, for graduated coins, moves PumpSwap creator fees into the curve vault
          first). It pays the network fee; it never holds or redirects anyone's fees.
        </p>
        {run.error && (
          <div className="mt-3">
            <ErrorNote error={run.error} />
          </div>
        )}
        {last && (
          <div className="mt-3 rounded-xl border border-line bg-bg-elev px-3 py-2 text-[12px] text-text-2">
            Pass finished: {last.coinsChecked} checked, {last.distributed} distributed, {fmtSol(last.paidLamports, true)} paid
            {last.dryRun ? " (dry run)" : ""}
            {last.errors.length ? <span className="text-sell"> · {last.errors.join("; ")}</span> : null}
          </div>
        )}
      </Card>
      <Card title="Recent runs" icon={<History />}>
        <Table head={["Started", "Trigger", "Checked", "Paid coins", "Paid", "Txs", "Errors"]} empty={!d.runs.length}>
          {d.runs.map((r) => (
            <tr key={r.id}>
              <Td className="num whitespace-nowrap">{fmtTime(r.startedAt)}</Td>
              <Td>
                {r.trigger}
                {r.dryRun ? <span className="chip ml-1">dry</span> : null}
              </Td>
              <Td className="num">{r.coinsChecked}</Td>
              <Td className="num">{r.distributed}</Td>
              <Td className="num whitespace-nowrap">{fmtSol(r.paidLamports, true)}</Td>
              <Td className="num">
                {r.txs.map((tx) => (
                  <a key={tx} href={CHAINS.sol.explorerTx(tx)} target="_blank" rel="noreferrer" className="mr-1.5 hover:text-text hover:underline">
                    {short(tx, 5, 4)}
                  </a>
                ))}
                {!r.txs.length && "—"}
              </Td>
              <Td className="max-w-[240px]">
                <span className={r.errors.length ? "text-sell" : "text-text-3"} title={r.errors.join("\n")}>
                  {r.errors.length ? r.errors.join("; ") : "—"}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Payouts" icon={<ReceiptText />}>
        <Table head={["When", "Token", "Amount", "Recipients", "Tx"]} empty={!d.payouts.length}>
          {d.payouts.map((p) => (
            <tr key={p.id}>
              <Td className="num whitespace-nowrap">{fmtTime(p.at)}</Td>
              <Td className="num whitespace-nowrap">{short(p.tokenKey.replace(/^sol:/, ""), 5, 4)}</Td>
              <Td className="num whitespace-nowrap font-semibold text-text">{fmtSol(p.amountLamports, true)}</Td>
              <Td>
                {p.recipients.map((r) => (
                  <div key={r.address} className="num whitespace-nowrap text-[11px]">
                    {short(r.address)} · {r.bps / 100}% · {fmtSol(r.lamports, true)}
                  </div>
                ))}
              </Td>
              <Td className="num">
                <a href={CHAINS.sol.explorerTx(p.tx)} target="_blank" rel="noreferrer" className="hover:text-text hover:underline">
                  {short(p.tx, 5, 4)} ↗
                </a>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

export function AuditTab() {
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const [limit, setLimit] = useState(100);
  const q = useAdminQuery(["audit", applied, limit], () => adminApi.audit(applied, limit));
  return (
    <Card title="Audit log" icon={<ScrollText />}>
      <form
        className="mb-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(action.trim());
        }}
      >
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action, e.g. admin.login or platform.launchpad" spellCheck={false} autoCapitalize="off" />
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="h-10 shrink-0 rounded-xl border border-line-2 bg-bg-elev px-3 text-[13px] text-text outline-none"
          aria-label="Rows"
        >
          {[50, 100, 250, 500].map((n) => (
            <option key={n} value={n}>
              {n} rows
            </option>
          ))}
        </select>
        <ActionButton type="submit" tone="soft" className="shrink-0">
          Apply
        </ActionButton>
      </form>
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : <AuditTable events={q.data!.events} />}
    </Card>
  );
}
