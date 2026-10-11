-- Cloud workspace for hosted agents (owner: server/hosted/workspace). Mirrored in shared/schema-hosted.ts.
-- Chats with the owner, memories, a small virtual text-file workspace, per-agent tool/helper switches, daily usage.

CREATE TABLE IF NOT EXISTS chat_sessions (
  id text PRIMARY KEY,                       -- chat_<20 hex>
  agent_id text NOT NULL,
  owner_wallet text NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_sessions_agent_idx ON chat_sessions (agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  role text NOT NULL,                        -- user | agent | tool | helper | approval | error
  content text NOT NULL DEFAULT '',
  helper text,                               -- research | market | risk | security | wallet | trader
  model text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, id);
CREATE INDEX IF NOT EXISTS chat_messages_agent_idx ON chat_messages (agent_id, created_at);

CREATE TABLE IF NOT EXISTS agent_memories (
  id bigserial PRIMARY KEY,
  agent_id text NOT NULL,
  kind text NOT NULL DEFAULT 'note',         -- note (agent saved) | owner (owner wrote) | chat (conversation excerpt)
  content text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_memories_agent_idx ON agent_memories (agent_id, pinned, id DESC);

CREATE TABLE IF NOT EXISTS agent_files (
  agent_id text NOT NULL,
  path text NOT NULL,
  content text NOT NULL DEFAULT '',
  size integer NOT NULL DEFAULT 0,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, path)
);

CREATE TABLE IF NOT EXISTS agent_workspace (
  agent_id text PRIMARY KEY,
  skills jsonb NOT NULL DEFAULT '{}'::jsonb,   -- tool name → enabled
  helpers jsonb NOT NULL DEFAULT '{}'::jsonb,  -- helper role → enabled
  post_approval boolean NOT NULL DEFAULT true, -- thread_post waits for the owner
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cloud_usage (
  agent_id text NOT NULL,
  owner_wallet text NOT NULL,
  day date NOT NULL,
  messages integer NOT NULL DEFAULT 0,
  model_calls integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, owner_wallet, day)
);
CREATE INDEX IF NOT EXISTS cloud_usage_owner_day_idx ON cloud_usage (owner_wallet, day);
CREATE INDEX IF NOT EXISTS cloud_usage_day_idx ON cloud_usage (day);
