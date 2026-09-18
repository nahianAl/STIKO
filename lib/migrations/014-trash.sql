-- lib/migrations/014-trash.sql
--
-- Soft deletion for the two container objects (2026-09-18). Mirrored in
-- lib/schema.sql.
--
-- 013 is the last applied migration; 010 is RESERVED for the unimplemented
-- WorkOS work and is deliberately skipped.
--
-- Neither column reuses archived_at. Archive is being retired in this same
-- change, and overloading its column would make a rollback indistinguishable
-- from the feature: we could no longer tell "archived before the trash shipped"
-- apart from "deleted after it".

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE portals  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- SET NULL, not CASCADE, matching files.uploaded_by and versions.created_by:
-- removing a user account must never destroy the record of what they deleted.
-- The card then reads "deleted by someone who has since left", which is true.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by TEXT
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE portals  ADD COLUMN IF NOT EXISTS deleted_by TEXT
  REFERENCES users(id) ON DELETE SET NULL;

-- Was this package deleted on its own, or swept in by its project?
--
-- Restoring a project revives only the packages that say "swept". Without this,
-- a package deliberately deleted on Sep 1 would come back when its project —
-- deleted on Sep 10 — was restored on Sep 15, undoing a decision nobody
-- revisited.
--
-- A boolean rather than a deleted_via_project_id FK: a package's project is
-- already portals.project_id, so a second reference would be redundant and
-- could disagree with the first.
ALTER TABLE portals ADD COLUMN IF NOT EXISTS deleted_with_project BOOLEAN
  NOT NULL DEFAULT FALSE;

-- Partial indexes: trashed rows are a tiny minority, and every query that reads
-- the trash asks for exactly this predicate. A full index would be mostly NULLs.
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at
  ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portals_deleted_at
  ON portals(deleted_at) WHERE deleted_at IS NOT NULL;
