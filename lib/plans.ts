/**
 * Subscription tiers and their limits.
 *
 * This is the single source of truth for what a tier is called and what it
 * allows. There is deliberately no CHECK constraint on users.plan in the
 * database: the catalogue lives here, and a CHECK would force a migration
 * every time a tier is added or renamed. planFor() is the cost of that —
 * anything unrecognised degrades to Free and warns.
 *
 * Nothing in the product ENFORCES these limits. They are displayed, not
 * applied, so an account can legitimately sit over either one.
 */

export type PlanId = 'free' | 'standard';

export interface Plan {
  id: PlanId;
  label: string;
  storageBytes: number;
  /** null means unlimited — render a count, not a bar. */
  maxProjects: number | null;
}

const GIB = 1024 ** 3;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    storageBytes: 2 * GIB,
    maxProjects: 2,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    storageBytes: 100 * GIB,
    maxProjects: null,
  },
};

export const DEFAULT_PLAN_ID: PlanId = 'free';

/** Always returns a valid plan. Unknown, null or malformed resolves to Free. */
export function planFor(value: string | null | undefined): Plan {
  if (value && Object.prototype.hasOwnProperty.call(PLANS, value)) {
    return PLANS[value as PlanId];
  }
  if (value) {
    // The only trace a mistyped UPDATE leaves. Without it the account silently
    // sits on Free limits and nobody can tell why.
    console.warn(`[plans] unknown plan ${JSON.stringify(value)}, using Free`);
  }
  return PLANS[DEFAULT_PLAN_ID];
}

/**
 * Fraction of a limit consumed, clamped to 0–1.
 *
 * Returns null for an unlimited limit, which callers read as "draw no bar".
 */
export function usageFraction(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (!Number.isFinite(used) || used <= 0) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return 1;
  return Math.min(1, used / limit);
}
