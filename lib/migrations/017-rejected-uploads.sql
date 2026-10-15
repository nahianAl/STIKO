-- lib/migrations/017-rejected-uploads.sql
--
-- Counts of files the drop zone refused, by extension (2026-10-15). Mirrored in
-- lib/schema.sql. Extensions only, never filenames: this measures demand for formats
-- stiko cannot open, nothing more. Read it in the Neon console:
--   SELECT * FROM rejected_uploads ORDER BY count DESC;
CREATE TABLE IF NOT EXISTS rejected_uploads (
  extension TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL
);
