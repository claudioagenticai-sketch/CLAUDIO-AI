-- Platform switches, the $CLAUDIO spl_config row, launch attribution and the Solana fee collector.
-- Owner: server/platform (numbers 100–199). Mirrored in shared/schema-platform.ts. Runs once, as one transaction.

-- ─── Chain / launchpad switches ─────────────────────────────────────
-- Seeds use ON CONFLICT DO NOTHING so later admin edits are never overwritten. What actually applies is the
-- stricter of this state and what the code can do (server/platform/switches.ts).
CREATE TABLE IF NOT EXISTS chain_status (
  chain text PRIMARY KEY,
  state text NOT NULL DEFAULT 'coming_soon' CHECK (state IN ('open', 'view_only', 'coming_soon')),
  note text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO chain_status (chain, state, note) VALUES
  ('sol', 'open', NULL),
  ('hood', 'coming_soon', 'Robinhood Chain launches are coming soon'),
  ('bsc', 'coming_soon', 'BNB Chain launches are coming soon'),
  ('base', 'coming_soon', 'Base launches are coming soon'),
  ('arc', 'coming_soon', 'Arc launches are coming soon')
ON CONFLICT (chain) DO NOTHING;

CREATE TABLE IF NOT EXISTS launchpad_status (
  launchpad text NOT NULL,
  chain text NOT NULL,
  state text NOT NULL DEFAULT 'coming_soon' CHECK (state IN ('open', 'coming_soon', 'hidden')),
  allow_agents boolean NOT NULL DEFAULT false,
  note text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (launchpad, chain)
);
INSERT INTO launchpad_status (launchpad, chain, state, allow_agents, note) VALUES
  ('pump', 'sol', 'open', true, NULL),
  ('pons', 'hood', 'coming_soon', false, 'Coming soon'),
  ('pools', 'hood', 'coming_soon', false, 'Coming soon'),
  ('flap', 'bsc', 'coming_soon', false, 'Coming soon'),
  ('flap', 'hood', 'coming_soon', false, 'Coming soon'),
  ('bags', 'sol', 'coming_soon', false, 'Coming soon'),
  ('bags', 'hood', 'coming_soon', false, 'Coming soon'),
  ('clanker', 'hood', 'coming_soon', false, 'Coming soon'),
  ('clanker', 'base', 'coming_soon', false, 'Coming soon'),
  ('trench', 'hood', 'coming_soon', false, 'Coming soon'),
  ('dyor', 'hood', 'coming_soon', false, 'Coming soon'),
  ('bonk', 'sol', 'coming_soon', false, 'Coming soon'),
  ('heaven', 'sol', 'coming_soon', false, 'Coming soon'),
  ('stonkfun', 'sol', 'hidden', false, 'Custodial fee forwarding: the creator/platform split can''t be locked'),
  ('four', 'bsc', 'coming_soon', false, 'Coming soon'),
  ('genius', 'bsc', 'coming_soon', false, 'Coming soon'),
  ('argus', 'arc', 'coming_soon', false, 'Coming soon')
ON CONFLICT (launchpad, chain) DO NOTHING;

-- ─── spl_config: exactly one row, the official $CLAUDIO token ───────
-- A production database may already hold a hand-made spl_config (unknown columns, several rows). If it lacks the
-- expected columns it is kept, renamed to spl_config_legacy (or spl_config_legacy_<epoch> if that name is taken).
DO $$
DECLARE
  have int;
  legacy text := 'spl_config_legacy';
BEGIN
  IF to_regclass('public.spl_config') IS NOT NULL THEN
    SELECT count(*) INTO have FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'spl_config'
       AND column_name IN ('key', 'chain', 'mint', 'symbol', 'name', 'decimals');
    IF have < 6 THEN
      IF to_regclass('public.spl_config_legacy') IS NOT NULL THEN
        legacy := 'spl_config_legacy_' || floor(extract(epoch FROM now()))::bigint;
      END IF;
      EXECUTE format('ALTER TABLE public.spl_config RENAME TO %I', legacy);
      RAISE NOTICE 'spl_config without the expected columns renamed to %', legacy;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS spl_config (
  key text PRIMARY KEY,
  chain text NOT NULL DEFAULT 'solana',
  mint text NOT NULL,
  symbol text NOT NULL,
  name text NOT NULL,
  decimals integer NOT NULL DEFAULT 6,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE spl_config ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE spl_config ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Exactly one row: drop every other key (and duplicate 'claudio' rows of a table without a primary key).
DELETE FROM spl_config WHERE key IS DISTINCT FROM 'claudio';
DELETE FROM spl_config a USING spl_config b WHERE a.key = 'claudio' AND b.key = 'claudio' AND a.ctid < b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS spl_config_key_uidx ON spl_config (key);
DO $$
BEGIN
  ALTER TABLE spl_config ADD CONSTRAINT spl_config_single_row CHECK (key = 'claudio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
INSERT INTO spl_config (key, chain, mint, symbol, name, decimals, updated_by, updated_at)
VALUES ('claudio', 'solana', '2j5SaS7xy776qCBpyPQbZjyQSAtKiFgrwjfErthnW2ZM', 'CLAUDIO', 'Claudio', 6, 'migration:100', now())
ON CONFLICT (key) DO UPDATE SET chain = EXCLUDED.chain, mint = EXCLUDED.mint, symbol = EXCLUDED.symbol,
  name = EXCLUDED.name, decimals = EXCLUDED.decimals, updated_by = EXCLUDED.updated_by, updated_at = now();

-- ─── Launch attribution ─────────────────────────────────────────────
ALTER TABLE launches ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS launched_by text DEFAULT 'human';
-- { creator: { address, bps, kind: "wallet" | "agent", agentSlug? }, platform: { address, bps } }
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fee_route jsonb;
CREATE INDEX IF NOT EXISTS launches_agent_idx ON launches (agent_id);
CREATE INDEX IF NOT EXISTS launches_status_idx ON launches (status, chain);

-- ─── Solana fee collector ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collector_runs (
  id text PRIMARY KEY,
  trigger text NOT NULL DEFAULT 'timer',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  coins_checked integer NOT NULL DEFAULT 0,
  distributed integer NOT NULL DEFAULT 0,
  paid_lamports bigint NOT NULL DEFAULT 0,
  txs jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  dry_run boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS collector_runs_started_idx ON collector_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS collector_payouts (
  id bigserial PRIMARY KEY,
  run_id text,
  launch_id text,
  token_key text NOT NULL,
  tx text NOT NULL,
  amount_lamports bigint NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS collector_payouts_tx_token_uidx ON collector_payouts (tx, token_key);
CREATE INDEX IF NOT EXISTS collector_payouts_token_idx ON collector_payouts (token_key, at DESC);
CREATE INDEX IF NOT EXISTS collector_payouts_at_idx ON collector_payouts (at DESC);
