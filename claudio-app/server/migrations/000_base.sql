-- Tables that existed before boot migrations (previously created by `npm run db:push`). IF NOT EXISTS keeps
-- databases that already have them untouched; a fresh database gets the same shape as shared/schema.ts.

CREATE TABLE IF NOT EXISTS launches (
  id text PRIMARY KEY,
  chain text NOT NULL,
  launchpad text NOT NULL,
  creator text NOT NULL,
  token text,
  splitter text,
  split_kind text NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  image_uri text,
  metadata_uri text,
  tx_hashes jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'prepared',
  referral_code text,
  beneficiary_identity text,
  beneficiary_vault text,
  request jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launches_creator_idx ON launches (creator);
CREATE INDEX IF NOT EXISTS launches_token_idx ON launches (token);
CREATE INDEX IF NOT EXISTS launches_beneficiary_idx ON launches (beneficiary_identity);

CREATE TABLE IF NOT EXISTS dev_stats (
  creator text PRIMARY KEY,
  launches integer NOT NULL DEFAULT 0,
  migrations integer NOT NULL DEFAULT 0,
  rugs integer NOT NULL DEFAULT 0,
  chains jsonb DEFAULT '[]'::jsonb,
  last_seen bigint
);

CREATE TABLE IF NOT EXISTS referrals (
  code text PRIMARY KEY,
  owner text NOT NULL,
  share_bps integer NOT NULL DEFAULT 2000,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_identities (
  key text PRIMARY KEY,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  id_hash text NOT NULL,
  handle text,
  display_name text,
  avatar_url text,
  opted_out boolean NOT NULL DEFAULT false,
  verified_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_identities_handle_idx ON social_identities (provider, handle);

CREATE TABLE IF NOT EXISTS social_links (
  id text PRIMARY KEY,
  auth_provider text NOT NULL,
  auth_subject text NOT NULL,
  identity_key text NOT NULL,
  linked_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_links_subject_identity_idx ON social_links (auth_provider, auth_subject, identity_key);
CREATE INDEX IF NOT EXISTS social_links_identity_idx ON social_links (identity_key);

CREATE TABLE IF NOT EXISTS social_claims (
  id text PRIMARY KEY,
  identity_key text NOT NULL,
  chain text NOT NULL,
  wallet text NOT NULL,
  vault text NOT NULL,
  auth_provider text NOT NULL,
  auth_subject text NOT NULL,
  nonce text NOT NULL,
  deadline bigint NOT NULL,
  signature text NOT NULL,
  status text NOT NULL DEFAULT 'signed',
  tx_hash text,
  ip text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_claims_identity_idx ON social_claims (identity_key);
CREATE INDEX IF NOT EXISTS social_claims_status_idx ON social_claims (status);
