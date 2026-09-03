-- Who uploaded each file. Needed so an uploader can delete their own mistake
-- before anyone sees it; versions already track created_by, files did not.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- SET NULL, not CASCADE: removing a user account must never destroy the files
-- they uploaded. Matches versions.created_by.

-- Existing rows are credited to whoever created their version. A guess, but the
-- only one available, and bounded: the uploader's delete window closes at
-- publish, so this can only matter for files in currently-open drafts.
UPDATE files SET uploaded_by = (
  SELECT v.created_by FROM versions v WHERE v.id = files.version_id
) WHERE uploaded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
