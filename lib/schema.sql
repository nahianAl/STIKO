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

-- The column above is only created on a FRESH database. scripts/migrate.mjs applies
-- this file before any migration, so on an existing database the CREATE TABLE above
-- is a no-op and a column listed only in it would never land. Mirrored in
-- lib/migrations/011-plans.sql — same pattern already used for ai_summaries_enabled
-- further down this file.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

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
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tag TEXT,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_with_project BOOLEAN NOT NULL DEFAULT FALSE,
  link_access BOOLEAN NOT NULL DEFAULT FALSE,
  last_version_number INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'uploader')),
  all_versions BOOLEAN NOT NULL DEFAULT TRUE,
  can_download BOOLEAN NOT NULL DEFAULT FALSE,
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
  all_versions BOOLEAN NOT NULL DEFAULT TRUE,
  can_download BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS participant_versions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(participant_id, version_id)
);

CREATE TABLE IF NOT EXISTS invite_token_versions (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES invite_tokens(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(token_id, version_id)
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Set by PUT /api/comments/[id]. Read by the portal's change feed, which
  -- cannot otherwise see an edit: an edit leaves created_at untouched and the
  -- row count unchanged. See lib/migrations/013-comment-edits.sql.
  edited_at TIMESTAMPTZ DEFAULT NULL
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

-- Per-part colours for a 3D model, saved on the file so everyone opening the
-- package sees the same thing. Mirrored in lib/migrations/009-part-colors.sql.
--
-- A table rather than a JSONB column on files, specifically so two reviewers
-- colouring different parts of the same model cannot clobber one another's
-- writes. Rows are sparse: only deliberate overrides land here, because the
-- automatic colouring is a deterministic function of the part tree and needs
-- no storage.
--
-- part_key is an index path into the model's node hierarchy ("0/2/1"), stable
-- only because an uploaded file's bytes never change. Re-optimizing a stored
-- file would renumber every part and silently reassign every colour here.
--
-- This also holds for a file whose converted_storage_key changes after the fact — a STEP
-- upload whose client-side tessellation failed is coloured against the STEPLoader/stepToGlb
-- tree, and a later CloudConvert conversion replaces it with an unrelated tree under the
-- same file id. Every place that assigns converted_storage_key must attempt to delete this
-- file's part_colors rows immediately alongside it — NOT necessarily in the same transaction;
-- see the deletion (and its own comment, and why it tolerates its own failure) beside the
-- UPDATE in app/api/conversions/webhook/route.ts.
CREATE TABLE IF NOT EXISTS part_colors (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  part_key TEXT NOT NULL,
  color TEXT NOT NULL,
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id, part_key)
);

CREATE INDEX IF NOT EXISTS part_colors_file_id_idx ON part_colors(file_id);

-- Calibration for the measure tool: how many real millimetres one INTRINSIC unit of a file
-- spans. Mirrored in lib/migrations/012-measure-calibration.sql.
--
-- "Intrinsic unit" is per surface, and each definition is a trap if got wrong:
--   image — one NATURAL pixel of the source image. Not displayed px, not snapshot px: both
--           change with zoom and viewport, so a calibration stored in either is wrong the next
--           time the file is opened.
--   pdf   — one PDF point (1/72"). The viewer renders pages at PDF_RENDER_SCALE (2), so page
--           coordinates are twice the points; dividing by that scale before storing is what
--           keeps every PDF calibration from being exactly 2x wrong.
--   3D    — one world unit of the LOADED GLB, i.e. converted_storage_key when one exists.
--
-- Rows are per PAGE, not just per file: a multi-sheet PDF genuinely mixes scales, e.g. a 1:50
-- plan and a 1:20 detail in one document.
--
-- page_number is NOT NULL DEFAULT 0 rather than nullable, and that is load-bearing. Postgres
-- treats NULLs as DISTINCT inside a UNIQUE constraint, so a nullable column would silently
-- permit duplicate calibration rows for the same image, and whichever row the read happened to
-- order first would win. 0 means "this file has no pages".
--
-- A 3D calibration is anchored to the loaded GLB's scale. Every place that assigns
-- converted_storage_key must therefore delete this file's rows alongside it — the same
-- obligation part_colors carries, for the same reason. See the DELETE in
-- app/api/conversions/webhook/route.ts and its comment on why it tolerates its own failure.
CREATE TABLE IF NOT EXISTS file_calibrations (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page_number INT NOT NULL DEFAULT 0,
  mm_per_unit DOUBLE PRECISION NOT NULL CHECK (mm_per_unit > 0),
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (file_id, page_number)
);

CREATE INDEX IF NOT EXISTS file_calibrations_file_id_idx ON file_calibrations(file_id);

-- Which unit measurements are READ in. File-scoped and single-valued, so a column rather than a
-- third table. NULL means nobody has chosen, and the client falls back to millimetres.
ALTER TABLE files ADD COLUMN IF NOT EXISTS measure_unit TEXT DEFAULT NULL;

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
-- The portal change feed re-filters versions by portal_id every six seconds per
-- open tab; without this it seq-scans. Added in 013-comment-edits.sql.
CREATE INDEX IF NOT EXISTS versions_portal_idx ON versions(portal_id);
