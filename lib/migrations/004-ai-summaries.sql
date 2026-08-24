-- AI summaries (2026-08-23).
--
-- Two caches and a switch.
--
-- Staleness is deliberately NOT a column. A brief records how many comments it
-- covered (`covered_count`) and the newest comment it saw (`covered_through`);
-- whether it is stale is a comparison against a live COUNT at read time. A
-- boolean would need invalidating from every route that writes a comment, and
-- would silently drift the first time one forgot.
--
-- `covered_through` is written from the same query that built the payload, not
-- from a fresh clock. A comment that lands while the model is thinking must not
-- be stamped as covered by a brief that never saw it — because staleness is
-- computed, such a comment would be invisible for good rather than merely late.

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
