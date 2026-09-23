-- lib/migrations/015-submission-names.sql
--
-- Submissions can be named (2026-09-22). Mirrored in lib/schema.sql.
--
-- "Submission" is the user-facing word only; the table keeps its name, as
-- portals did when they became packages.
--
-- name: NULL until someone names it. The default ("Submission N") is computed
-- at render time and never stored, so a future wording change needs no
-- backfill and a typed name is never confused with a default.
ALTER TABLE versions ADD COLUMN IF NOT EXISTS name TEXT;

-- renamed_at: exists only so the portal change feed notices a rename. Its
-- versions cursor is a (count, latest stamp) pair, and an in-place rename
-- moves neither half without this. See app/api/portals/[id]/activity/route.ts.
ALTER TABLE versions ADD COLUMN IF NOT EXISTS renamed_at TIMESTAMPTZ;
