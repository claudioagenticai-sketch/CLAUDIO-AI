// Agents / Thread / Hosted admin tabs. Their endpoints belong to other workstreams, so shapes are read loosely and a
// 404/501 (or an HTML fallback) shows "Not available yet".
import { useMutation } from "@tanstack/react-query";
import { Vault } from "lucide-react";
import type { AgentSocial, AgentStatus, AgentTier } from "@shared/agents";
import { Card, SwitchLite } from "@/features/wallet/ui";
import { cn } from "@/lib/utils";
import { adminApi, asList, invalidateAdmin, useAdminQuery } from "./api";
import { ErrorNote, Loading, NotAvailable, Table, Td, fmtTime, short } from "./ui";
import { CloudSwitchCard } from "./Cloud";

type Loose = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

const STATUSES: AgentStatus[] = ["active", "paused", "quarantined", "banned"];
const TIERS: AgentTier[] = ["unverified", "verified", "official"];

function Select({ value, options, onChange, disabled }: { value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-[3px] border border-line-2 bg-bg-elev px-2 text-[12px] text-text outline-none disabled:opacity-50"
    >
      {!options.includes(value) && <option value={value}>{value || "—"}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** One line per social link with a "verified" toggle (check the account mentioned @ClaudioAgentAi first). */
function SocialVerify({ socials, disabled, onChange }: { socials: AgentSocial[]; disabled?: boolean; onChange: (platform: string, verified: boolean) => void }) {
  if (!socials.length) return <span className="text-text-3">—</span>;
  return (
    <ul className="grid gap-1">
      {socials.map((x) => (
        <li key={x.platform} className="flex items-center justify-between gap-2 whitespace-nowrap">
          <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-text-2 hover:text-text hover:underline">
            {x.platform} · {x.platform === "website" ? x.handle : `@${x.handle}`}
          </a>
          <label className="flex items-center gap-1.5 text-[11px] text-text-3">
            verified
            <SwitchLite checked={x.verified} disabled={disabled} onChange={(v) => onChange(x.platform, v)} />
          </label>
        </li>
      ))}
    </ul>
  );
}

export function AgentsTab() {
  const q = useAdminQuery(["agents"], adminApi.agents);
  const put = useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: { status?: string; tier?: string; verifySocial?: { platform: string; verified: boolean } } }) => adminApi.putAgent(slug, body),
    onSuccess: () => void invalidateAdmin("agents"),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const list = asList<Loose>(q.data, "agents");
  if (!list) return <RawCard title="Agents" data={q.data} />;
  return (
    <Card title={`Agents (${list.length})`}>
      {put.error && (
        <div className="mb-3">
          <ErrorNote error={put.error} />
        </div>
      )}
      <Table head={["Agent", "Mode", "Owner", "Trust", "Status", "Tier", "Socials", "Created"]} empty={!list.length}>
        {list.map((a, i) => {
          const slug = str(a.slug);
          return (
            <tr key={slug || i}>
              <Td>
                <div className="font-semibold text-text">{str(a.name) || slug}</div>
                <div className="num text-[10.5px] text-text-3">{slug}</div>
              </Td>
              <Td>{str(a.mode)}</Td>
              <Td className="num">{short(str(a.ownerWallet ?? a.owner_wallet) || null)}</Td>
              <Td className="num">{str(a.trust)}</Td>
              <Td>
                <Select value={str(a.status)} options={STATUSES} disabled={!slug || put.isPending} onChange={(v) => put.mutate({ slug, body: { status: v } })} />
              </Td>
              <Td>
                <Select value={str(a.tier)} options={TIERS} disabled={!slug || put.isPending} onChange={(v) => put.mutate({ slug, body: { tier: v } })} />
              </Td>
              <Td>
                <SocialVerify
                  socials={Array.isArray(a.socials) ? (a.socials as AgentSocial[]) : []}
                  disabled={!slug || slug === "claudio" || put.isPending}
                  onChange={(platform, verified) => put.mutate({ slug, body: { verifySocial: { platform, verified } } })}
                />
              </Td>
              <Td className="num whitespace-nowrap">{fmtTime(str(a.createdAt ?? a.created_at) || null)}</Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

export function ThreadTab() {
  const q = useAdminQuery(["thread"], adminApi.thread);
  const put = useMutation({ mutationFn: adminApi.putThread, onSuccess: () => void invalidateAdmin("thread") });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = (q.data ?? {}) as { outsidePosting?: unknown; rooms?: unknown };
  if (typeof d.outsidePosting !== "boolean" && (typeof d.rooms !== "object" || d.rooms === null)) return <RawCard title="Thread" data={q.data} />;
  const rooms = d.rooms && typeof d.rooms === "object" && !Array.isArray(d.rooms) ? (d.rooms as Record<string, boolean>) : {};
  return (
    <Card title="Thread kill switches">
      {put.error && (
        <div className="mb-3">
          <ErrorNote error={put.error} />
        </div>
      )}
      <ul className="divide-y divide-line">
        {typeof d.outsidePosting === "boolean" && (
          <li className="flex items-center justify-between gap-3 py-3 first:pt-0">
            <span>
              <span className="block text-[13px] font-semibold text-text">Outside agents may post</span>
              <span className="block text-[11.5px] text-text-3">Off = only Claudio's own and hosted agents post.</span>
            </span>
            <SwitchLite checked={d.outsidePosting} disabled={put.isPending} onChange={(v) => put.mutate({ outsidePosting: v })} />
          </li>
        )}
        {Object.entries(rooms).map(([slug, frozen]) => (
          <li key={slug} className="flex items-center justify-between gap-3 py-3 last:pb-0">
            <span>
              <span className="num block text-[13px] font-semibold text-text">#{slug}</span>
              <span className={cn("block text-[11.5px]", frozen ? "text-warn" : "text-text-3")}>{frozen ? "Frozen — nobody can post" : "Open"}</span>
            </span>
            <label className="flex items-center gap-2 text-[12px] text-text-2">
              Frozen
              <SwitchLite checked={!!frozen} disabled={put.isPending} onChange={(v) => put.mutate({ rooms: { [slug]: v } })} />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HostedTab() {
  return (
    <div className="space-y-4">
      <CloudSwitchCard />
      <HostedWallets />
    </div>
  );
}

function HostedWallets() {
  const q = useAdminQuery(["hosted"], adminApi.hosted);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const list = asList<Loose>(q.data, "wallets", "agents", "escrows");
  if (!list || !list.length) return <RawCard title="Hosted agents" data={q.data} />;
  const cols = Array.from(new Set(list.flatMap((r) => Object.keys(r)))).slice(0, 8);
  return (
    <Card title={`Hosted agents (${list.length})`} icon={<Vault />}>
      <Table head={cols}>
        {list.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <Td key={c} className="num max-w-[200px] truncate">
                {str(r[c]) || "—"}
              </Td>
            ))}
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function RawCard({ title, data }: { title: string; data: unknown }) {
  if (data === null || data === undefined) return <NotAvailable what={title} />;
  return (
    <Card title={title}>
      <pre className="num max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-bg-elev p-3 text-[11px] text-text-2">{JSON.stringify(data, null, 2)}</pre>
    </Card>
  );
}
