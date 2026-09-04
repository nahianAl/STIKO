-- Auth.js managed tables
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  email_verified TIMESTAMPTZ,
  image TEXT,
  password_hash TEXT,
  job_title TEXT,
  company TEXT,
  email_paused_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(identifier, token)
);

-- Application tables
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tag TEXT,
  archived_at TIMESTAMPTZ,
  link_access BOOLEAN NOT NULL DEFAULT FALSE,
  last_version_number INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'uploader')),
  -- Null for a share link, which has no named recipient. See 003-share-links.sql.
  email TEXT,
  -- A share link is not consumed by the first person to accept it.
  multi_use BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'uploader')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(portal_id, user_id)
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  changelog TEXT,
  published_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  file_type TEXT NOT NULL,
  conversion_status TEXT DEFAULT NULL CHECK (conversion_status IN ('pending', 'processing', 'completed', 'failed')),
  converted_storage_key TEXT DEFAULT NULL,
  conversion_job_id TEXT DEFAULT NULL,
  folder_path TEXT DEFAULT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  position_x FLOAT NOT NULL DEFAULT 0,
  position_y FLOAT NOT NULL DEFAULT 0,
  position_z FLOAT NOT NULL DEFAULT 0,
  rotation_x FLOAT NOT NULL DEFAULT 0,
  rotation_y FLOAT NOT NULL DEFAULT 0,
  rotation_z FLOAT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  x_position FLOAT,
  y_position FLOAT,
  -- 3D pin position, in the MODEL's own frame, not the world's — so a pin travels with its
  -- object when someone moves or rotates it. Rows written before object placement existed are
  -- already correct: they were placed at the identity transform, where the frames coincide.
  world_x FLOAT,
  world_y FLOAT,
  world_z FLOAT,
  snapshot_url TEXT,
  attachments JSONB DEFAULT '[]',
  page_number INT DEFAULT NULL,
  timestamp DOUBLE PRECISION DEFAULT NULL,
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Legacy per-object markup persistence. Nothing reads or writes this table today — markup is
-- flattened into a snapshot image instead, and the app/api/markups routes have no callers — so
-- this type list has drifted behind the live one and does not include every object type the
-- editor can create (e.g. 'ellipse', 'cloud'). If per-object persistence is ever revived, bring
-- this CHECK up to date against AnnotationObjectType in components/markup/useAnnotationObjects.ts
-- first.
CREATE TABLE IF NOT EXISTS markups (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('freehand', 'line', 'arrow', 'rect', 'text')),
  data JSONB NOT NULL,
  style JSONB NOT NULL,
  page_number INT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================================================
-- Redesign tables. Mirrored in lib/migrations/001-redesign.sql, which brings an
-- existing database up to this shape. Keep the two in step.
-- ===========================================================================

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

CREATE TABLE IF NOT EXISTS project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'coordinator')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'mention', 'new_version', 'comment_reply', 'new_comment',
    'invite_accepted', 'changes_requested', 'approved'
  )),
  portal_id TEXT REFERENCES portals(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  href TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_prefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  in_app BOOLEAN NOT NULL DEFAULT TRUE,
  email BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, event)
);

CREATE TABLE IF NOT EXISTS portal_mutes (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(portal_id, user_id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS version_views (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(version_id, user_id)
);

-- ===========================================================================
-- AI summaries (2026-08-23). Mirrored in lib/migrations/004-ai-summaries.sql.
-- ===========================================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_summaries_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS version_summaries (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  themes JSONB NOT NULL DEFAULT '[]',
  covered_count INT NOT NULL,
  covered_through TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  covered_through TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_file_created_idx ON comments(file_id, created_at);
CREATE INDEX IF NOT EXISTS files_version_idx ON files(version_id);
