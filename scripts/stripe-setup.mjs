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

async function findOrCreateProduct() {
  const found = await stripe.products.search({ query: `metadata['stiko_product']:'${PRODUCT_KEY}'` });
  if (found.data[0]) {
    console.log(`product   exists   ${found.data[0].id}`);
    return found.data[0];
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

console.log(`Stripe ${mode} mode`);
const product = await findOrCreateProduct();
const prices = [];
for (const spec of PRICES) prices.push(await findOrCreatePrice(product, spec));
await findOrCreatePortal(product, prices);
console.log('done');
