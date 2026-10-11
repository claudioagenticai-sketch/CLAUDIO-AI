-- Wallet sign-in (Sign-In With Solana style): one-time nonces and sessions. Owned by server/auth.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce text PRIMARY KEY,
  wallet text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_nonces_wallet_idx ON auth_nonces (wallet);

-- Only the SHA-256 of the session token is stored. admin_until is set by the admin password step.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  wallet text NOT NULL,
  ip text,
  user_agent text,
  admin_until timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_wallet_idx ON auth_sessions (wallet);

-- Append-only security/audit trail shared by every module (admin actions, bans, quarantines, sensor hits).
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor text,
  action text NOT NULL,
  target text,
  severity text NOT NULL DEFAULT 'info',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor, created_at DESC);
