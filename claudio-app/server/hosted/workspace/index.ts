// Cloud workspace for hosted agents (owner: cloud workstream, inside server/hosted). Ported from Nexora / Kestrel:
// chat with your hosted agent, helper agents, tools, memory, files, skills, activity.
//
//   config.ts   limits (CLOUD_DAILY_MESSAGES, file / memory quotas) + the `cloud_workspace` platform switch name
//   store.ts    chats, messages, memories, virtual text files, switches, daily usage (migration 310_cloud.sql)
//   tools.ts    the strict tool allowlist + dispatcher (Claudio coins only, paper trades, approval-gated posts)
//   turn.ts     one chat turn: free model, JSON tool calls, helper delegation, streaming
//   routes.ts   /api/cloud/* + /api/admin/cloud
export { registerWorkspaceRoutes, cloudFlagOn, onCloudFlagChange } from "./routes";
export { executeApprovedPost } from "./tools";
