-- lib/migrations/020-kyc-v2.sql
--
-- KYC v2 (2026-11-19): coded answers kept as append-only history. Mirrored in lib/schema.sql.
-- Spec: docs/superpowers/specs/2026-11-19-kyc-v2-design.md §7
--
-- Additive only, so it is safe to apply before the code that uses it ships, and
-- idempotent (every statement can run twice). Old KYC columns are NOT dropped.

CREATE TABLE IF NOT EXISTS company_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  onboarding_version INT NOT NULL,
  source TEXT NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_domain TEXT,
  website_source TEXT,
  industry TEXT,
  industry_other_text TEXT,
  parent_segment TEXT,
  client_model TEXT,
  company_size TEXT,
  size_min INT,
  size_max INT,
  review_team_size TEXT,
  rt_min INT,
  rt_max INT,
  primary_market TEXT,
  market_other_text TEXT,
  file_type_other_text TEXT,
  icp_size_fit BOOLEAN,
  legacy JSONB
);
CREATE INDEX IF NOT EXISTS company_profiles_workspace_idx ON company_profiles (workspace_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS company_profiles_domain_idx ON company_profiles (company_domain) WHERE company_domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS company_profile_markets (
  profile_id TEXT NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL,
  pick_order INT NOT NULL,
  PRIMARY KEY (profile_id, market_code)
);

CREATE TABLE IF NOT EXISTS company_profile_reviewers (
  profile_id TEXT NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  reviewer_code TEXT NOT NULL,
  PRIMARY KEY (profile_id, reviewer_code)
);

CREATE TABLE IF NOT EXISTS company_profile_file_types (
  profile_id TEXT NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  file_type_code TEXT NOT NULL,
  supported_at_signup BOOLEAN NOT NULL,
  PRIMARY KEY (profile_id, file_type_code)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  onboarding_version INT NOT NULL,
  source TEXT NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  role_code TEXT,
  role_other_text TEXT,
  role_family TEXT,
  seniority TEXT,
  decision_maker BOOLEAN,
  non_buyer BOOLEAN
);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id, answered_at DESC);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS current_profile_id TEXT REFERENCES company_profiles(id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS company_domain TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_version INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_region TEXT;

-- Backfill: v1 answers become history rows (spec §7). current_profile_id is NOT
-- pointed at them, so everyone is asked the v2 questions.
INSERT INTO company_profiles (id, workspace_id, submitted_by_user_id, onboarding_version, source, answered_at, legacy)
SELECT 'v1-' || w.id, w.id, w.owner_user_id, 1, 'migrated_v1',
       COALESCE(u.profile_completed_at, w.created_at),
       jsonb_build_object(
         'pillar', w.pillar, 'segment_id', w.segment_id, 'business_type_other', w.business_type_other,
         'client_model', w.client_model, 'company_size_band', w.company_size_band, 'track', w.track
       )
FROM workspaces w JOIN users u ON u.id = w.owner_user_id
WHERE w.pillar IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (id, user_id, onboarding_version, source, answered_at, role_code)
SELECT 'v1-' || u.id, u.id, 1, 'migrated_v1', COALESCE(u.profile_completed_at, u.created_at, now()), u.role
FROM users u
WHERE u.role IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE users SET signup_type = CASE signup_source WHEN 'reviewer_invite' THEN 'invited_reviewer' ELSE 'new_workspace' END
WHERE signup_type IS NULL AND signup_source IS NOT NULL;

UPDATE users u SET invited_by_user_id = t.invited_by
FROM invite_tokens t
WHERE u.invite_id = t.id AND u.invited_by_user_id IS NULL AND t.invited_by IS NOT NULL;
