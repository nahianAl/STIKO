-- lib/migrations/021-payments.sql
--
-- Payment records (2026-11-21). Mirrored in lib/schema.sql.
--
-- One row per successful payment: every paid Stripe invoice with money in it
-- (the first charge, each renewal, the charge for switching to yearly). `id` is
-- Stiko's own transaction ID (STK-XXXX-XXXX-XXXX, lib/payments.ts); the Stripe
-- IDs beside it join the row to the customer, subscription, invoice, payment
-- and the Checkout Session that started it. The same ID is written onto the
-- Stripe invoice as metadata.stiko_transaction_id, so it can be looked up from
-- either side.
--
-- Written by app/api/billing/return (on the way back from Stripe) and the
-- invoice.paid webhook, whichever lands first; stripe_invoice_id is UNIQUE so
-- the second is a no-op.
--
-- Rows are financial records and outlive the account: deleting a user only
-- clears user_id, and stripe_customer_id still identifies who paid.
--
-- Additive only, so it is safe to apply before the code that uses it ships, and
-- idempotent (every statement can run twice).
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  stripe_invoice_number TEXT,
  stripe_subscription_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_price_id TEXT,
  plan TEXT NOT NULL,
  billing_interval TEXT,
  billing_reason TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_id_paid_at_idx ON payments (user_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS payments_stripe_customer_id_idx ON payments (stripe_customer_id);
CREATE INDEX IF NOT EXISTS payments_checkout_session_idx
  ON payments (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
