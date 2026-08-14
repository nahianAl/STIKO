-- Object placement in the 3D viewer.
--
-- Additive only. Every existing file defaults to the identity transform, which is
-- also what makes reinterpreting comments.world_x/y/z from world space to model
-- space safe with no data migration: at identity the two frames are the same.
--
-- rotation_* are Euler angles in RADIANS, applied in three.js's default XYZ order.
-- A reader that assumes a different order will corrupt orientation in a way that
-- looks like a bad model rather than a bug.
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_x FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_y FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS position_z FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS rotation_x FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS rotation_y FLOAT NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN IF NOT EXISTS rotation_z FLOAT NOT NULL DEFAULT 0;
