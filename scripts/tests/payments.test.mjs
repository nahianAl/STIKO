import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newTransactionId,
  isTransactionId,
  isCheckoutSessionId,
  paymentFromInvoice,
  planWithInterval,
  formatAmount,
  successCopy,
} from '../../lib/payments.ts';
import { scrubUrl } from '../../lib/analytics/scrub.ts';

test('transaction IDs are STK- plus three groups of four Crockford characters', () => {
  const id = newTransactionId(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 31, 255, 255]));
  assert.equal(id, 'STK-0123-4567-89AZ');
  assert.ok(isTransactionId(id));
  for (let i = 0; i < 200; i++) assert.ok(isTransactionId(newTransactionId()));
});

test('transaction IDs never use I, L, O or U', () => {
  for (let b = 0; b < 256; b++) {
    const id = newTransactionId(new Uint8Array(12).fill(b));
    assert.doesNotMatch(id.slice(4), /[ILOU]/);
  }
});

test('random transaction IDs do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(newTransactionId());
  assert.equal(seen.size, 5000);
});

test('newTransactionId refuses too few bytes', () => {
  assert.throws(() => newTransactionId(new Uint8Array(4)));
});

test('isTransactionId rejects anything else', () => {
  for (const v of ['', 'STK-0123-4567-89A', 'stk-0123-4567-89AB', 'STK-0123-4567-89AI', 'STK-0123-4567-89AB ', null, 42]) {
    assert.equal(isTransactionId(v), false, String(v));
  }
});

test('isCheckoutSessionId accepts Stripe session IDs only', () => {
  assert.ok(isCheckoutSessionId('cs_live_a1B2c3D4e5F6g7H8'));
  assert.ok(isCheckoutSessionId('cs_test_a1B2c3D4e5F6g7H8'));
  for (const v of ['{CHECKOUT_SESSION_ID}', 'cs_live_', 'cs_live_abc<script>', 'pi_live_a1B2c3D4e5F6', null]) {
    assert.equal(isCheckoutSessionId(v), false, String(v));
  }
});

const SUB = {
  id: 'sub_1',
  items: { data: [{ price: { id: 'price_year', recurring: { interval: 'year' } } }] },
};

function invoice(overrides = {}) {
  return {
    id: 'in_1',
    status: 'paid',
    amount_paid: 21600,
    currency: 'usd',
    customer: 'cus_1',
    number: 'ABC-0001',
    billing_reason: 'subscription_create',
    livemode: true,
    created: 1_700_000_000,
    status_transitions: { paid_at: 1_700_000_100 },
    parent: { subscription_details: { subscription: 'sub_1' } },
    payments: { data: [{ status: 'paid', payment: { payment_intent: 'pi_1' } }] },
    ...overrides,
  };
}

test('a paid invoice becomes a payment linked to customer, subscription and payment', () => {
  assert.deepEqual(paymentFromInvoice(invoice(), SUB), {
    invoiceId: 'in_1',
    invoiceNumber: 'ABC-0001',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    paymentIntentId: 'pi_1',
    priceId: 'price_year',
    interval: 'year',
    billingReason: 'subscription_create',
    amountCents: 21600,
    currency: 'usd',
    livemode: true,
    paidAt: new Date(1_700_000_100 * 1000),
  });
});

test('expanded objects are read by id', () => {
  const p = paymentFromInvoice(
    invoice({
      customer: { id: 'cus_2' },
      parent: { subscription_details: { subscription: { id: 'sub_2' } } },
      payments: { data: [{ status: 'paid', payment: { payment_intent: { id: 'pi_2' } } }] },
    }),
    SUB
  );
  assert.equal(p.customerId, 'cus_2');
  assert.equal(p.subscriptionId, 'sub_2');
  assert.equal(p.paymentIntentId, 'pi_2');
});

test('unpaid, $0 and customerless invoices are not payments', () => {
  assert.equal(paymentFromInvoice(invoice({ status: 'open' }), SUB), null);
  assert.equal(paymentFromInvoice(invoice({ status: 'draft' }), SUB), null);
  assert.equal(paymentFromInvoice(invoice({ amount_paid: 0 }), SUB), null);
  assert.equal(paymentFromInvoice(invoice({ customer: null }), SUB), null);
  assert.equal(paymentFromInvoice(invoice({ id: undefined }), SUB), null);
});

test('missing optional parts degrade to null, not a crash', () => {
  const p = paymentFromInvoice(
    invoice({ payments: undefined, parent: null, status_transitions: undefined, number: null, billing_reason: null }),
    null
  );
  assert.equal(p.paymentIntentId, null);
  assert.equal(p.subscriptionId, null);
  assert.equal(p.priceId, null);
  assert.equal(p.interval, null);
  assert.equal(p.invoiceNumber, null);
  assert.equal(p.paidAt.getTime(), 1_700_000_000 * 1000);
});

test('only a paid invoice payment supplies the payment intent', () => {
  const p = paymentFromInvoice(
    invoice({
      payments: {
        data: [
          { status: 'canceled', payment: { payment_intent: 'pi_failed' } },
          { status: 'paid', payment: { payment_intent: 'pi_ok' } },
        ],
      },
    }),
    SUB
  );
  assert.equal(p.paymentIntentId, 'pi_ok');
});

test('an unknown interval is stored as null', () => {
  const sub = { id: 'sub_1', items: { data: [{ price: { id: 'p', recurring: { interval: 'week' } } }] } };
  assert.equal(paymentFromInvoice(invoice(), sub).interval, null);
});

test('plan labels carry the billing interval', () => {
  assert.equal(planWithInterval('standard', 'year'), 'Standard (Yearly)');
  assert.equal(planWithInterval('standard', 'month'), 'Standard (Monthly)');
  assert.equal(planWithInterval('standard', null), 'Standard');
});

test('amounts are shown in dollars', () => {
  assert.equal(formatAmount(21600, 'usd'), '$216.00');
  assert.equal(formatAmount(2000, 'USD'), '$20.00');
  assert.equal(formatAmount(1234, 'dollars'), '12.34 DOLLARS');
});

const RECEIPT = {
  transactionId: 'STK-0123-4567-89AB',
  plan: 'standard',
  interval: 'year',
  amountCents: 21600,
  currency: 'usd',
  paidAt: '2026-11-21T10:00:00.000Z',
};

test('a recorded payment says so, with the plan and interval', () => {
  assert.deepEqual(successCopy({ receipt: RECEIPT, waiting: false, current: null }), {
    title: 'Payment successful',
    subtitle: "You're now on Standard (Yearly).",
  });
});

test('while waiting, nothing is claimed yet', () => {
  const c = successCopy({ receipt: null, waiting: true, current: null });
  assert.equal(c.title, 'Confirming your payment…');
});

test('no record but a confirmed paid plan still says you are on it', () => {
  const c = successCopy({ receipt: null, waiting: false, current: { plan: 'standard', interval: 'month' } });
  assert.equal(c.title, 'Payment successful');
  assert.match(c.subtitle, /^You're now on Standard \(Monthly\)\./);
});

test('no record and still on Free never claims Standard', () => {
  for (const current of [null, { plan: 'free', interval: null }]) {
    const c = successCopy({ receipt: null, waiting: false, current });
    assert.equal(c.title, 'Payment received');
    assert.doesNotMatch(c.subtitle, /now on/);
  }
});

test('billing step URLs keep their IDs through the analytics scrub', () => {
  assert.equal(
    scrubUrl('https://app.stiko.design/billing/success?txn=STK-0123-4567-89AB&session_id=cs_live_abc123def456&email=a@b.c'),
    'https://app.stiko.design/billing/success?txn=STK-0123-4567-89AB&session_id=cs_live_abc123def456'
  );
  assert.equal(scrubUrl('/billing/checkout?interval=year'), '/billing/checkout?interval=year');
  assert.equal(scrubUrl('/billing/success?flow=switch'), '/billing/success?flow=switch');
});
