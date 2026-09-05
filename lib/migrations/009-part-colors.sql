-- Per-part colours for a 3D model, saved on the file so everyone opening the
-- package sees the same thing.
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
