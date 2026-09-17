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
