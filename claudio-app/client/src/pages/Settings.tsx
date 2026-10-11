// Settings — execution presets, quick-buy/sell presets, board prefs, blocklists, watchlist, security, data sources, app.

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Ban,
  ChevronRight,
  Gauge,
  Gift,
  LayoutGrid,
  Lock,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  Share,
  Smartphone,
  Star,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtAge, fmtCompact, shortAddr } from "@/lib/format";
import { haptic, useBoard, useSettings, type ExecPreset, type ExecSettings } from "@/lib/store";
import { toast } from "@/hooks/use-toast";
import { ChainBadge, Empty, LiveDot, TokenAvatar } from "@/components/kit";
import { useIsAdminWallet } from "@/lib/session";
import { useChainStates, useOpenChains } from "@/lib/openChains";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CHAINS, ENABLED_CHAINS, type ChainId } from "@shared/chains";
import type { ChainStatus } from "@shared/types";
import { useWallet } from "@/lib/wallet";
import { setAutoLockMinutes } from "@/lib/wallet/keystore";
import { kindOfAddress } from "@/lib/wallet/keys";
import { Page, PageHeader, ActionButton, Segmented, Toggle } from "@/features/wallet/ui";
import { ChipEditor, ListEditor, NumberField, PillChoice } from "@/features/settings/fields";
import { isIos, promptInstall, usePwa } from "@/features/settings/pwa";

const AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60, 240];

const SECTIONS: { id: string; label: string; icon: ReactNode; hint: string }[] = [
  { id: "execution", label: "Execution", icon: <Zap />, hint: "Slippage, fees and routing for P1–P3" },
  { id: "amounts", label: "Amounts", icon: <Gauge />, hint: "Quick-buy and sell presets per chain" },
  { id: "board", label: "Board", icon: <LayoutGrid />, hint: "How the live board behaves" },
  { id: "blocklists", label: "Blocklists", icon: <Ban />, hint: "Hide creators and keywords everywhere" },
  { id: "watchlist", label: "Watchlist", icon: <Star />, hint: "Tokens you starred" },
  { id: "security", label: "Security", icon: <Lock />, hint: "Wallet auto-lock" },
  { id: "referral", label: "Referral", icon: <Gift />, hint: "Code applied to your launches and trades" },
  { id: "data", label: "Data sources", icon: <Server />, hint: "Live feed health per chain" },
  { id: "app", label: "App", icon: <Smartphone />, hint: "Install and reset" },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** A titled settings section: header outside, content in a panel below. `id` is the scroll/nav anchor. */
function Section({ id, right, children, bodyClassName }: { id: string; right?: ReactNode; children: ReactNode; bodyClassName?: string }) {
  const i = SECTIONS.findIndex((x) => x.id === id);
  const meta = SECTIONS[i];
  return (
    <section id={id} className="scroll-mt-28 md:scroll-mt-6">
      <header className="mb-3 flex items-end justify-between gap-3 border-t border-line px-0.5 pt-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="section-num shrink-0 pt-1">{String(i + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <h2 className="display-section flex items-baseline gap-2 text-text">{sectionTitle(id)}</h2>
            <p className="mt-1.5 truncate text-xs text-text-3">{meta.hint}</p>
          </div>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </header>
      <div className={cn("panel overflow-hidden", bodyClassName)}>{children}</div>
    </section>
  );
}

const TITLES: Record<string, string> = {
  execution: "Execution presets",
  amounts: "Quick-buy & sell amounts",
  board: "Board",
  blocklists: "Blocklists",
  watchlist: "Watchlist",
  security: "Wallet security",
  referral: "Referral code",
  data: "Data sources",
  app: "App",
};
function sectionTitle(id: string): string {
  return TITLES[id] ?? id;
}

/** One setting: label + explanation on the left, control on the right (stacked on phones). */
function Row({ label, hint, children, className, controlClassName }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; controlClassName?: string }) {
  return (
    <div className={cn("grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:items-center md:gap-8 md:px-5", className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-text-3">{hint}</div>}
      </div>
      <div className={cn("min-w-0", controlClassName)}>{children}</div>
    </div>
  );
}

// ─── Execution presets ──────────────────────────────────────────────

const CHAIN_NOTES: { chain: ChainId; title: string; body: string }[] = [
  {
    chain: "sol",
    title: "Solana · priority + Jito",
    body: "Priority fee (compute-unit price) and the Jito tip both raise your odds of landing in busy slots. MEV protect sends through Jito bundles only, so you can't be sandwiched.",
  },
  {
    chain: "hood",
    title: "Robinhood Chain · FCFS (coming soon)",
    body: "The sequencer orders transactions first-come-first-served. Priority fees and tips do nothing here — speed comes from latency, so Claudio sends straight to the sequencer RPC. Slippage and auto-approve still apply.",
  },
  {
    chain: "bsc",
    title: "BNB Chain · builder bundles (coming soon)",
    body: "Trades go as bundles via the 48Club Puissant builder. MEV protect keeps them out of the public mempool. Priority fee is added as extra gwei.",
  },
];

function ExecutionSection() {
  const presets = useSettings((s) => s.presets);
  const activePreset = useSettings((s) => s.activePreset);
  const set = useSettings((s) => s.set);
  const [editing, setEditing] = useState<ExecPreset>(activePreset);
  const p = presets[editing];
  const patch = (x: Partial<ExecSettings>) => set({ presets: { ...presets, [editing]: { ...p, ...x } } });
  const slipPct = p.slippageBps / 100;
  const open = useOpenChains();
  const notes = CHAIN_NOTES.filter((n) => open.includes(n.chain));

  return (
    <Section id="execution">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <Segmented
          value={editing}
          onChange={setEditing}
          options={(["P1", "P2", "P3"] as ExecPreset[]).map((k) => ({
            value: k,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {k}
                {k === activePreset && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
              </span>
            ),
          }))}
          className="w-full sm:w-[280px]"
        />
        {editing === activePreset ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-3">
            <span className="chip chip-buy">Active</span> Used for every trade right now
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              haptic();
              set({ activePreset: editing });
            }}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[3px] px-3 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-brand ring-1 ring-inset ring-brand/40 transition-colors hover:bg-brand-bg"
          >
            Use {editing}
          </button>
        )}
      </div>
      <motion.div key={editing} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="divide-y divide-line">
        <Row label="Slippage" hint="Max price move you accept between quote and fill. Memes move fast — 10–25% is normal on fresh launches.">
          <NumberField label={undefined} value={slipPct} min={0.1} max={99} suffix="%" onChange={(v) => patch({ slippageBps: Math.round(v * 100) })} />
          <PillChoice value={slipPct} options={[5, 10, 15, 25, 49]} onChange={(v) => patch({ slippageBps: v * 100 })} format={(v) => `${v}%`} className="mt-2" ariaLabel="Slippage quick picks" />
        </Row>
        <Row label="Priority fee" hint="Total priority fee in SOL. Higher lands faster when the network is busy.">
          <NumberField value={p.priorityFee} min={0} max={1} suffix="SOL / gwei" onChange={(v) => patch({ priorityFee: v })} />
        </Row>
        <Row label="Jito tip" hint="Solana only — paid to the Jito validator that includes your bundle.">
          <NumberField value={p.jitoTip} min={0} max={1} suffix="SOL" onChange={(v) => patch({ jitoTip: v })} />
        </Row>
        <div className="divide-y divide-line px-4 md:px-5">
          <Toggle
            checked={p.mevProtect}
            onChange={(v) => patch({ mevProtect: v })}
            label="MEV protection"
            hint="Private routing (Jito bundles / builder). Slightly slower to land, can't be sandwiched."
          />
          <Toggle
            checked={p.autoApprove}
            onChange={(v) => patch({ autoApprove: v })}
            label="Auto-approve on EVM"
            hint="Sends the token approval (Permit2) automatically before your first sell."
          />
        </div>
      </motion.div>
      <div className="border-t border-line px-4 py-4 md:px-5">
        <div className="eyebrow mb-3">How each chain lands your trades</div>
        <div className={cn("grid gap-3", notes.length > 1 && "md:grid-cols-3")}>
          {notes.map((n) => (
            <div key={n.chain} className="rounded-[3px] border border-line p-3">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em]">
                <ChainBadge chain={n.chain} size={14} /> {n.title}
              </div>
              <p className="text-[11.5px] leading-relaxed text-text-3">{n.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ─── Amount presets ─────────────────────────────────────────────────

function AmountsSection() {
  const quickBuy = useSettings((s) => s.quickBuy);
  const quickBuyPresets = useSettings((s) => s.quickBuyPresets);
  const sellPresets = useSettings((s) => s.sellPresets);
  const set = useSettings((s) => s.set);
  const open = useOpenChains();
  return (
    <Section id="amounts" bodyClassName="divide-y divide-line">
      {open.map((c) => (
        <Row
          key={c}
          label={
            <span className="flex items-center gap-2">
              <ChainBadge chain={c} size={16} /> {CHAINS[c].name}
              <span className="chip">{CHAINS[c].nativeSymbol}</span>
            </span>
          }
          hint={
            <>
              1-click buy: <span className="num font-semibold text-text-2">{quickBuy[c]} {CHAINS[c].nativeSymbol}</span> · tap a chip to make it the default, double-tap to edit
            </>
          }
        >
          <ChipEditor
            values={quickBuyPresets[c]}
            min={0.000001}
            max={1_000_000}
            highlight={quickBuy[c]}
            onPick={(v) => {
              haptic();
              set({ quickBuy: { ...quickBuy, [c]: v } });
            }}
            onChange={(v) => set({ quickBuyPresets: { ...quickBuyPresets, [c]: v } })}
          />
        </Row>
      ))}
      <Row label="Sell presets" hint="Percent of your position sold by the quick-sell buttons. Tap to edit.">
        <ChipEditor values={sellPresets} min={1} max={100} suffix="%" onChange={(v) => set({ sellPresets: v })} />
      </Row>
    </Section>
  );
}

// ─── Board ──────────────────────────────────────────────────────────

function BoardSection() {
  const s = useSettings();
  return (
    <Section id="board" bodyClassName="px-4 py-1 md:px-5">
      <div className="divide-y divide-line">
        <Toggle checked={s.pauseOnHover} onChange={(v) => s.set({ pauseOnHover: v })} label="Pause on hover" hint="Freeze a column while your cursor is over it so cards don't jump under your click." />
        <Toggle checked={s.soundAlerts} onChange={(v) => s.set({ soundAlerts: v })} label="Sound alerts" hint="Play a tick for new tokens matching your filters." />
        <Toggle
          checked={s.haptics}
          onChange={(v) => {
            s.set({ haptics: v });
            if (v && "vibrate" in navigator) navigator.vibrate(12);
          }}
          label="Haptics"
          hint="Light vibration on taps and fills (Android / supported browsers)."
        />
        <Toggle checked={s.compact} onChange={(v) => s.set({ compact: v })} label="Compact cards" hint="Denser board rows — more tokens on screen." />
      </div>
    </Section>
  );
}

// ─── Blocklists ─────────────────────────────────────────────────────

function BlocklistSection() {
  const blockedDevs = useSettings((s) => s.blockedDevs);
  const blockedKeywords = useSettings((s) => s.blockedKeywords);
  const set = useSettings((s) => s.set);
  return (
    <Section id="blocklists">
      <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-4 md:p-5">
          <div className="mono-label mb-1.5 !text-text-2">Dev wallets</div>
          <p className="mb-3 text-xs text-text-3">Creator addresses on any chain.</p>
          <ListEditor
            items={blockedDevs}
            onChange={(v) => set({ blockedDevs: v })}
            placeholder="Solana or 0x… address"
            normalize={(s) => {
              const t = s.trim();
              return t.startsWith("0x") ? t.toLowerCase() : t;
            }}
            validate={(s) => (kindOfAddress(s) ? null : "Not a valid Solana or EVM address")}
            render={(s) => <span className="num">{shortAddr(s, 5, 5)}</span>}
            emptyText="Tokens from these creators are hidden on every chain."
          />
        </div>
        <div className="p-4 md:p-5">
          <div className="mono-label mb-1.5 !text-text-2">Keywords</div>
          <p className="mb-3 text-xs text-text-3">Matched against token name and ticker.</p>
          <ListEditor
            items={blockedKeywords}
            onChange={(v) => set({ blockedKeywords: v })}
            placeholder="e.g. elon, rug, test"
            normalize={(s) => s.trim().toLowerCase().slice(0, 32)}
            emptyText="Hide tokens whose name or ticker contains these words."
          />
        </div>
      </div>
    </Section>
  );
}

// ─── Watchlist ──────────────────────────────────────────────────────

function WatchlistSection() {
  const watchlist = useSettings((s) => s.watchlist);
  const toggleWatch = useSettings((s) => s.toggleWatch);
  const tokens = useBoard((s) => s.tokens);
  return (
    <Section id="watchlist" right={<span className="chip num">{watchlist.length}</span>} bodyClassName="p-2">
      {watchlist.length === 0 ? (
        <Empty title="Nothing watched yet" hint="Star tokens on the board or token page to track them here." icon={<Star />} />
      ) : (
        <ul className="grid gap-1">
          {watchlist.map((k) => {
            const t = tokens[k];
            const i = k.indexOf(":");
            const chain = k.slice(0, i) as ChainId;
            const addr = k.slice(i + 1);
            return (
              <li key={k} className="flex items-center gap-2 rounded-[3px] px-2 py-1.5 transition-colors hover:bg-panel-2">
                <Link href={`/t/${chain}/${addr}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                  <TokenAvatar image={t?.image} symbol={t?.symbol ?? "?"} launchpad={t?.launchpad} size={28} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {t ? `$${t.symbol}` : shortAddr(addr)}
                      {CHAINS[chain] && <ChainBadge chain={chain} />}
                    </span>
                    <span className="block truncate text-[11px] text-text-3">{t ? `MC $${fmtCompact(t.mcapUsd)} · ${t.name}` : "Not indexed right now"}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => toggleWatch(k)}
                  className="flex h-10 w-10 items-center justify-center rounded-[3px] text-text-3 transition-colors hover:bg-sell-bg hover:text-sell"
                  aria-label="Remove from watchlist"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ─── Security ───────────────────────────────────────────────────────

function SecuritySection() {
  const autoLockMin = useWallet((s) => s.autoLockMin);
  const initialized = useWallet((s) => s.initialized);
  return (
    <Section
      id="security"
      right={
        <Link href="/wallets" className="btn btn-ghost h-9 gap-1 px-2 text-[11px]">
          Manage wallets <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <Row
        label="Auto-lock after idle"
        hint={
          initialized
            ? "Keys are wiped from memory when the wallet locks. Signing again asks for your passcode."
            : "No wallet on this device yet — create one from Wallets."
        }
      >
        <PillChoice value={autoLockMin} options={AUTOLOCK_OPTIONS} onChange={(m) => setAutoLockMinutes(m)} format={(m) => (m >= 60 ? `${m / 60}h` : `${m}m`)} ariaLabel="Auto-lock after idle" />
      </Row>
    </Section>
  );
}

// ─── Referral ───────────────────────────────────────────────────────

function ReferralSection() {
  const referralCode = useSettings((s) => s.referralCode);
  const set = useSettings((s) => s.set);
  const [val, setVal] = useState(referralCode ?? "");
  useEffect(() => setVal(referralCode ?? ""), [referralCode]);
  const clean = val.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
  const dirty = clean !== (referralCode ?? "");
  return (
    <Section id="referral">
      <Row label="Your code" hint="Letters, numbers, - and _ (max 16). Applied to launches and trades you route through Claudio.">
      <div className="flex gap-2">
        <input
          value={clean}
          onChange={(e) => setVal(e.target.value)}
          placeholder="e.g. TRENCHKING"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="num h-11 min-w-0 flex-1 rounded-[3px] border border-line-2 bg-bg px-3 text-base uppercase tracking-wider outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand md:h-10 md:text-sm"
        />
        <ActionButton
          disabled={!dirty}
          onClick={() => {
            set({ referralCode: clean || undefined });
            toast({ title: clean ? "Referral code saved" : "Referral code cleared" });
          }}
        >
          Save
        </ActionButton>
      </div>
      </Row>
    </Section>
  );
}

// ─── Data sources ───────────────────────────────────────────────────

async function fetchStatus(): Promise<ChainStatus[]> {
  const res = await fetch("/api/status", { credentials: "include" });
  if (!res.ok) throw new Error(String(res.status));
  const j = (await res.json()) as unknown;
  if (Array.isArray(j)) return j as ChainStatus[];
  if (j && typeof j === "object" && Array.isArray((j as { chains?: unknown }).chains)) return (j as { chains: ChainStatus[] }).chains;
  return [];
}

function DataSection() {
  const ws = useBoard((s) => s.status);
  const q = useQuery({ queryKey: ["settings", "status"], queryFn: fetchStatus, refetchInterval: 10_000, staleTime: 5_000, retry: false });
  const rows: ChainStatus[] = q.data && q.data.length ? q.data : Object.values(ws);
  const byChain = new Map(rows.map((r) => [r.chain, r]));
  const chainState = useChainStates();
  return (
    <Section id="data" right={<span className="chip">{q.data?.length ? "via /api/status" : Object.keys(ws).length ? "via live socket" : "no data"}</span>}>
      <div className="eyebrow hidden grid-cols-[1.2fr_repeat(5,1fr)] gap-2 border-b border-line px-5 py-2.5 sm:grid">
        <span>Chain</span>
        <span>Source</span>
        <span className="text-right">Latency</span>
        <span className="text-right">Block</span>
        <span className="text-right">Gas</span>
        <span className="text-right">Native</span>
      </div>
      <ul>
        {ENABLED_CHAINS.map((c) => {
          if (chainState(c) === "coming_soon") {
            return (
              <li key={c} className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 text-xs text-text-3 last:border-0 sm:grid-cols-[1.2fr_repeat(5,1fr)] sm:items-center sm:px-5">
                <span className="flex items-center gap-2 font-semibold text-text-2">
                  <ChainBadge chain={c} size={14} /> {CHAINS[c].name}
                </span>
                <span className="flex items-center justify-end gap-1.5 sm:justify-start">
                  <span className="chip">Coming soon</span>
                </span>
              </li>
            );
          }
          const r = byChain.get(c);
          const src = r?.source ?? "offline";
          return (
            <li key={c} className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 text-xs last:border-0 sm:grid-cols-[1.2fr_repeat(5,1fr)] sm:items-center sm:px-5">
              <span className="flex items-center gap-2 font-semibold">
                <ChainBadge chain={c} size={14} /> {CHAINS[c].name}
              </span>
              <span className="flex items-center justify-end gap-1.5 sm:justify-start">
                <LiveDot state={src} />
                <span className={cn("font-semibold uppercase", src === "live" ? "text-buy" : src === "simulated" ? "text-warn" : "text-sell")}>
                  {src === "simulated" ? "SIM" : src}
                </span>
              </span>
              <span className="num text-text-2 sm:text-right">{r ? `${Math.round(r.latencyMs)} ms` : "—"}</span>
              <span className="num text-right text-text-2">{r?.lastBlock ? r.lastBlock.toLocaleString() : "—"}</span>
              <span className="num text-text-3 sm:text-right">{r?.gas ?? "—"}</span>
              <span className="num text-right text-text-2">
                {r?.nativeUsd ? `$${r.nativeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
                {r?.lastEventAt ? <span className="block text-[10px] text-text-3">event {fmtAge(r.lastEventAt)} ago</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-text-3 sm:px-5">
        LIVE = indexed from chain. SIM = simulated feed (no data source configured) and is never presented as real. Robinhood Chain and BNB
        Chain are coming soon.
      </p>
    </Section>
  );
}

// ─── App ────────────────────────────────────────────────────────────

/** Only for wallets listed in ADMIN_WALLETS — the one place (with the rail / More sheet) that links to /admin. */
function AdminRow() {
  const isAdmin = useIsAdminWallet();
  if (!isAdmin) return null;
  return (
    <Link
      href="/admin"
      className="flex items-center gap-3 border-b border-line border-l-2 border-l-brand p-4 transition-colors hover:bg-panel md:px-5"
      data-testid="settings-admin"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] text-brand ring-1 ring-inset ring-brand/30">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold text-text">Admin</span>
        <span className="block text-xs text-text-3">Your wallet is an admin wallet. Chains, launchpads, agents and payouts.</span>
      </span>
      <ChevronRight className="h-4 w-4 text-text-3" />
    </Link>
  );
}

function AppSection() {
  const canInstall = usePwa((s) => s.canInstall);
  const installed = usePwa((s) => s.installed);
  const ios = isIos();
  const [confirm, setConfirm] = useState(false);
  return (
    <Section id="app">
      <AdminRow />
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center md:p-5">
        <img src="/claudio/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-[3px]" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">{installed ? "Claudio is installed" : "Install Claudio"}</div>
          <div className="text-xs text-text-3">
            {installed
              ? "Running as an app — full screen, faster launch."
              : ios
                ? (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    In Safari tap <Share className="inline h-3.5 w-3.5" /> Share → <b className="text-text-2">Add to Home Screen</b>.
                  </span>
                )
                : canInstall
                  ? "Full-screen app with its own icon. No store needed."
                  : "Use your browser menu → Install app / Add to Home screen."}
          </div>
        </div>
        {canInstall && !installed && (
          <ActionButton
            onClick={() =>
              void promptInstall().then((ok) => {
                if (ok) toast({ title: "Installing Claudio" });
              })
            }
          >
            Install
          </ActionButton>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-line border-l-2 border-l-sell p-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-sell">Reset settings</div>
          <div className="mt-0.5 text-xs text-text-3">Restore every setting on this page to defaults. Wallets and history are not touched.</div>
        </div>
        <ActionButton tone="danger" className="shrink-0" onClick={() => setConfirm(true)}>
          <RotateCcw /> Reset settings
        </ActionButton>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="rounded-[4px] border-line bg-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
            <AlertDialogDescription>
              Presets, filters, amounts, blocklists and your watchlist go back to defaults. Your wallets, keys and trade history stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-10">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-sell text-sell-ink hover:bg-sell md:h-10"
              onClick={() => {
                try {
                  localStorage.removeItem("claudio.settings.v1");
                } catch {
                  /* ignore */
                }
                window.location.reload();
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function Settings() {
  const [current, setCurrent] = useState(SECTIONS[0].id);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setCurrent(vis.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <Page>
      <PageHeader
        title="Settings"
        icon={<Settings2 />}
        subtitle="Saved on this device — nothing here is sent to a server"
        actions={
          <>
            <a
              href="/connect"
              className="btn btn-secondary h-11 px-3.5 md:h-10"
            >
              Connect apps
            </a>
            <Link
              href="/wallets"
              className="btn btn-secondary h-11 gap-1.5 px-3.5 md:h-10"
            >
              Wallets
            </Link>
          </>
        }
      />

      {/* Phones: sticky, swipeable section chips */}
      <nav aria-label="Settings sections" className="no-scrollbar sticky top-0 z-10 -mx-4 -mt-2 mb-4 flex gap-1.5 overflow-x-auto border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur md:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center rounded-[3px] px-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] ring-1 ring-inset transition-colors",
              current === s.id ? "bg-panel-3 text-text ring-line-2" : "text-text-3 ring-line",
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="grid gap-8 md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <aside className="sticky top-6 hidden h-max md:block">
          <ul className="grid gap-0.5">
            {SECTIONS.map((s, idx) => {
              const on = current === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "relative flex h-9 w-full items-center gap-3 rounded-[3px] px-3 text-left font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors",
                      on ? "bg-panel text-text" : "text-text-3 hover:bg-panel hover:text-text",
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="settings-indicator"
                        className="absolute inset-y-2 -left-px w-[2px] bg-brand"
                        transition={{ type: "spring", stiffness: 520, damping: 40 }}
                      />
                    )}
                    <span className={cn("num shrink-0 text-[10px]", on ? "text-brand" : "text-text-3")}>{String(idx + 1).padStart(2, "0")}</span>
                    <span className="flex-1 truncate">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-text-3">
            <div className="mono-label mb-1.5 !text-text-2">Stored locally</div>
            Settings live in this browser. Changes apply instantly — there's no save button.
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-3">
            <Link href="/docs" className="hover:text-text-2">Docs</Link>
            <Link href="/privacy" className="hover:text-text-2">Privacy</Link>
            <Link href="/terms" className="hover:text-text-2">Terms</Link>
          </div>
        </aside>
        <div className="grid min-w-0 gap-9 md:gap-11">
          <ExecutionSection />
          <AmountsSection />
          <BoardSection />
          <BlocklistSection />
          <WatchlistSection />
          <SecuritySection />
          <ReferralSection />
          <DataSection />
          <AppSection />
          <nav aria-label="About Claudio" className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 md:hidden">
            <Link href="/docs" className="hover:text-text-2">Docs</Link>
            <Link href="/privacy" className="hover:text-text-2">Privacy policy</Link>
            <Link href="/terms" className="hover:text-text-2">Terms of use</Link>
          </nav>
        </div>
      </div>
    </Page>
  );
}
