-- When a comment was last edited. Mirrored in lib/schema.sql.
--
-- Exists for the portal's change feed, not for the UI. The feed decides whether
-- an open portal should re-fetch by comparing a (count, latest stamp) pair per
-- entity. An edit moves neither on its own: PUT /api/comments/[id] rewrites
-- content and leaves created_at alone, and the row count is unchanged. So an
-- edit made by one reviewer would stay invisible to every other open tab until
-- something else happened to move the cursor.
--
-- NULL means never edited, which is true of every row that predates this.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;

-- versions(portal_id) for the same change feed. Mirrored in lib/schema.sql.
--
-- The feed's visible_versions CTE filters versions by portal_id on every poll,
-- and this was the only leg of that query without an index: participants is
-- covered by its UNIQUE(portal_id, user_id) btree, files by files_version_idx
-- and comments by comments_file_created_idx. A seq scan per portal per six
-- seconds per open tab is what makes this one worth having, not the one-off
-- reads the column already served.
CREATE INDEX IF NOT EXISTS versions_portal_idx ON versions(portal_id);
