-- lib/migrations/019-kyc-analytics.sql
--
-- KYC onboarding + PostHog Phase 1 (2026-11-15). Mirrored in lib/schema.sql.
-- Spec: docs/superpowers/specs/2026-11-15-kyc-and-posthog-design.md
--
-- Additive only, so it is safe to apply before the code that uses it ships.
-- Apply BEFORE the deploy: middleware reads users.profile_completed_at.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pillar TEXT,
  segment_id TEXT,
  business_type_other TEXT,
  client_model TEXT,
  company_size_band TEXT,
  track TEXT,
  country TEXT,
  region TEXT,
  is_business_email BOOLEAN,
  utm_first JSONB,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inviter_workspace_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_business_email BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_consent TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_first JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_last JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS click_ids JSONB;

CREATE TABLE IF NOT EXISTS analytics_outbox (
  id BIGSERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  event TEXT NOT NULL,
  distinct_id TEXT NOT NULL,
  properties JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS analytics_outbox_unsent_idx
  ON analytics_outbox (id) WHERE sent_at IS NULL;
