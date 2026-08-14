-- Share links (2026-08-14).
--
-- "Share a link" existed in the UI but had never worked: it posted an empty
-- email to the invite endpoint, which rejected it, and the column would not
-- have accepted the row anyway. A share link is an invitation with two
-- properties an email invite does not have:
--
--   * no named recipient — there is nobody to address it to, so `email` has to
--     be nullable. Every read of it already has to cope with a person who was
--     invited but has not signed up, so null is a small step further.
--   * more than one person may accept it. Acceptance stamps `used_at`, and
--     every "still pending" query filters on `used_at IS NULL`, so without a
--     separate flag the first person through the door would burn the link for
--     everyone behind them.
--
-- Expiry and revocation are deliberately NOT special-cased: a share link uses
-- the same 14-day `expires_at` and the same `revoked_at` as an email invite.

ALTER TABLE invite_tokens ALTER COLUMN email DROP NOT NULL;

ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS multi_use BOOLEAN NOT NULL DEFAULT FALSE;
