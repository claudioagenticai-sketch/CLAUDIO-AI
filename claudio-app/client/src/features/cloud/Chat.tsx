// Chat tab: conversations with your hosted agent (Nexora-style): message list, streaming replies, tool cards
// (collapsed by default), which helper answered, approvals inline, quick actions. Agent text is plain text only.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { HELPER_INFO, TOOL_INFO, type ChatMessageView, type ChatSession, type CloudTool, type CloudWorkspace, type HelperRole } from "@shared/cloud";
import { Age, ResponsiveSheet } from "@/components/kit";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { errorText } from "@/features/agents/api";
import { AgentAvatar, ModelLabel, PlainText } from "@/features/agents/ui";
import { cn } from "@/lib/utils";
import { cloudApi, streamMessage, useChat, useChats, useInvalidateCloud } from "./api";

const QUICK = [
  "How are Claudio's coins doing this hour?",
  "Ask the market helper about $CLAUDIO",
  "What's in your paper book?",
  "What is the thread talking about?",
  "Draft a post for #general about $CLAUDIO",
  "Remember: keep your answers short",
];

const toolLabel = (name: unknown) => TOOL_INFO[name as CloudTool]?.label ?? String(name ?? "Tool");
const helperLabel = (role: HelperRole | null | undefined) => (role ? HELPER_INFO[role]?.label ?? role : "Helper");

// ─── message rows ───────────────────────────────────────────────────

function Collapsible({ head, children, defaultOpen = false }: { head: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[3px] border border-line bg-bg-elev">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left">
        <span className="min-w-0 flex-1">{head}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-line px-3 py-2.5">{children}</div>}
    </div>
  );
}

function ToolRow({ m }: { m: ChatMessageView }) {
  const ok = m.meta.ok !== false;
  return (
    <Collapsible
      head={
        <span className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="shrink-0 font-semibold text-text-2">{toolLabel(m.meta.name)}</span>
          <span className="min-w-0 truncate text-text-3">{m.content}</span>
          {!ok && <span className="chip chip-sell shrink-0">Refused</span>}
        </span>
      }
    >
      <div className="eyebrow mb-1">Asked with</div>
      <pre className="num max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[3px] bg-bg-elev p-2 text-[11px] text-text-2">{JSON.stringify(m.meta.args ?? {}, null, 2)}</pre>
      <p className="mt-2 text-[12px] text-text-2">{m.content}</p>
    </Collapsible>
  );
}

function HelperRow({ m }: { m: ChatMessageView }) {
  const tools = Array.isArray(m.meta.tools) ? (m.meta.tools as { name: string; ok: boolean; summary: string }[]) : [];
  return (
    <Collapsible
      head={
        <span className="block min-w-0 text-[12px]">
          <span className="font-semibold text-text">{helperLabel(m.helper)} helper answered</span>
          <span className="mt-0.5 block truncate text-text-3">{m.content}</span>
        </span>
      }
    >
      {typeof m.meta.task === "string" && (
        <p className="text-[12px] text-text-3">
          Asked: <span className="text-text-2">{m.meta.task}</span>
        </p>
      )}
      {tools.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-text-3">
          {tools.map((t, i) => (
            <li key={i}>
              {toolLabel(t.name)}: {t.summary}
            </li>
          ))}
        </ul>
      )}
      <PlainText text={m.content} className="mt-2 text-[13px] leading-relaxed text-text" />
      <ModelLabel model={m.model} className="mt-1.5" />
    </Collapsible>
  );
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const STATUS_TEXT: Record<string, string> = { approved: "Approved", executed: "Done", rejected: "Denied", expired: "Expired", failed: "Failed" };

function ApprovalRow({ m, slug, status, canDecide, onDecided }: { m: ChatMessageView; slug: string; status: string; canDecide: boolean; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const id = typeof m.meta.approvalId === "string" ? m.meta.approvalId : null;
  const decide = async (approve: boolean) => {
    if (!id) return;
    setBusy(true);
    try {
      await cloudApi.decide(slug, id, approve);
      toast({ title: approve ? "Approved" : "Denied" });
      onDecided();
    } catch (e) {
      toast({ title: "Couldn't send that", description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const pending = status === "pending";
  return (
    <div className={cn("rounded-xl p-3", pending ? "bg-warn-bg/60 ring-1 ring-warn/30" : "border border-line bg-bg-elev")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("chip shrink-0 font-bold", pending ? "chip-warn" : status === "executed" ? "chip-buy" : "")}>{pending ? "Needs your OK" : STATUS_TEXT[status] ?? status}</span>
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-text">{capFirst(m.content.replace(/^Waiting for your approval: /, ""))}</span>
      </div>
      {typeof m.meta.preview === "string" && m.meta.preview && (
        <PlainText text={m.meta.preview} className="mt-2 rounded-[3px] bg-bg-elev px-3 py-2 text-[13px] leading-relaxed text-text-2" />
      )}
      {pending && canDecide && id && (
        <div className="mt-2.5 flex justify-end gap-1.5">
          <button type="button" disabled={busy} onClick={() => decide(false)} className="btn btn-secondary h-9 px-3">
            <X className="h-3.5 w-3.5" />
            Deny
          </button>
          <button type="button" disabled={busy} onClick={() => decide(true)} className="inline-flex h-9 items-center gap-1 rounded-[3px] bg-buy px-3 text-[12.5px] font-bold text-buy-ink disabled:opacity-50">
            <Check className="h-3.5 w-3.5" />
            Approve
          </button>
        </div>
      )}
    </div>
  );
}

function AgentRowMsg({ m, agent }: { m: ChatMessageView; agent: CloudWorkspace["agent"] }) {
  const helpers = Array.isArray(m.meta.helpers) ? (m.meta.helpers as HelperRole[]) : [];
  return (
    <div className="flex gap-2.5">
      <AgentAvatar agent={agent} size={28} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <PlainText text={m.content} className="text-[14px] leading-relaxed text-text" />
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-text-3">
          <ModelLabel model={m.model} />
          {helpers.length > 0 && <span>with the {[...new Set(helpers)].map(helperLabel).join(" and ")} helper{new Set(helpers).size > 1 ? "s" : ""}</span>}
        </div>
      </div>
    </div>
  );
}

function MessageRow(p: { m: ChatMessageView; agent: CloudWorkspace["agent"]; slug: string; approvals: Record<string, string>; canDecide: boolean; onDecided: () => void }) {
  const { m } = p;
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[4px] rounded-br-md bg-panel-3 px-3.5 py-2.5">
          <PlainText text={m.content} className="text-[14px] leading-relaxed text-text" />
        </div>
      </div>
    );
  }
  if (m.role === "agent") return <AgentRowMsg m={m} agent={p.agent} />;
  if (m.role === "error") return <p className="pl-[38px] text-[12.5px] text-sell">{m.content}</p>;
  const id = typeof m.meta.approvalId === "string" ? m.meta.approvalId : "";
  return (
    <div className="pl-[38px]">
      {m.role === "tool" ? (
        <ToolRow m={m} />
      ) : m.role === "helper" ? (
        <HelperRow m={m} />
      ) : (
        <ApprovalRow m={m} slug={p.slug} status={p.approvals[id] ?? "pending"} canDecide={p.canDecide} onDecided={p.onDecided} />
      )}
    </div>
  );
}

// ─── chat list ──────────────────────────────────────────────────────

function ChatList({ chats, active, onPick, onNew, onDelete, canWrite }: { chats: ChatSession[]; active: string | null; onPick: (id: string) => void; onNew: () => void; onDelete: (id: string) => void; canWrite: boolean }) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {canWrite && (
        <button type="button" onClick={onNew} className="btn btn-secondary">
          <Plus className="h-4 w-4" />
          New chat
        </button>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {chats.map((c) => (
          <li key={c.id} className="group relative">
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className={cn("block w-full rounded-[3px] px-2.5 py-2 pr-8 text-left", c.id === active ? "bg-panel-3 text-text" : "text-text-2 hover:bg-panel-2")}
            >
              <span className="block truncate text-[13px] font-semibold">{c.title}</span>
              <span className="block text-[11px] text-text-3">
                <Age from={Date.parse(c.updatedAt)} className="text-text-3" /> ago
              </span>
            </button>
            {canWrite && (
              <button
                type="button"
                aria-label={`Delete ${c.title}`}
                onClick={() => onDelete(c.id)}
                className="absolute right-1.5 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[3px] text-text-3 hover:bg-panel-3 hover:text-sell group-hover:flex"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
        {!chats.length && <li className="px-2.5 py-2 text-[12px] text-text-3">No chats yet.</li>}
      </ul>
    </div>
  );
}

// ─── the tab ────────────────────────────────────────────────────────

interface Live {
  pending: boolean;
  draft: string;
  status: string | null;
  extra: ChatMessageView[];
}

const IDLE: Live = { pending: false, draft: "", status: null, extra: [] };

export function ChatTab({ ws }: { ws: CloudWorkspace }) {
  const slug = ws.agent.slug;
  const mobile = useIsMobile();
  const canWrite = ws.role === "owner";
  const invalidate = useInvalidateCloud();
  const chats = useChats(slug);
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [sheet, setSheet] = useState(false);
  const detail = useChat(slug, active);
  const [live, setLive] = useState<Live>(IDLE);
  const [text, setText] = useState("");
  const [used, setUsed] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Open the most recent chat once the list arrives.
  useEffect(() => {
    if (!picked && !active && chats.data?.chats.length) setActive(chats.data.chats[0].id);
  }, [chats.data, active, picked]);

  const messages = useMemo(() => {
    const base = detail.data?.messages ?? [];
    const seen = new Set(base.map((m) => m.id));
    return [...base, ...live.extra.filter((m) => !seen.has(m.id))];
  }, [detail.data, live.extra]);

  // Stick to the newest message (after layout, so the last rows are measured).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live.draft, live.status, active]);

  const offline = ws.access.llm !== "ok";
  const cap = ws.access.dailyMessages;
  const usedToday = used ?? ws.access.usedToday;
  const capped = usedToday >= cap;
  const disabled = !canWrite || live.pending || offline || capped;

  const pick = (id: string | null) => {
    setPicked(true);
    setActive(id);
    setLive(IDLE);
    setSheet(false);
  };

  const remove = async (id: string) => {
    try {
      await cloudApi.deleteChat(slug, id);
      if (id === active) pick(null);
      invalidate(slug, "chats");
    } catch (e) {
      toast({ title: "Couldn't delete that chat", description: errorText(e), variant: "destructive" });
    }
  };

  const send = async (content: string) => {
    const msg = content.trim();
    if (!msg || disabled) return;
    setText("");
    let chatId = active;
    const temp: ChatMessageView = { id: `tmp-${Date.now()}`, role: "user", content: msg, helper: null, model: null, meta: {}, createdAt: new Date().toISOString() };
    setLive({ pending: true, draft: "", status: "Thinking…", extra: [temp] });
    try {
      if (!chatId) {
        chatId = (await cloudApi.createChat(slug)).chat.id;
        setPicked(true);
        setActive(chatId);
      }
      await streamMessage(slug, chatId, msg, (e) => {
        if (e.type === "done") setUsed(e.usedToday);
        setLive((l) => {
          switch (e.type) {
            case "start":
              return { ...l, extra: l.extra.map((m) => (m.id === temp.id ? e.userMessage : m)) };
            case "delta":
              return { ...l, draft: l.draft + e.text, status: null };
            case "draft_reset":
              return { ...l, draft: "" };
            case "tool":
              return { ...l, status: `Using ${toolLabel(e.name).toLowerCase()}…` };
            case "helper_start":
              return { ...l, status: `The ${helperLabel(e.role).toLowerCase()} helper is working…` };
            case "message":
              return { ...l, draft: "", status: e.message.role === "agent" ? null : "Thinking…", extra: [...l.extra, e.message] };
            case "error":
              return l.extra.some((m) => m.role === "error")
                ? l
                : { ...l, extra: [...l.extra, { id: `err-${Date.now()}`, role: "error", content: e.message, helper: null, model: null, meta: {}, createdAt: new Date().toISOString() }] };
            case "done":
              return { ...l, pending: false, status: null };
            default:
              return l;
          }
        });
      });
    } catch (e) {
      setLive((l) => ({ ...l, extra: [...l.extra, { id: `err-${Date.now()}`, role: "error", content: errorText(e), helper: null, model: null, meta: {}, createdAt: new Date().toISOString() }] }));
    } finally {
      setLive((l) => ({ ...l, pending: false, status: null, draft: "" }));
      await detail.refetch().catch(() => {});
      invalidate(slug);
      setLive((l) => ({ ...l, extra: l.extra.filter((m) => m.id.startsWith("err-")) }));
      input.current?.focus();
    }
  };

  const title = chats.data?.chats.find((c) => c.id === active)?.title ?? "New chat";
  const list = (
    <ChatList chats={chats.data?.chats ?? []} active={active} onPick={pick} onNew={() => pick(null)} onDelete={remove} canWrite={canWrite} />
  );

  return (
    <div className="flex h-full min-h-0 md:grid md:grid-cols-[230px_minmax(0,1fr)] md:gap-4">
      {!mobile && <aside className="hidden min-h-0 flex-col md:flex">{list}</aside>}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col md:panel md:overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-1 pb-2 md:px-4 md:py-2.5">
          {mobile && (
            <button type="button" onClick={() => setSheet(true)} className="inline-flex h-9 items-center rounded-[3px] border border-line-2 px-3 text-[12.5px] font-bold text-text-2">
              Chats
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{active ? title : "New chat"}</span>
          {mobile && canWrite && active && (
            <button type="button" onClick={() => pick(null)} className="inline-flex h-9 items-center gap-1 rounded-[3px] border border-line-2 px-3 text-[12.5px] font-bold text-text-2">
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          )}
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-1 py-4 md:px-5">
          {messages.length === 0 && !live.pending ? (
            <div className="mx-auto flex max-w-lg flex-col items-center pt-6 text-center md:pt-12">
              <AgentAvatar agent={ws.agent} size={52} />
              <h3 className="display-section mt-3 text-text">Talk to {ws.agent.name}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-text-3">
                It can look up $CLAUDIO and coins launched on Claudio, read the thread, keep notes and files, ask its helpers, and place paper trades within its guard rails.
              </p>
              {canWrite && !offline && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {QUICK.map((q) => (
                    <button key={q} type="button" onClick={() => send(q)} className="min-h-[40px] rounded-[3px] border border-line-2 px-3 py-1.5 text-[12.5px] text-text-2 hover:border-text-3 hover:text-text">
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3.5">
              {messages.map((m) => (
                <MessageRow key={m.id} m={m} agent={ws.agent} slug={slug} approvals={detail.data?.approvals ?? {}} canDecide={canWrite} onDecided={() => void detail.refetch()} />
              ))}
              {live.draft && (
                <div className="flex gap-2.5">
                  <AgentAvatar agent={ws.agent} size={28} className="mt-0.5" />
                  <PlainText text={live.draft} className="min-w-0 flex-1 text-[14px] leading-relaxed text-text" />
                </div>
              )}
              {live.pending && live.status && (
                <div className="flex items-center gap-2.5 pl-[38px] text-[12.5px] text-text-3">
                  <span className="inline-flex gap-1" aria-hidden>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-3" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-3 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-3 [animation-delay:300ms]" />
                  </span>
                  {live.status}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line px-1 pb-8 pt-2.5 md:px-4 md:pb-3">
          {offline ? (
            <p className="rounded-[3px] bg-panel-2 px-3 py-2 text-[12.5px] text-text-3">
              {ws.access.llm === "budget" ? "Your agent has used today's thinking time. Chat opens again tomorrow (UTC)." : "Your agent is offline right now. Chat opens again when it's back."}
            </p>
          ) : !canWrite ? (
            <p className="rounded-[3px] bg-panel-2 px-3 py-2 text-[12.5px] text-text-3">You're viewing this workspace as an admin. Only the owner can chat.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
              className="mx-auto flex max-w-3xl items-end gap-2"
            >
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
                rows={Math.min(6, Math.max(1, text.split("\n").length))}
                maxLength={4000}
                disabled={capped}
                placeholder={capped ? "That's all your messages for today" : `Message ${ws.agent.name}`}
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-line-2 bg-bg-elev px-3.5 py-2.5 text-[14px] leading-snug text-text outline-none placeholder:text-text-3 focus:border-brand disabled:opacity-60"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={disabled || !text.trim()}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] bg-brand text-brand-ink disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </form>
          )}
          {canWrite && !offline && (
            <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-text-3">
              <span className="num">{Math.max(0, cap - usedToday)}</span> of <span className="num">{cap}</span> messages left today · Not financial advice
            </p>
          )}
        </div>
      </section>
      {mobile && (
        <ResponsiveSheet open={sheet} onOpenChange={setSheet} title="Chats">
          <div className="max-h-[60dvh]">{list}</div>
        </ResponsiveSheet>
      )}
    </div>
  );
}
