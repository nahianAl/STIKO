-- Whether this person may download files from the package, decided by the
-- owner when inviting them and changeable afterwards.
--
-- Default FALSE takes nothing away: there is no download feature before this,
-- so no existing participant loses an ability they had.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS can_download BOOLEAN NOT NULL DEFAULT FALSE;

-- The same flag on the invitation, because the owner decides when inviting and
-- acceptance may happen days later.
ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS can_download BOOLEAN NOT NULL DEFAULT FALSE;
