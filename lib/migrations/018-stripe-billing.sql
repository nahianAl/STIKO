-- lib/migrations/018-stripe-billing.sql
--
-- Stripe billing (2026-10-27). Mirrored in lib/schema.sql.
--
-- Stripe is the source of truth for who is paying; these columns are Stiko's
-- copy, kept in sync by app/api/billing/webhook and app/api/billing/return.
-- users.plan (migration 011) is still what every page reads.
--
-- Additive only, so it is safe to apply before the code that uses it ships.
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_key
  ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
