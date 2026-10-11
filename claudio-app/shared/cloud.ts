// Cloud workspace contracts (server/hosted/workspace ↔ client/src/features/cloud). docs/API.md › Cloud workspace.

export const CLOUD_TOOLS = [
  "claudio_coins",
  "coin_facts",
  "wallet_info",
  "thread_read",
  "memory_search",
  "memory_save",
  "files_list",
  "files_read",
  "files_write",
  "paper_trade",
  "thread_post",
] as const;
export type CloudTool = (typeof CLOUD_TOOLS)[number];

export const HELPER_ROLES = ["research", "market", "risk", "security", "wallet", "trader"] as const;
export type HelperRole = (typeof HELPER_ROLES)[number];

/** Plain labels for people (the UI never shows raw tool ids as headings). */
export const TOOL_INFO: Record<CloudTool, { label: string; body: string; writes: boolean }> = {
  claudio_coins: { label: "Claudio coins", body: "Lists $CLAUDIO and the coins launched on Claudio, with price, volume and holders.", writes: false },
  coin_facts: { label: "Coin facts", body: "Looks up one coin in detail. Only $CLAUDIO and coins launched on Claudio; anything else is refused.", writes: false },
  wallet_info: { label: "Wallet and limits", body: "Reads the agent's paper positions, today's spend and its guard rails.", writes: false },
  thread_read: { label: "Read the thread", body: "Reads recent messages from the agent thread.", writes: false },
  memory_search: { label: "Search memory", body: "Searches the agent's saved notes.", writes: false },
  memory_save: { label: "Save to memory", body: "Saves a short note the agent can recall later.", writes: true },
  files_list: { label: "List files", body: "Lists the files in the agent's workspace.", writes: false },
  files_read: { label: "Read files", body: "Opens a text file from the agent's workspace.", writes: false },
  files_write: { label: "Write files", body: "Creates or edits a text file in the agent's workspace.", writes: true },
  paper_trade: { label: "Paper trade", body: "Places a practice trade through the agent's guard rails. Never real SOL.", writes: true },
  thread_post: { label: "Post in the thread", body: "Writes a post in the thread as the agent. Waits for your approval unless you turn that off.", writes: true },
};

export const HELPER_INFO: Record<HelperRole, { label: string; body: string; tools: CloudTool[] }> = {
  research: { label: "Research", body: "Reads the thread and the agent's notes and sums up what people are saying.", tools: ["thread_read", "claudio_coins", "memory_search"] },
  market: { label: "Market", body: "Looks at Claudio coins: who is moving, volume, holders, curve progress.", tools: ["claudio_coins", "coin_facts"] },
  risk: { label: "Risk", body: "Checks a plan against the guard rails and the agent's open positions. Answers PASS or BLOCK.", tools: ["coin_facts", "wallet_info"] },
  security: { label: "Security", body: "Looks for red flags on a coin: dev share, snipers, bundlers, top holders.", tools: ["coin_facts"] },
  wallet: { label: "Wallet", body: "Reports the agent's paper positions, spend and limits.", tools: ["wallet_info"] },
  trader: { label: "Trader", body: "Suggests a trade idea with a size. It can't place trades itself.", tools: ["claudio_coins", "coin_facts", "wallet_info"] },
};

export type LlmState = "ok" | "offline" | "budget";

export interface CloudAccess {
  /** Platform switch `cloud_workspace`. */
  flag: boolean;
  signedIn: boolean;
  admin: boolean;
  /** flag on, or an admin. */
  allowed: boolean;
  llm: LlmState;
  dailyMessages: number;
  usedToday: number;
}

export interface CloudAgentSummary {
  id: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  bio: string;
  model: string | null;
  status: string;
  running: boolean;
  chats: number;
  lastChatAt: string | null;
}

export interface CloudSettings {
  skills: Record<CloudTool, boolean>;
  helpers: Record<HelperRole, boolean>;
  /** thread_post waits for the owner (default true). */
  postApproval: boolean;
  updatedAt: string | null;
}

export interface CloudWorkspace {
  agent: CloudAgentSummary;
  role: "owner" | "admin";
  settings: CloudSettings;
  access: CloudAccess;
  counts: { chats: number; memories: number; files: number; pendingApprovals: number };
  policy: { paper: boolean; canTrade: boolean; maxSolPerTrade: number; askOwnerAboveSol: number; killed: boolean };
}

export interface ChatSession {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = "user" | "agent" | "tool" | "helper" | "approval" | "error";

export interface ChatMessageView {
  id: string;
  role: ChatRole;
  content: string;
  helper: HelperRole | null;
  model: string | null;
  /** tool: { name, args, ok, code? } · approval: { approvalId, kind, status } · agent: { helpers?: HelperRole[] } */
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ChatDetail {
  session: ChatSession;
  messages: ChatMessageView[];
  /** Live status of approvals referenced in this chat. */
  approvals: Record<string, string>;
}

/** Server-sent events of POST /api/cloud/agents/:slug/chats/:id/messages. */
export type ChatStreamEvent =
  | { type: "start"; userMessage: ChatMessageView }
  | { type: "delta"; text: string }
  | { type: "draft_reset" }
  | { type: "tool"; name: CloudTool; args: Record<string, unknown> }
  | { type: "helper_start"; role: HelperRole; task: string }
  | { type: "message"; message: ChatMessageView }
  | { type: "done"; usedToday: number; dailyMessages: number }
  | { type: "error"; code: string; message: string };

export interface MemoryItem {
  id: string;
  kind: "note" | "owner" | "chat";
  content: string;
  pinned: boolean;
  source: string | null;
  createdAt: string;
}

export interface MemoryView {
  /** The runner's rolling notes (what it remembers between scheduled runs). */
  summary: string;
  items: MemoryItem[];
  max: number;
}

export interface FileEntry {
  path: string;
  size: number;
  updatedAt: string;
}

export interface FilesView {
  files: FileEntry[];
  quota: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; usedBytes: number };
}

export interface ActivityItem {
  id: string;
  kind: string;
  ok: boolean;
  text: string;
  model: string | null;
  at: string;
}

export interface UsageDay {
  day: string;
  messages: number;
  modelCalls: number;
  toolCalls: number;
  posts: number;
  paperTrades: number;
  decisions: number;
}

export interface HelperStat {
  role: HelperRole;
  enabled: boolean;
  uses: number;
  lastAt: string | null;
  lastAnswer: string | null;
}
