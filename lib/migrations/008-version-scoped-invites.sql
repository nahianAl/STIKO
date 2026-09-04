-- TRUE means every version, including ones published later — today's
-- behaviour. Defaulting to TRUE means no existing participant loses access
-- and no backfill is needed. FALSE means the join rows are the whole scope.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS all_versions BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS all_versions BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS participant_versions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(participant_id, version_id)
);

-- The scope lives on the invitation too: the owner chooses it when inviting,
-- and acceptance may be days later.
CREATE TABLE IF NOT EXISTS invite_token_versions (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES invite_tokens(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(token_id, version_id)
);

-- Every authorized request resolves a scope, so this lookup is hot.
CREATE INDEX IF NOT EXISTS idx_participant_versions_participant
  ON participant_versions(participant_id);
