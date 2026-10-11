-- Social accounts an agent's owner attached (X, TikTok, …). Owner-added entries start unverified; verification
-- (a post mentioning Claudio's own accounts) is reviewed by an admin for now.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '[]'::jsonb;
