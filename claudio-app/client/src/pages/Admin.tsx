// Admin. Flow: wallet sign-in → (non-admin wallets see the normal 404) → ADMIN_PASSWORD step → dashboard.
// The server enforces every step (requireAdmin); this page only mirrors it. Owner: platform workstream.
import { useEffect, useState } from "react";
import { KeyRound, Lock, LogOut, ShieldCheck, Wallet } from "lucide-react";
import { ActionButton, Card, Page, PageHeader, useCountdown } from "@/features/wallet/ui";
import { CopyAddress } from "@/components/kit";
import { cn } from "@/lib/utils";
import { openWalletPrompt, useActiveAccount } from "@/lib/wallet";
import { adminLogin, adminLogout, signInWithWallet, signOut, useRefreshSession, useSession } from "@/lib/session";
import { queryClient } from "@/lib/queryClient";
import { ADMIN_KEY } from "@/features/admin/api";
import { Input, Loading } from "@/features/admin/ui";
import { OverviewTab } from "@/features/admin/Overview";
import { ChainsTab, LaunchpadsTab } from "@/features/admin/Switches";
import { AuditTab, CollectorTab, TokenTab } from "@/features/admin/TokenCollectorAudit";
import { AgentsTab, HostedTab, ThreadTab } from "@/features/admin/External";
import NotFound from "./NotFound";

const TABS = [
  { id: "overview", label: "Overview", el: <OverviewTab /> },
  { id: "chains", label: "Chains", el: <ChainsTab /> },
  { id: "launchpads", label: "Launchpads", el: <LaunchpadsTab /> },
  { id: "token", label: "Token", el: <TokenTab /> },
  { id: "collector", label: "Collector", el: <CollectorTab /> },
  { id: "audit", label: "Audit log", el: <AuditTab /> },
  { id: "agents", label: "Agents", el: <AgentsTab /> },
  { id: "thread", label: "Thread", el: <ThreadTab /> },
  { id: "hosted", label: "Hosted", el: <HostedTab /> },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_STORE = "claudio.admin.tab";

function readTab(): TabId {
  try {
    const v = sessionStorage.getItem(TAB_STORE);
    if (v && TABS.some((t) => t.id === v)) return v as TabId;
  } catch {
    /* storage unavailable */
  }
  return "overview";
}

export default function Admin() {
  const session = useSession();
  if (session.isLoading) {
    return (
      <Page>
        <Loading label="Checking your session…" />
      </Page>
    );
  }
  const s = session.data;
  if (!s?.wallet) return <SignIn />;
  if (!s.isAdminWallet) return <NotFound />;
  if (!s.admin || !s.adminUntil) return <PasswordStep wallet={s.wallet} configured={s.adminLoginConfigured !== false} />;
  return <Dashboard wallet={s.wallet} adminUntil={s.adminUntil} />;
}

function Gate({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Page>
      <div className="mx-auto mt-6 max-w-md md:mt-16">
        <Card>
          <div className="flex flex-col items-center gap-3 px-1 py-3 text-center">
            <div>
              <div className="mono-label">Admin</div>
              <h1 className="display mt-3 text-[34px] text-text">{title}</h1>
              <p className="mt-2 text-[13px] leading-snug text-text-2">{subtitle}</p>
            </div>
            <div className="w-full pt-1">{children}</div>
          </div>
        </Card>
      </div>
    </Page>
  );
}

function SignIn() {
  const acct = useActiveAccount("svm");
  const refresh = useRefreshSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    if (!acct) return openWalletPrompt("Sign in to Claudio admin");
    setBusy(true);
    try {
      await signInWithWallet();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate title="Sign in with your wallet" subtitle="Sign a one-time message with your Solana wallet. It doesn't send a transaction or cost anything." icon={<Wallet />}>
      {acct && (
        <div className="mb-3 flex items-center justify-center gap-2 text-[12px] text-text-3">
          Signing as <CopyAddress address={acct.address} head={6} tail={6} />
        </div>
      )}
      <ActionButton className="w-full" busy={busy} onClick={() => void go()}>
        {acct ? "Sign in" : "Set up or connect a Solana wallet"}
      </ActionButton>
      {err && <div className="mt-2 text-[12px] text-sell">{err}</div>}
    </Gate>
  );
}

function PasswordStep({ wallet, configured }: { wallet: string; configured: boolean }) {
  const refresh = useRefreshSession();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!pw) return;
    setBusy(true);
    setErr(null);
    try {
      await adminLogin(pw);
      setPw("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Gate title="Admin password" subtitle="Second step for admin wallets. The admin session lasts 2 hours." icon={<KeyRound />}>
      <div className="mb-3 flex items-center justify-center gap-2 text-[12px] text-text-3">
        Wallet <CopyAddress address={wallet} head={6} tail={6} />
      </div>
      {!configured ? (
        <div className="rounded-[3px] border border-line border-l-2 border-l-warn bg-bg-elev px-3 py-2.5 text-left text-[12.5px] text-text-2">
          Admin login isn't configured. Set <span className="num">ADMIN_WALLETS</span> and <span className="num">ADMIN_PASSWORD</span> (8+ characters) on the server.
        </div>
      ) : (
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus invalid={!!err} />
          <ActionButton type="submit" className="w-full" busy={busy} disabled={!pw}>
            <ShieldCheck /> Unlock admin
          </ActionButton>
          {err && <div className="text-[12px] text-sell">{err}</div>}
        </form>
      )}
      <button type="button" onClick={() => void signOut().then(refresh)} className="mt-3 h-10 font-mono text-[11px] uppercase tracking-[0.1em] text-text-3 hover:text-text">
        Sign out
      </button>
    </Gate>
  );
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function Dashboard({ wallet, adminUntil }: { wallet: string; adminUntil: string }) {
  const refresh = useRefreshSession();
  const until = new Date(adminUntil).getTime();
  const left = useCountdown(() => Math.max(0, until - Date.now()), [until]);
  const [tab, setTab] = useState<TabId>(readTab);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_STORE, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  // Expired: re-read the session (server says admin=false → password step).
  useEffect(() => {
    if (left <= 0) void refresh();
  }, [left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = async (alsoSignOut: boolean) => {
    setBusy(true);
    try {
      await adminLogout().catch(() => undefined);
      if (alsoSignOut) await signOut().catch(() => undefined);
      queryClient.removeQueries({ queryKey: ADMIN_KEY });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <Page>
      <PageHeader
        title="Admin"
        icon={<ShieldCheck />}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CopyAddress address={wallet} head={5} tail={5} />
            <span className={cn("num", left < 10 * 60_000 ? "text-warn" : "text-text-3")}>· admin session expires in {mmss(left)}</span>
          </span>
        }
        actions={
          <>
            <ActionButton tone="soft" busy={busy} onClick={() => void lock(false)}>
              <Lock /> Lock admin
            </ActionButton>
            <ActionButton tone="ghost" disabled={busy} onClick={() => void lock(true)}>
              <LogOut /> Sign out
            </ActionButton>
          </>
        }
      />
      <nav aria-label="Admin sections" className="no-scrollbar -mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div role="tablist" className="inline-flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative h-10 whitespace-nowrap px-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.1em] transition-colors",
                t.id === tab ? "text-text shadow-[inset_0_-2px_0_var(--brand)]" : "text-text-3 hover:text-text-2",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>
      <div key={current.id}>{current.el}</div>
    </Page>
  );
}
