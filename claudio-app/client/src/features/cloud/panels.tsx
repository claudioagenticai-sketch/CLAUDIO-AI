// Helpers, Memory, Skills and Activity tabs of the Cloud workspace.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Pin, PinOff, Trash2 } from "lucide-react";
import type { CloudWorkspace, HelperRole, CloudTool, UsageDay } from "@shared/cloud";
import { Age } from "@/components/kit";
import { toast } from "@/hooks/use-toast";
import { ActionButton, Card, SwitchLite } from "@/features/wallet/ui";
import { errorText } from "@/features/agents/api";
import { ModelLabel, PlainText } from "@/features/agents/ui";
import { cn } from "@/lib/utils";
import { cloudApi, useActivity, useHelpers, useInvalidateCloud, useMemory, useSkills, useUsage } from "./api";

function Loading({ h = 160 }: { h?: number }) {
  return <div className="panel sheen" style={{ height: h }} />;
}

function Problem({ error }: { error: unknown }) {
  return <p className="panel p-4 text-[13px] text-text-3">{errorText(error)}</p>;
}

async function attempt(fn: () => Promise<unknown>, fail = "Couldn't save that") {
  try {
    await fn();
    return true;
  } catch (e) {
    toast({ title: fail, description: errorText(e), variant: "destructive" });
    return false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

export function HelpersTab({ ws }: { ws: CloudWorkspace }) {
  const slug = ws.agent.slug;
  const q = useHelpers(slug);
  const invalidate = useInvalidateCloud();
  const owner = ws.role === "owner";
  if (q.isLoading) return <Loading h={320} />;
  if (q.error) return <Problem error={q.error} />;
  const toggle = (role: HelperRole, on: boolean) => attempt(() => cloudApi.saveSettings(slug, { helpers: { [role]: on } })).then(() => invalidate(slug));
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[13px] leading-relaxed text-text-2">
        Helpers are smaller agents {ws.agent.name} can hand one step to while it answers you. Each one only has the tools listed under it, and none of them can trade or post.
        In chat you'll see which helper answered.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {q.data!.helpers.map((h) => (
          <section key={h.role} className={cn("panel p-4", !h.enabled && "opacity-70")}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[14.5px] font-bold">{h.label}</h3>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-2">{h.body}</p>
              </div>
              <SwitchLite checked={h.enabled} disabled={!owner} onChange={(v) => void toggle(h.role, v)} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {h.tools.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-3 border-t border-line pt-2.5 text-[12px] text-text-3">
              {h.uses ? (
                <>
                  Answered {h.uses} time{h.uses === 1 ? "" : "s"}
                  {h.lastAt && (
                    <>
                      , last <Age from={Date.parse(h.lastAt)} className="text-text-3" /> ago
                    </>
                  )}
                  {h.lastAnswer && <PlainText text={h.lastAnswer} clamp={3} className="mt-1.5 text-[12.5px] leading-relaxed text-text-2" />}
                </>
              ) : (
                "Not used yet. Ask in chat, for example “ask the market helper about $CLAUDIO”."
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Memory ─────────────────────────────────────────────────────────

const KIND_LABEL = { note: "Saved by the agent", owner: "Written by you", chat: "From a chat" } as const;

export function MemoryTab({ ws }: { ws: CloudWorkspace }) {
  const slug = ws.agent.slug;
  const owner = ws.role === "owner";
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  const mem = useMemory(slug, q);
  const invalidate = useInvalidateCloud();
  const [draft, setDraft] = useState("");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => invalidate(slug, "memory");

  const add = async () => {
    if (draft.trim().length < 2) return;
    setBusy(true);
    if (await attempt(() => cloudApi.addMemory(slug, draft.trim(), pin))) {
      setDraft("");
      setPin(false);
      refresh();
    }
    setBusy(false);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memory"
          className="h-11 w-full rounded-xl border border-line-2 bg-bg-elev px-3.5 text-[14px] text-text outline-none placeholder:text-text-3 focus:border-brand md:h-10"
        />
        {mem.isLoading ? (
          <Loading />
        ) : mem.error ? (
          <Problem error={mem.error} />
        ) : !mem.data!.items.length ? (
          <p className="panel p-5 text-center text-[13px] text-text-3">{q ? "Nothing matches that." : "Nothing saved yet. Notes you add here, and things the agent saves in chat, show up here."}</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {mem.data!.items.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <PlainText text={m.content} className="text-[13.5px] leading-relaxed text-text" />
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-text-3">
                    {m.pinned && <span className="chip chip-brand">Pinned</span>}
                    <span>{KIND_LABEL[m.kind] ?? m.kind}</span>
                    <span>
                      <Age from={Date.parse(m.createdAt)} className="text-text-3" /> ago
                    </span>
                  </div>
                </div>
                {owner && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={m.pinned ? "Unpin" : "Pin"}
                      title={m.pinned ? "Unpin" : "Pin: always in the agent's mind"}
                      onClick={() => void attempt(() => cloudApi.pinMemory(slug, m.id, !m.pinned)).then(refresh)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-text"
                    >
                      {m.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      onClick={() => void attempt(() => cloudApi.deleteMemory(slug, m.id), "Couldn't delete that").then(refresh)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-sell"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {mem.data && (
          <p className="text-[11.5px] text-text-3">
            Keeps up to {mem.data.max} notes; the oldest unpinned ones go first. Pinned notes are always part of what the agent knows.
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-4">
        {owner && (
          <Card title="Add a note">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Something the agent should remember"
              className="w-full resize-none rounded-xl border border-line-2 bg-bg-elev px-3 py-2.5 text-[13.5px] text-text outline-none placeholder:text-text-3 focus:border-brand"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[12.5px] text-text-2">
                <SwitchLite checked={pin} onChange={setPin} />
                Pin it
              </label>
              <ActionButton busy={busy} disabled={draft.trim().length < 2} onClick={add}>
                Save
              </ActionButton>
            </div>
          </Card>
        )}
        <Card title="Running notes">
          <p className="text-[12px] leading-relaxed text-text-3">What the agent keeps between its scheduled runs. It rewrites these itself.</p>
          {mem.data?.summary ? (
            <>
              <PlainText text={mem.data.summary} className="num mt-2 max-h-64 overflow-y-auto rounded-[3px] bg-bg-elev p-2.5 text-[11.5px] leading-relaxed text-text-2" />
              {owner && (
                <button
                  type="button"
                  onClick={() => void attempt(() => cloudApi.clearSummary(slug), "Couldn't clear them").then(refresh)}
                  className="mt-2 text-[12px] font-semibold text-text-3 hover:text-sell"
                >
                  Clear running notes
                </button>
              )}
            </>
          ) : (
            <p className="mt-2 text-[12.5px] text-text-3">Empty. They fill up once the agent is running.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Skills ─────────────────────────────────────────────────────────

export function SkillsTab({ ws }: { ws: CloudWorkspace }) {
  const slug = ws.agent.slug;
  const owner = ws.role === "owner";
  const q = useSkills(slug);
  const invalidate = useInvalidateCloud();
  if (q.isLoading) return <Loading h={360} />;
  if (q.error) return <Problem error={q.error} />;
  const save = (patch: { skills?: Partial<Record<CloudTool, boolean>>; postApproval?: boolean }) => attempt(() => cloudApi.saveSettings(slug, patch)).then(() => invalidate(slug));
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ul className="panel min-w-0 divide-y divide-line">
        {q.data!.skills.map((s) => (
          <li key={s.name} className="flex items-start gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-bold">{s.label}</span>
                {s.writes && <span className="chip chip-warn">Changes things</span>}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-2">{s.body}</p>
            </div>
            <SwitchLite checked={s.enabled} disabled={!owner} onChange={(v) => void save({ skills: { [s.name]: v } })} />
          </li>
        ))}
      </ul>
      <div className="min-w-0 space-y-4">
        <Card title="Posting">
          <label className="flex items-start gap-3">
            <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-text-2">
              <span className="block text-[13.5px] font-semibold text-text">Ask me before posting</span>
              Posts the agent writes in chat wait for your OK in the chat and in the owner console.
            </span>
            <SwitchLite checked={q.data!.postApproval} disabled={!owner} onChange={(v) => void save({ postApproval: v })} />
          </label>
        </Card>
        <Card title="Trading">
          <p className="text-[12.5px] leading-relaxed text-text-2">
            Trades from chat are always paper trades. They also follow the guard rails in the owner console: trading is {ws.policy.canTrade ? "on" : "off"}, up to{" "}
            <span className="num">{ws.policy.maxSolPerTrade}</span> SOL a trade, and anything above <span className="num">{ws.policy.askOwnerAboveSol}</span> SOL waits for you.
          </p>
          <Link href={`/a/${slug}/console`} className="mt-2 inline-block text-[12.5px] font-semibold text-brand hover:underline">
            Change guard rails
          </Link>
        </Card>
        <p className="px-1 text-[11.5px] leading-relaxed text-text-3">
          There's no shell, no web browsing and no access to anything outside this workspace. Coin tools only cover $CLAUDIO and coins launched on Claudio.
        </p>
      </div>
    </div>
  );
}

// ─── Activity ───────────────────────────────────────────────────────

const ACTIVITY_LABEL: Record<string, string> = {
  chat: "Chat",
  tool: "Tool",
  helper: "Helper",
  post: "Post",
  paper_trade: "Paper trade",
  live_trade: "Trade",
  approval: "Approval",
  blocked: "Blocked",
  idle: "Idle",
  control: "Control",
  error: "Error",
  invalid_decision: "Skipped",
};

/** Messages per day, one series (brand hue), hover shows the day's numbers; the table below is the text view. */
function UsageChart({ days }: { days: UsageDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.messages));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover !== null ? days[hover] : days[days.length - 1];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-[12px] text-text-3">
        <span className="font-semibold text-text-2">{shown ? new Date(shown.day + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : ""}</span>
        <span>
          <span className="num text-text">{shown?.messages ?? 0}</span> messages
        </span>
        <span>
          <span className="num text-text">{shown?.toolCalls ?? 0}</span> tool calls
        </span>
        <span>
          <span className="num text-text">{shown?.posts ?? 0}</span> posts
        </span>
        <span>
          <span className="num text-text">{shown?.paperTrades ?? 0}</span> paper trades
        </span>
      </div>
      <div className="relative flex h-28 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)} role="img" aria-label="Messages per day, last 14 days">
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
            <div
              className={cn("w-full rounded-t-[4px] transition-opacity", hover === null || hover === i ? "opacity-100" : "opacity-50")}
              style={{ height: d.messages ? `${Math.max(4, (d.messages / max) * 100)}%` : 0, background: "var(--brand)" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-text-3">
        <span>{days[0]?.day.slice(5)}</span>
        <span>today</span>
      </div>
    </div>
  );
}

export function ActivityTab({ ws }: { ws: CloudWorkspace }) {
  const slug = ws.agent.slug;
  const act = useActivity(slug);
  const usage = useUsage(slug);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="panel min-w-0">
        <header className="border-b border-line px-4 py-3 text-[13.5px] font-bold">What it did</header>
        {act.isLoading ? (
          <div className="sheen m-4 h-40 rounded-xl bg-panel-2" />
        ) : act.error ? (
          <p className="p-4 text-[13px] text-text-3">{errorText(act.error)}</p>
        ) : !act.data!.items.length ? (
          <p className="p-6 text-center text-[13px] text-text-3">Nothing yet. Chats, tool calls, posts and paper trades show up here.</p>
        ) : (
          <ol className="divide-y divide-line">
            {act.data!.items.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={cn("chip mt-0.5 w-[84px] shrink-0 justify-center", !a.ok && "chip-sell")}>{ACTIVITY_LABEL[a.kind] ?? a.kind.replace(/_/g, " ")}</span>
                <div className="min-w-0 flex-1">
                  <PlainText text={a.text} className="text-[13px] leading-snug text-text" />
                  {a.model && <ModelLabel model={a.model} className="mt-0.5" />}
                </div>
                <span className="shrink-0 text-[11px] text-text-3">
                  <Age from={Date.parse(a.at)} className="text-text-3" />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="min-w-0 space-y-4">
        <Card title="Messages per day">
          {usage.isLoading ? (
            <div className="sheen h-32 rounded-xl bg-panel-2" />
          ) : usage.error ? (
            <p className="text-[13px] text-text-3">{errorText(usage.error)}</p>
          ) : (
            <>
              <UsageChart days={usage.data!.days} />
              <p className="mt-3 text-[12px] text-text-3">
                You've sent <span className="num text-text-2">{usage.data!.usedToday}</span> of <span className="num text-text-2">{usage.data!.dailyMessages}</span> messages today (all your agents together).
              </p>
            </>
          )}
        </Card>
        {usage.data && (
          <Card title="Last 7 days" bodyClassName="p-0">
            <table className="w-full text-[12px]">
              <thead className="text-text-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left font-semibold">Day</th>
                  <th className="px-2 py-2 text-right font-semibold">Msgs</th>
                  <th className="px-2 py-2 text-right font-semibold">Tools</th>
                  <th className="px-2 py-2 text-right font-semibold">Posts</th>
                  <th className="px-4 py-2 text-right font-semibold">Trades</th>
                </tr>
              </thead>
              <tbody className="num text-text-2">
                {usage.data.days
                  .slice(-7)
                  .reverse()
                  .map((d) => (
                    <tr key={d.day} className="border-b border-line last:border-0">
                      <td className="px-4 py-1.5">{d.day.slice(5)}</td>
                      <td className="px-2 py-1.5 text-right">{d.messages}</td>
                      <td className="px-2 py-1.5 text-right">{d.toolCalls}</td>
                      <td className="px-2 py-1.5 text-right">{d.posts}</td>
                      <td className="px-4 py-1.5 text-right">{d.paperTrades}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
