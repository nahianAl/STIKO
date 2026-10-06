-- Who a comment mentions. Mirrored in lib/schema.sql.
--
-- [{ "userId": "...", "name": "Jane Doe" }]. The comment text itself stays
-- plain ("@Jane Doe"), so everything that already reads `content` as text —
-- AI summaries, the Brief, notification excerpts — is untouched. `name` is the
-- label as it was written into the text, so a mention still renders after the
-- person renames themselves or leaves the package.
--
-- Additive and defaulted: every existing row is '[]', nothing to backfill, and
-- code that predates this ignores the column.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]';
