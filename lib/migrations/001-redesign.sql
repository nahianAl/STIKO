-- Redesign migration: everything stiko_handoff/ assumes but the schema lacks.
-- Additive only — nothing here drops or rewrites existing data.

-- ---------------------------------------------------------------------------
-- Versions gain a changelog and a publish lifecycle.
-- `01`: a version carries a required "what changed" note.
-- `2e`: Save as draft / Publish version N.
-- ---------------------------------------------------------------------------
ALTER TABLE versions ADD COLUMN IF NOT EXISTS changelog TEXT;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Existing rows predate the draft concept: they are all published, and their
-- publish time is the only timestamp we have.
UPDATE versions SET published_at = created_at WHERE published_at IS NULL;

-- ---------------------------------------------------------------------------
-- Verdicts. `01`: version status is DERIVED from these, never set by hand.
-- One current verdict per (version, user); changing your mind overwrites it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verdicts (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'changes_requested')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(version_id, user_id)
);

CREATE INDEX IF NOT EXISTS verdicts_version_idx ON verdicts(version_id);

-- ---------------------------------------------------------------------------
-- Packages (portals) gain a freeform tag and an archive state.
-- `01`: tag is optional freeform text, colour hashed from the string.
-- `3l`: Archive is reversible and read-only; Delete is not.
-- ---------------------------------------------------------------------------
ALTER TABLE portals ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE portals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE portals ADD COLUMN IF NOT EXISTS link_access BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;

-- ---------------------------------------------------------------------------
-- Two-tier access (`01`). Project members see every package in the project;
-- package guests (the existing `participants` table) see only what they're on.
-- The project owner is implied by projects.owner_id and is not stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'coordinator')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Notifications (`3i`, `3k`). Gap #11 — there is no notification loop at all.
-- `data` carries the deep-link target so a row can open the exact object.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'mention', 'new_version', 'comment_reply', 'new_comment',
    'invite_accepted', 'changes_requested', 'approved'
  )),
  portal_id TEXT REFERENCES portals(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalised so a notification survives deletion of what it describes.
  title TEXT NOT NULL,
  excerpt TEXT,
  href TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications(user_id, created_at DESC);

-- Per-event, per-channel preferences (`3k`). A missing row means the default,
-- so we never have to backfill for existing users.
CREATE TABLE IF NOT EXISTS notification_prefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  in_app BOOLEAN NOT NULL DEFAULT TRUE,
  email BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, event)
);

-- `3k`: pause all email for 24 hours; `3l`: mute a single package.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_paused_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;

CREATE TABLE IF NOT EXISTS portal_mutes (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(portal_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Password reset (`3c`, `3d`). Did not exist — a locked-out account was
-- permanently lost. Single-use, one-hour expiry, per the copy on 3c.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- View tracking. `4b` "Waiting on" distinguishes not-opened / viewed-no-comment
-- / commented, which needs a record of who opened which version and when.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS version_views (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(version_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Invitations: `2h` shows a pending list with resend/revoke, and `04` states a
-- 14-day expiry (the code was issuing 7).
-- ---------------------------------------------------------------------------
ALTER TABLE invite_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE invite_tokens ADD COLUMN IF NOT EXISTS invited_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invite_tokens ADD COLUMN IF NOT EXISTS note TEXT;
