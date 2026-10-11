-- Online MCP server + its OAuth 2.1 authorization server (owner: server/mcp). Mirrored in shared/schema-mcp.ts.
-- Secrets are never stored: access/refresh tokens, authorization codes and MCP keys are kept as SHA-256 hex only.

-- Dynamically registered OAuth clients (RFC 7591, public clients only). The pre-registered `claudio-cli` client and
-- Client ID Metadata Document clients (https URL client_ids) live in code / memory, not here.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id text PRIMARY KEY,                -- mcpc_<random>
  name text NOT NULL,
  redirect_uris jsonb NOT NULL,              -- string[]
  client_uri text,
  logo_uri text,
  application_type text NOT NULL DEFAULT 'web',
  created_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Pending /oauth/authorize requests waiting for the user on /connect (10 minutes).
CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
  id text PRIMARY KEY,                       -- random, shown in the /connect URL
  client_id text NOT NULL,
  client_name text NOT NULL,
  client_kind text NOT NULL,                 -- first_party | metadata_document | registered
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  state text,
  code_challenge text NOT NULL,
  resource text,
  expires_at timestamptz NOT NULL,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per "app connected to a wallet" (consent). Revoking it revokes every token issued under it.
CREATE TABLE IF NOT EXISTS mcp_grants (
  id text PRIMARY KEY,                       -- grt_<random>
  wallet text NOT NULL,
  client_id text NOT NULL,
  client_name text NOT NULL,
  scopes text[] NOT NULL,
  agent_id text,                             -- agent that posts for thread:write
  resource text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_grants_wallet_idx ON mcp_grants (wallet, created_at DESC);

-- Authorization codes (2 minutes, single use, PKCE S256).
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash text PRIMARY KEY,
  grant_id text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Access (1 hour) and refresh (30 days, rotated on every use) tokens.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_hash text PRIMARY KEY,
  kind text NOT NULL,                        -- access | refresh
  grant_id text NOT NULL,
  wallet text NOT NULL,
  client_id text NOT NULL,
  scopes text[] NOT NULL,
  resource text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_tokens_grant_idx ON mcp_tokens (grant_id);

-- Long-lived bearer keys for apps that can't do OAuth (OpenAI / xAI APIs, LM Studio). Created on /connect.
CREATE TABLE IF NOT EXISTS mcp_keys (
  id text PRIMARY KEY,                       -- key_<random>
  wallet text NOT NULL,
  name text NOT NULL,
  prefix text NOT NULL,                      -- first characters, for display
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  agent_id text,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_keys_wallet_idx ON mcp_keys (wallet, created_at DESC);

-- Non-custodial prepared trades / launches: the user opens /confirm/<id> and signs with their own wallet (2 minutes).
CREATE TABLE IF NOT EXISTS mcp_prepared (
  id text PRIMARY KEY,                       -- random, unguessable
  wallet text NOT NULL,
  kind text NOT NULL,                        -- trade | launch
  params jsonb NOT NULL,
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',    -- pending | signed | confirmed | failed | expired
  signatures text[] NOT NULL DEFAULT '{}',
  mint text,
  error text,
  client_name text,
  grant_id text,
  key_id text,
  expires_at timestamptz NOT NULL,
  signed_at timestamptz,
  confirmed_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_prepared_wallet_idx ON mcp_prepared (wallet, created_at DESC);

-- Watchlist a wallet chose to share with its connected apps (the site keeps watchlists in the browser otherwise).
CREATE TABLE IF NOT EXISTS mcp_watchlists (
  wallet text PRIMARY KEY,
  keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
