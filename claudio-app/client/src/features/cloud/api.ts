// Typed client for the Cloud workspace (server/hosted/workspace, docs/API.md › Cloud workspace).
// Chat replies stream as Server-Sent Events over a POST, read here with fetch + a stream reader.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActivityItem,
  ChatDetail,
  ChatSession,
  ChatStreamEvent,
  CloudAccess,
  CloudAgentSummary,
  CloudSettings,
  CloudTool,
  CloudWorkspace,
  FileEntry,
  FilesView,
  HelperRole,
  HelperStat,
  MemoryItem,
  MemoryView,
  UsageDay,
} from "@shared/cloud";
import type { AgentApproval } from "@shared/agents";
import { ApiError, request } from "@/features/agents/api";

const enc = encodeURIComponent;
const A = (slug: string) => `/api/cloud/agents/${enc(slug)}`;

export interface SkillRow {
  name: CloudTool;
  label: string;
  body: string;
  writes: boolean;
  enabled: boolean;
}

export type HelperRow = HelperStat & { label: string; body: string; tools: string[] };

export const cloudApi = {
  access: () => request<CloudAccess>("GET", "/api/cloud/access"),
  agents: () => request<{ agents: CloudAgentSummary[]; access: CloudAccess }>("GET", "/api/cloud/agents"),
  workspace: (slug: string) => request<CloudWorkspace>("GET", A(slug)),
  chats: (slug: string) => request<{ chats: ChatSession[] }>("GET", `${A(slug)}/chats`),
  createChat: (slug: string) => request<{ chat: ChatSession }>("POST", `${A(slug)}/chats`, {}),
  chat: (slug: string, id: string) => request<ChatDetail>("GET", `${A(slug)}/chats/${enc(id)}`),
  renameChat: (slug: string, id: string, title: string) => request<{ chat: ChatSession }>("PATCH", `${A(slug)}/chats/${enc(id)}`, { title }),
  deleteChat: (slug: string, id: string) => request<{ ok: boolean }>("DELETE", `${A(slug)}/chats/${enc(id)}`),
  skills: (slug: string) => request<{ skills: SkillRow[]; postApproval: boolean }>("GET", `${A(slug)}/skills`),
  helpers: (slug: string) => request<{ helpers: HelperRow[] }>("GET", `${A(slug)}/helpers`),
  saveSettings: (slug: string, patch: { skills?: Partial<Record<CloudTool, boolean>>; helpers?: Partial<Record<HelperRole, boolean>>; postApproval?: boolean }) =>
    request<{ settings: CloudSettings }>("PUT", `${A(slug)}/settings`, patch),
  memory: (slug: string, q?: string) => request<MemoryView>("GET", `${A(slug)}/memory${q ? `?q=${enc(q)}` : ""}`),
  addMemory: (slug: string, content: string, pinned: boolean) => request<{ item: MemoryItem }>("POST", `${A(slug)}/memory`, { content, pinned }),
  pinMemory: (slug: string, id: string, pinned: boolean) => request<{ item: MemoryItem }>("PATCH", `${A(slug)}/memory/${enc(id)}`, { pinned }),
  deleteMemory: (slug: string, id: string) => request<{ ok: boolean }>("DELETE", `${A(slug)}/memory/${enc(id)}`),
  clearSummary: (slug: string) => request<{ ok: boolean }>("DELETE", `${A(slug)}/memory/summary`),
  files: (slug: string) => request<FilesView>("GET", `${A(slug)}/files`),
  file: (slug: string, path: string) => request<{ file: { path: string; content: string; size: number; updatedAt: string } }>("GET", `${A(slug)}/files/content?path=${enc(path)}`),
  writeFile: (slug: string, path: string, content: string) => request<{ file: FileEntry }>("PUT", `${A(slug)}/files`, { path, content }),
  deleteFile: (slug: string, path: string) => request<{ ok: boolean }>("DELETE", `${A(slug)}/files?path=${enc(path)}`),
  activity: (slug: string) => request<{ items: ActivityItem[]; approvals: AgentApproval[] }>("GET", `${A(slug)}/activity`),
  usage: (slug: string) => request<{ days: UsageDay[]; dailyMessages: number; usedToday: number }>("GET", `${A(slug)}/usage`),
  decide: (slug: string, id: string, approve: boolean) => request<unknown>("POST", `/api/agents/${enc(slug)}/approvals/${enc(id)}`, { approve }),
};

/**
 * Sends a chat message and calls `onEvent` for every server-sent event until the reply is done.
 * Refusals that happen before the stream starts (offline, daily cap, busy…) come back as JSON and throw an ApiError.
 */
export async function streamMessage(slug: string, chatId: string, content: string, onEvent: (e: ChatStreamEvent) => void): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${A(slug)}/chats/${enc(chatId)}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ content }),
    });
  } catch {
    throw new ApiError(0, "network", "network", "Network error");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !res.body) {
    const j = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    const code = j?.error ?? `http_${res.status}`;
    const kind = res.status === 401 ? "sign_in" : res.status === 403 ? "forbidden" : res.status === 429 ? "rate_limited" : res.status === 503 ? "unavailable" : res.status >= 500 ? "server" : "invalid";
    throw new ApiError(res.status, code, kind, j?.message ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      } catch {
        /* partial / keep-alive */
      }
    }
  }
}

// ─── hooks ──────────────────────────────────────────────────────────

const retry = (n: number, e: unknown) => !(e instanceof ApiError && e.kind !== "network" && e.kind !== "server") && n < 2;

export const CLOUD_KEY = ["cloud"] as const;

export function useCloudAccess() {
  return useQuery<CloudAccess, ApiError>({ queryKey: [...CLOUD_KEY, "access"], queryFn: cloudApi.access, staleTime: 15_000, retry });
}

export function useCloudAgents(enabled: boolean) {
  return useQuery({ queryKey: [...CLOUD_KEY, "agents"], queryFn: cloudApi.agents, enabled, staleTime: 10_000, retry });
}

export function useWorkspace(slug: string, enabled = true) {
  return useQuery<CloudWorkspace, ApiError>({ queryKey: [...CLOUD_KEY, "ws", slug], queryFn: () => cloudApi.workspace(slug), enabled, staleTime: 10_000, retry });
}

export function useChats(slug: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "chats", slug], queryFn: () => cloudApi.chats(slug), staleTime: 5_000, retry });
}

export function useChat(slug: string, id: string | null) {
  return useQuery({ queryKey: [...CLOUD_KEY, "chat", slug, id], queryFn: () => cloudApi.chat(slug, id!), enabled: !!id, staleTime: 2_000, retry });
}

export function useSkills(slug: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "skills", slug], queryFn: () => cloudApi.skills(slug), retry });
}

export function useHelpers(slug: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "helpers", slug], queryFn: () => cloudApi.helpers(slug), retry });
}

export function useMemory(slug: string, q: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "memory", slug, q], queryFn: () => cloudApi.memory(slug, q), staleTime: 3_000, retry });
}

export function useFiles(slug: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "files", slug], queryFn: () => cloudApi.files(slug), staleTime: 3_000, retry });
}

export function useActivity(slug: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "activity", slug], queryFn: () => cloudApi.activity(slug), refetchInterval: 20_000, retry });
}

export function useUsage(slug: string) {
  return useQuery({ queryKey: [...CLOUD_KEY, "usage", slug], queryFn: () => cloudApi.usage(slug), staleTime: 10_000, retry });
}

/** Re-reads everything for one workspace (after a chat turn the agent may have changed memory, files, activity). */
export function useInvalidateCloud() {
  const qc = useQueryClient();
  return (slug: string, what?: string) => {
    if (what) return void qc.invalidateQueries({ queryKey: [...CLOUD_KEY, what, slug] });
    for (const k of ["ws", "chats", "memory", "files", "activity", "usage", "helpers", "skills"]) void qc.invalidateQueries({ queryKey: [...CLOUD_KEY, k, slug] });
    void qc.invalidateQueries({ queryKey: [...CLOUD_KEY, "access"] });
  };
}
