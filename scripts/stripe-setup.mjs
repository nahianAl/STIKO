#!/usr/bin/env node
/**
 * Create Stiko's Stripe catalogue: the Standard product, its monthly and
 * yearly prices, and the customer-portal configuration. Safe to re-run — it
 * finds what already exists and only creates what is missing.
 *
 * Run it once per Stripe mode (test, then live). The key decides the mode:
 *
 *   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs
 *
 * Prices are found by lookup key (lib/billing.ts PRICE_LOOKUP_KEYS), so the
 * app needs no price IDs in its environment.
 */

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.includes('_live_') ? 'LIVE' : 'test';

// Keep in step with lib/billing.ts. Duplicated rather than imported so this
// runs with plain node, no TypeScript loader.
const PRODUCT_KEY = 'stiko_standard';
const PRICES = [
  { lookup_key: 'stiko_standard_monthly', unit_amount: 2000, interval: 'month', nickname: 'Standard monthly' },
  { lookup_key: 'stiko_standard_yearly', unit_amount: 21600, interval: 'year', nickname: 'Standard yearly' },
];
const PORTAL_KEY = 'stiko_portal';

// Where Stripe sends events. Pass WEBHOOK_URL to register it; skipped otherwise
// (local testing uses `stripe listen` instead).
const WEBHOOK_URL = process.env.WEBHOOK_URL;
// Keep in step with app/api/billing/webhook/route.ts.
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  // Records each payment (app/api/billing/webhook, migration 021).
  'invoice.paid',
];

async function findOrCreateProduct() {
  // A direct list, not products.search: search is eventually consistent, so a
  // re-run seconds after the first one would not see the product and make a
  // second one.
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.metadata?.stiko_product === PRODUCT_KEY) {
      console.log(`product   exists   ${p.id}`);
      return p;
    }
  }
  const product = await stripe.products.create({
    name: 'Stiko Standard',
    description: '100 GB storage and unlimited projects.',
    metadata: { stiko_product: PRODUCT_KEY },
  });
  console.log(`product   created  ${product.id}`);
  return product;
}

async function findOrCreatePrice(product, spec) {
  const { data } = await stripe.prices.list({ lookup_keys: [spec.lookup_key], limit: 1 });
  if (data[0]) {
    const p = data[0];
    const matches = p.unit_amount === spec.unit_amount && p.currency === 'usd' && p.recurring?.interval === spec.interval;
    console.log(`price     exists   ${p.id} ${spec.lookup_key}${matches ? '' : '  ⚠ amount/interval differ from this script'}`);
    return p;
  }
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: spec.unit_amount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookup_key,
    nickname: spec.nickname,
  });
  console.log(`price     created  ${price.id} ${spec.lookup_key}`);
  return price;
}

async function findOrCreatePortal(product, prices) {
  const { data } = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const existing = data.find((c) => c.metadata?.[PORTAL_KEY]);
  if (existing) {
    console.log(`portal    exists   ${existing.id}`);
    return existing;
  }
  const config = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'Manage your Stiko subscription' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address', 'tax_id'] },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: [{ product: product.id, prices: prices.map((p) => p.id) }],
      },
    },
    metadata: { [PORTAL_KEY]: 'v1' },
  });
  console.log(`portal    created  ${config.id}`);
  return config;
}

async function findOrCreateWebhook() {
  for await (const w of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (w.url === WEBHOOK_URL) {
      console.log(`webhook   exists   ${w.id} ${w.url}`);
      // An endpoint made by an older run of this script lacks the newer
      // events. Adding them keeps the endpoint and its signing secret.
      const missing = WEBHOOK_EVENTS.filter((e) => !w.enabled_events.includes(e) && !w.enabled_events.includes('*'));
      if (missing.length) {
        await stripe.webhookEndpoints.update(w.id, { enabled_events: [...w.enabled_events, ...missing] });
        console.log(`          added events: ${missing.join(', ')}`);
      }
      console.log('          (its signing secret was shown only when it was created —');
      console.log('           find it in the Stripe dashboard under Developers → Webhooks)');
      return;
    }
  }
  const w = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: WEBHOOK_EVENTS,
    description: 'Stiko billing',
  });
  console.log(`webhook   created  ${w.id} ${w.url}`);
  console.log('');
  console.log('  STRIPE_WEBHOOK_SECRET for Vercel (shown once, copy it now):');
  console.log(`  ${w.secret}`);
  console.log('');
}

// Customers must only ever see "Stiko". Ergonic Design Inc. owns the money, but
// its own Stripe account shows "Ergonic" on checkout, receipts and card
// statements, so Stiko runs on a separate account. Refuse the wrong key here,
// before anything is created.
const ERGONIC_ACCOUNT = 'acct_1NJkflBxwRWYUCnP';
const account = await stripe.accounts.retrieve();
const publicName = account.business_profile?.name ?? '(not set)';
const descriptor = account.settings?.payments?.statement_descriptor ?? '(not set)';
console.log(`Stripe ${mode} mode — account ${account.id}`);
console.log(`  customers see:     ${publicName}`);
console.log(`  card statements:   ${descriptor}`);
console.log(`  website:           ${account.business_profile?.url ?? '(not set)'}`);
console.log(`  can take payments: ${account.charges_enabled ? 'yes' : 'NO — finish activation in the dashboard'}`);
console.log('');
if (account.id === ERGONIC_ACCOUNT || /ergonic/i.test(`${publicName} ${descriptor}`)) {
  console.error('STOP: this key belongs to an account customers would see as "Ergonic".');
  console.error('Use the secret key from the Stiko account instead. Nothing was changed.');
  process.exit(1);
}
const product = await findOrCreateProduct();
const prices = [];
for (const spec of PRICES) prices.push(await findOrCreatePrice(product, spec));
await findOrCreatePortal(product, prices);
if (WEBHOOK_URL) await findOrCreateWebhook();
console.log('done');
