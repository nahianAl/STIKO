import 'server-only';
import Stripe from 'stripe';
import { sql } from '@/lib/db';
import { planFor, type PlanId } from '@/lib/plans';
import {
  PRICE_LOOKUP_KEYS,
  decideBillingUpdate,
  summarizeSubscription,
  type BillingInterval,
  type SubscriptionFacts,
} from '@/lib/billing';
import { track } from '@/lib/analytics/server';
import { billingTransitionEvents } from '@/lib/analytics/events';

/**
 * Server-side Stripe access. Everything that talks to Stripe or writes the
 * billing columns on users lives here; the pure rules are in lib/billing.ts.
 */

let client: Stripe | null = null;

/** Created lazily: the module is imported at build time, when no key exists. */
export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  client = new Stripe(key, { appInfo: { name: 'Stiko' } });
  return client;
}

/** Marks the portal configuration scripts/stripe-setup.mjs creates. */
export const PORTAL_CONFIG_METADATA_KEY = 'stiko_portal';

const priceCache = new Map<BillingInterval, string>();

/** The Stripe Price ID for an interval, found by lookup key. */
export async function priceIdFor(interval: BillingInterval): Promise<string> {
  const cached = priceCache.get(interval);
  if (cached) return cached;
  const lookupKey = PRICE_LOOKUP_KEYS[interval];
  const { data } = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = data[0];
  if (!price) {
    throw new Error(
      `No active Stripe price with lookup key "${lookupKey}". Run scripts/stripe-setup.mjs for this Stripe mode.`
    );
  }
  priceCache.set(interval, price.id);
  return price.id;
}

let portalConfigId: string | null | undefined;

/**
 * The customer-portal configuration made by scripts/stripe-setup.mjs, or
 * undefined to fall back to the account's default one.
 */
export async function portalConfigurationId(): Promise<string | undefined> {
  if (portalConfigId !== undefined) return portalConfigId ?? undefined;
  const { data } = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
  const ours = data.find((c) => c.metadata?.[PORTAL_CONFIG_METADATA_KEY]);
  portalConfigId = ours?.id ?? null;
  return ours?.id;
}

export interface UserBillingRow {
  id: string;
  email: string | null;
  name: string | null;
  plan: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
}

export async function getUserBilling(userId: string): Promise<UserBillingRow | null> {
  const rows = await sql`
    SELECT id, email, name, plan,
           stripe_customer_id AS "stripeCustomerId",
           stripe_subscription_id AS "stripeSubscriptionId",
           stripe_subscription_status AS "stripeSubscriptionStatus"
    FROM users WHERE id = ${userId}
  `;
  return (rows[0] as UserBillingRow | undefined) ?? null;
}

/**
 * Just the plan. Reads only users.plan, which predates the billing columns, so
 * it still works when migration 018 is missing; undefined if there is no such user.
 */
export async function getUserPlanId(userId: string): Promise<PlanId | undefined> {
  const rows = await sql`SELECT plan FROM users WHERE id = ${userId}`;
  const row = rows[0] as { plan: string } | undefined;
  return row ? planFor(row.plan).id : undefined;
}

/**
 * The user's Stripe customer, created on first need.
 *
 * The idempotency key stops a double-click creating two customers in Stripe,
 * and the conditional UPDATE stops two requests both writing one: whichever
 * lands second reads back the winner's ID.
 */
export async function ensureCustomer(user: UserBillingRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe().customers.create(
    {
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      metadata: { stiko_user_id: user.id },
    },
    { idempotencyKey: `stiko-customer-${user.id}` }
  );

  const updated = await sql`
    UPDATE users SET stripe_customer_id = ${customer.id}
    WHERE id = ${user.id} AND stripe_customer_id IS NULL
    RETURNING stripe_customer_id AS "stripeCustomerId"
  `;
  if (updated[0]) return customer.id;

  const again = await getUserBilling(user.id);
  if (!again?.stripeCustomerId) throw new Error(`Could not record a Stripe customer for ${user.id}`);
  return again.stripeCustomerId;
}

/**
 * Bring users.plan in line with a subscription, fetched fresh from Stripe.
 *
 * The user is found by Stripe customer ID. `fallbackUserId` (from checkout's
 * client_reference_id or the subscription's metadata) links a customer to a
 * user that has none recorded yet — it never re-points an existing link.
 */
export async function syncSubscription(
  subscriptionId: string,
  fallbackUserId?: string | null
): Promise<void> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  let rows = await sql`
    SELECT id, stripe_subscription_id AS "subscriptionId"
    FROM users WHERE stripe_customer_id = ${customerId}
  `;

  const linkUserId = fallbackUserId ?? sub.metadata?.stiko_user_id ?? null;
  if (!rows[0] && linkUserId) {
    rows = await sql`
      UPDATE users SET stripe_customer_id = ${customerId}
      WHERE id = ${linkUserId} AND stripe_customer_id IS NULL
      RETURNING id, stripe_subscription_id AS "subscriptionId"
    `;
  }

  const user = rows[0] as { id: string; subscriptionId: string | null } | undefined;
  if (!user) {
    // Not an error worth a retry storm: a customer made by hand in the Stripe
    // dashboard, say. Logged so it can be found.
    console.warn(`[stripe] no Stiko user for customer ${customerId} (subscription ${sub.id})`);
    return;
  }

  const decision = decideBillingUpdate({ subscriptionId: user.subscriptionId }, sub);
  if (decision.kind === 'ignore') {
    console.info(`[stripe] ignored for user ${user.id}: ${decision.reason}`);
    return;
  }

  // The status this account had immediately BEFORE the write, read by the write
  // itself. One checkout is synced several times at once (the return redirect,
  // checkout.session.completed, customer.subscription.created and .updated), so a
  // status read earlier would be the same stale value for every one of them and
  // each would announce the same subscription_started. FOR UPDATE queues the
  // later statements behind the first, and they read the status it just wrote.
  const written = await sql`
    UPDATE users u
    SET plan = ${decision.plan},
        stripe_subscription_id = ${decision.subscriptionId},
        stripe_subscription_status = ${decision.status}
    FROM (
      SELECT id, stripe_subscription_status AS status
      FROM users WHERE id = ${user.id} FOR UPDATE
    ) prev
    WHERE u.id = prev.id
    RETURNING prev.status AS "prevStatus"
  `;

  // Funnel events fire only on ENTERING a status, from Stripe's own state and
  // never the browser (see billingTransitionEvents).
  if (written[0]) {
    for (const event of billingTransitionEvents(
      (written[0].prevStatus as string | null) ?? null,
      decision.status
    )) {
      const price = sub.items?.data?.[0]?.price;
      await track(event, {
        userId: user.id,
        properties: {
          plan: decision.plan,
          interval: price?.recurring?.interval ?? null,
          amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
          currency: price?.currency ?? null,
          stripe_subscription_id: sub.id,
        },
        set: { plan: decision.plan, subscription_status: decision.status },
      });
    }
  }
  console.info(`[stripe] user ${user.id} → ${decision.plan} (${sub.id} ${sub.status})`);
}

/** Longest the Plan & billing page waits on Stripe before showing the page without renewal facts. */
const SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 3000;

/**
 * Renewal facts for the Plan & billing page, read live from Stripe.
 *
 * Bounded on purpose: no retries and a short timeout, because the caller
 * treats failure as "no renewal line" and a slow Stripe must not hold the
 * page. The mapping itself (period end on the item, cancel flags) is the pure
 * summarizeSubscription in lib/billing.ts.
 */
export async function subscriptionSummary(subscriptionId: string): Promise<SubscriptionFacts> {
  const sub = await stripe().subscriptions.retrieve(
    subscriptionId,
    {},
    { timeout: SUBSCRIPTION_LOOKUP_TIMEOUT_MS, maxNetworkRetries: 0 }
  );
  return summarizeSubscription(sub);
}
