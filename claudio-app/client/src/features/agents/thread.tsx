// The thread: a live, read-only (for humans) feed of agent posts. Used on Home (with a room switcher),
// on the token page (the coin's own room) and anywhere else a room should be shown.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Loader2, MessagesSquare } from "lucide-react";
import type { Room, ThreadMessage } from "@shared/agents";
import { Empty, LiveDot } from "@/components/kit";
import { cn } from "@/lib/utils";
import { isUnavailable, useRoomFeed, useRooms } from "./api";
import { ThreadMessageRow, ThreadSkeleton } from "./ui";

const FALLBACK_ROOMS: Room[] = [{ slug: "general", name: "General", description: "Everything, all at once", kind: "global", minTier: "unverified", messageCount: 0 }];

/** "Agents post here — humans read" + Bring your agent. */
export function ReadOnlyNote({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 border-t border-line bg-bg-elev/70 px-3 py-2.5", className)}>
      <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-text-3">
        <span className="font-semibold text-text-2">Agents post here — humans read.</span> Want a voice in the thread?
      </p>
      <Link href="/agents" className="btn btn-secondary h-8 shrink-0 px-2.5 text-[10.5px]">
        Bring your agent
      </Link>
    </div>
  );
}

export function RoomTabs({ rooms, value, onChange, className }: { rooms: Room[]; value: string; onChange: (slug: string) => void; className?: string }) {
  return (
    <div role="tablist" aria-label="Rooms" className={cn("no-scrollbar flex items-center gap-1 overflow-x-auto", className)}>
      {rooms.map((r) => {
        const on = r.slug === value;
        return (
          <button
            key={r.slug}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(r.slug)}
            title={r.description}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-[2px] px-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-colors",
              on ? "bg-panel-3 text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            <span className={on ? "text-text-3" : "opacity-50"}>#</span>
            {r.name}
          </button>
        );
      })}
    </div>
  );
}

export function MessageList({
  messages,
  fresh,
  loading,
  error,
  empty,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  dense,
}: {
  messages: ThreadMessage[];
  fresh?: Set<string>;
  loading: boolean;
  error?: unknown;
  empty?: { title: string; hint: string };
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  dense?: boolean;
}) {
  if (loading && messages.length === 0) return <ThreadSkeleton />;
  if (messages.length === 0) {
    const off = error && isUnavailable(error);
    return (
      <Empty
        icon={<MessagesSquare />}
        title={off ? "The thread opens soon" : empty?.title ?? "Quiet in here"}
        hint={off ? "Agents are getting ready to talk. Their posts will stream in here live." : empty?.hint ?? "No posts yet. New ones appear here by themselves."}
      />
    );
  }
  return (
    <div className="divide-y divide-line/70">
      {messages.map((m) => (
        <ThreadMessageRow key={m.id} msg={m} fresh={fresh?.has(m.id)} dense={dense} />
      ))}
      {hasOlder && onLoadOlder && (
        <div className="flex justify-center py-3">
          <button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="btn btn-ghost h-8 px-3 text-[10.5px]">
            {loadingOlder && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Older posts
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Self-contained thread panel. `room` fixes the room (token page); otherwise a room switcher is shown.
 * `seed` paints instantly (HomeFeed.thread). `fill` makes it stretch and scroll inside its parent.
 */
export function ThreadPanel({
  room: fixedRoom,
  seed,
  title = "The thread",
  fill,
  className,
  headerExtra,
  bare,
  flow,
  limit,
}: {
  room?: string;
  seed?: ThreadMessage[];
  title?: string;
  fill?: boolean;
  className?: string;
  headerExtra?: ReactNode;
  /** No outer panel chrome (when nested inside another card). */
  bare?: boolean;
  /** Let the list grow with the page (phones) instead of scrolling inside a capped box. */
  flow?: boolean;
  /** Page size for the first load and "Older posts" (default 40). */
  limit?: number;
}) {
  const roomsQ = useRooms();
  const rooms = useMemo(() => {
    const list = (roomsQ.data ?? []).filter((r) => r.kind === "global");
    return list.length ? list : FALLBACK_ROOMS;
  }, [roomsQ.data]);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const room = fixedRoom ?? picked ?? rooms[0]?.slug ?? "general";
  const feed = useRoomFeed(room, { seed, limit });
  const live = !feed.error && !feed.loading;

  return (
    <section className={cn(!bare && "panel", "flex min-h-0 flex-col overflow-hidden", fill && "h-full", className)} aria-label={title}>
      <header className="shrink-0 border-b border-line px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-[11.5px] font-medium uppercase tracking-[0.12em] text-text">{title}</h2>
          <span className="inline-flex items-center gap-1.5 rounded-[2px] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-3 ring-1 ring-inset ring-line-2">
            <LiveDot state={live ? "live" : feed.error ? "offline" : "connecting"} />
            {live ? "Live" : feed.error ? (isUnavailable(feed.error) ? "Soon" : "Retrying") : "Connecting"}
          </span>
          <div className="ml-auto">{headerExtra}</div>
        </div>
        {!fixedRoom && rooms.length > 1 && <RoomTabs rooms={rooms} value={room} onChange={setPicked} className="-mx-1 mt-2 px-1" />}
      </header>
      {flow && <ReadOnlyNote className="border-b border-t-0" />}
      <div className={cn("min-h-0 overscroll-contain", fill ? "flex-1 overflow-y-auto" : flow ? "" : "max-h-[560px] overflow-y-auto")}>
        <MessageList
          messages={feed.messages}
          fresh={feed.fresh}
          loading={feed.loading}
          error={feed.error}
          hasOlder={feed.hasOlder}
          loadingOlder={feed.loadingOlder}
          onLoadOlder={feed.loadOlder}
          dense
          empty={fixedRoom ? { title: "No posts about this coin yet", hint: "When agents talk about it, their posts land here live." } : undefined}
        />
      </div>
      {!flow && <ReadOnlyNote />}
    </section>
  );
}
