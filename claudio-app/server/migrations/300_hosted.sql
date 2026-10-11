-- Hosted agents (owner: server/hosted): escrow wallets, policies, ledger, paper trades, approvals, decision log,
-- runner state and global settings. Mirrored in shared/schema-hosted.ts. No foreign key to agents(id): that table
-- belongs to the agents workstream and may be created after this file runs.

-- One Claudio-held Solana wallet per hosted agent (and Claudio himself). Envelope encryption:
--   enc_key = AES-256-GCM(data key, ed25519 seed), iv/tag alongside, AAD = agent id + address
--   wrapped_dek = AES-256-GCM(KEK, data key) as "iv.tag.ct" (base64), KEK = HKDF-SHA256(VAULT_MASTER_KEY)
--   key_version = fingerprint of the KEK that wrapped the data key (rotation re-wraps rows still on the old one)
CREATE TABLE IF NOT EXISTS agent_wallets (
  agent_id text PRIMARY KEY,
  address text NOT NULL UNIQUE,
  enc_key text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  wrapped_dek text NOT NULL,
  key_version text NOT NULL,
  balance_lamports bigint,
  balance_at timestamptz,
  last_signature text,
  polled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);
CREATE INDEX IF NOT EXISTS agent_wallets_key_version_idx ON agent_wallets (key_version);

-- Guard rails (shared/agents.ts AgentPolicy). admin_killed can only be cleared by an admin.
CREATE TABLE IF NOT EXISTS agent_policies (
  agent_id text PRIMARY KEY,
  policy jsonb NOT NULL,
  admin_killed boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Real money movements of an escrow wallet, detected on-chain (poller) or reported by the collector.
-- kind: creator_fee (pump creator-fee payout) | inflow (any other incoming SOL) | outflow | trade
CREATE TABLE IF NOT EXISTS agent_ledger (
  id bigserial PRIMARY KEY,
  agent_id text NOT NULL,
  address text NOT NULL,
  kind text NOT NULL,
  amount_sol double precision NOT NULL,
  signature text NOT NULL,
  source text,
  slot bigint,
  block_time timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_ledger_sig_idx ON agent_ledger (agent_id, signature, kind);
CREATE INDEX IF NOT EXISTS agent_ledger_agent_idx ON agent_ledger (agent_id, created_at DESC);

-- Simulated trades (paper mode). Separate from the ledger: nothing here ever moved real funds.
CREATE TABLE IF NOT EXISTS agent_paper_trades (
  id bigserial PRIMARY KEY,
  agent_id text NOT NULL,
  mint text NOT NULL,
  symbol text,
  side text NOT NULL,
  amount_sol double precision NOT NULL,
  tokens double precision NOT NULL,
  price_sol double precision NOT NULL,
  fee_sol double precision NOT NULL DEFAULT 0,
  reason text,
  approval_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_paper_trades_agent_idx ON agent_paper_trades (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_paper_trades_mint_idx ON agent_paper_trades (agent_id, mint);

-- "Ask the owner above X": queued intents the owner approves or rejects. status: pending | approved | rejected |
-- expired | executed | failed
CREATE TABLE IF NOT EXISTS agent_approvals (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  kind text NOT NULL,
  intent jsonb NOT NULL,
  intent_hash text NOT NULL,
  amount_sol double precision NOT NULL DEFAULT 0,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_approvals_agent_idx ON agent_approvals (agent_id, status, created_at DESC);

-- Decision/action log (ring buffer: the runner keeps the newest HOSTED_LOG_KEEP rows per agent).
CREATE TABLE IF NOT EXISTS agent_actions (
  id bigserial PRIMARY KEY,
  agent_id text NOT NULL,
  kind text NOT NULL,
  ok boolean NOT NULL DEFAULT true,
  model text,
  summary text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_actions_agent_idx ON agent_actions (agent_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_actions_day_idx ON agent_actions (created_at);

-- Runner state per hosted agent: on/off, owner goals, compact rolling memory, schedule, failure backoff.
CREATE TABLE IF NOT EXISTS agent_runtime (
  agent_id text PRIMARY KEY,
  running boolean NOT NULL DEFAULT false,
  goals text NOT NULL DEFAULT '',
  memory text NOT NULL DEFAULT '',
  runs integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  last_error text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  started_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runtime_due_idx ON agent_runtime (running, next_run_at);

-- Global switches for the hosted module (key "kill" → { killed, reason, by, at }).
CREATE TABLE IF NOT EXISTS hosted_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
