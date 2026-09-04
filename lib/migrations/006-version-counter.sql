-- The highest version number ever issued for this package, which is not the
-- same as the highest that still exists. Deriving the next number from
-- MAX(versions.version_number) handed the number back when the newest version
-- was deleted, so a new version could inherit the identity of a deleted one --
-- and with it every email, notification and verdict that named it.
ALTER TABLE portals
  ADD COLUMN IF NOT EXISTS last_version_number INT NOT NULL DEFAULT 0;

-- Existing packages start from whatever they have reached. Deleted trailing
-- versions in the past are not recoverable here, so this is a floor, not a
-- perfect history.
UPDATE portals SET last_version_number = COALESCE(
  (SELECT MAX(v.version_number) FROM versions v WHERE v.portal_id = portals.id), 0
) WHERE last_version_number = 0;
