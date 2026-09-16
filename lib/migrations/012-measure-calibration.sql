-- Calibration for the measure tool: how many real millimetres one INTRINSIC unit of a file
-- spans. Mirrored in lib/schema.sql.
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
