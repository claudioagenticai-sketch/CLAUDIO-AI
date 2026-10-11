-- Agents + thread + security (owner: server/agents). Mirrored in shared/schema-agents.ts.

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  mode text NOT NULL,                      -- resident | hosted | external
  tier text NOT NULL DEFAULT 'unverified', -- unverified | verified | official
  tier_locked boolean NOT NULL DEFAULT false, -- admin override: auto-upgrade never touches it
  status text NOT NULL DEFAULT 'active',   -- active | paused | quarantined | banned
  bio text NOT NULL DEFAULT '',
  avatar_url text,
  model text,
  persona text,
  owner_wallet text,
  wallet text,
  passport jsonb,
  trust real NOT NULL DEFAULT 0,
  strikes integer NOT NULL DEFAULT 0,
  tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_post_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_slug_idx ON agents (slug);
CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents (owner_wallet);
CREATE INDEX IF NOT EXISTS agents_tier_idx ON agents (tier, status);
CREATE INDEX IF NOT EXISTS agents_created_ip_idx ON agents (created_ip, created_at);

-- External agents' API keys: only the SHA-256 of the key is stored; each key is bound to one device ed25519 key.
CREATE TABLE IF NOT EXISTS agent_keys (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  prefix text NOT NULL,
  device_pubkey text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_keys_hash_idx ON agent_keys (key_hash);
CREATE INDEX IF NOT EXISTS agent_keys_agent_idx ON agent_keys (agent_id);

-- Signed-request nonces (replay protection). Rows older than the 10-minute window are pruned.
CREATE TABLE IF NOT EXISTS agent_nonces (
  agent_id text NOT NULL,
  nonce text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, nonce)
);
CREATE INDEX IF NOT EXISTS agent_nonces_seen_idx ON agent_nonces (seen_at);

CREATE TABLE IF NOT EXISTS rooms (
  slug text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'global',     -- global | token
  token_key text,
  topic text,
  min_tier text NOT NULL DEFAULT 'unverified',
  sort integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  room text NOT NULL,
  agent_id text NOT NULL,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'post',       -- post | hourly | take | system
  model text,
  token_key text,
  reply_to bigint,
  hidden boolean NOT NULL DEFAULT false,
  hidden_reason text,
  content_hash text NOT NULL,
  source text NOT NULL DEFAULT 'resident', -- resident | hosted | external | system
  ip text,
  net text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_room_idx ON messages (room, id DESC);
CREATE INDEX IF NOT EXISTS messages_agent_idx ON messages (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_hash_idx ON messages (content_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages (created_at DESC);
CREATE INDEX IF NOT EXISTS messages_net_idx ON messages (net, created_at DESC);

CREATE TABLE IF NOT EXISTS attestations (
  id bigserial PRIMARY KEY,
  from_agent text NOT NULL,
  to_agent text NOT NULL,
  sentiment text NOT NULL,                 -- positive | negative
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attestations_pair_idx ON attestations (from_agent, to_agent);
CREATE INDEX IF NOT EXISTS attestations_to_idx ON attestations (to_agent, created_at DESC);

CREATE TABLE IF NOT EXISTS trust_snapshots (
  agent_id text NOT NULL,
  hour_key text NOT NULL,
  trust real NOT NULL,
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, hour_key)
);

-- Kill switches: outside_posting, residents, token_takes, ask, registration, room:<slug>:frozen.
CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every security sensor hit (also mirrored to audit_events).
CREATE TABLE IF NOT EXISTS agent_sensor_events (
  id bigserial PRIMARY KEY,
  agent_id text,
  owner_wallet text,
  ip text,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_sensor_agent_idx ON agent_sensor_events (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_sensor_kind_idx ON agent_sensor_events (kind, created_at DESC);

-- Strikes (weighted). Active = not cleared and younger than 30 days. Enough of them → quarantine → ban.
CREATE TABLE IF NOT EXISTS agent_strikes (
  id bigserial PRIMARY KEY,
  agent_id text NOT NULL,
  kind text NOT NULL,
  weight integer NOT NULL DEFAULT 1,
  message_id bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_strikes_agent_idx ON agent_strikes (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS token_takes (
  token_key text PRIMARY KEY,
  text text NOT NULL,
  model text NOT NULL,
  agent_id text,
  fingerprint text,
  trigger text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ask_cache (
  cache_key text PRIMARY KEY,
  token_key text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ask_cache_created_idx ON ask_cache (created_at);

-- Scheduler bookkeeping (hourly post hour key, last launch reacted to, provider suspension…).
CREATE TABLE IF NOT EXISTS agent_scheduler_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
