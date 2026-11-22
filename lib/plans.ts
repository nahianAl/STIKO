/**
 * Subscription tiers and their limits.
 *
 * This is the single source of truth for what a tier is called and what it
 * allows. There is deliberately no CHECK constraint on users.plan in the
 * database: the catalogue lives here, and a CHECK would force a migration
 * every time a tier is added or renamed. planFor() is the cost of that —
 * anything unrecognised degrades to Free and warns.
 *
 * The limits are ENFORCED server-side by lib/planGate.ts (rules in
 * lib/planLimits.ts), but only while billing is on: with the kill switch
 * thrown nobody could pay to lift one, so they are displayed, not applied.
 * Enforcement refuses new projects, new packages and new bytes; it never removes anything,
 * so an account can still legitimately sit over either limit (hand-granted
 * changes, usage from before enforcement, a downgrade).
 */

export type PlanId = 'free' | 'standard';

export interface Plan {
  id: PlanId;
  label: string;
  storageBytes: number;
  /** null means unlimited — render a count, not a bar. */
  maxProjects: number | null;
  /**
   * Live packages one project may hold, counted per project (not per account).
   * null means unlimited. Charged to the project OWNER's plan, like the rest.
   */
  maxPackagesPerProject: number | null;
}

const GIB = 1024 ** 3;

// Frozen at both levels: nothing mutates these today, but a future
// `usage.plan.label = …` on a getAccountUsage() result (Plan objects here are
// handed out by reference, not cloned) would otherwise corrupt the catalogue
// for every later request in this server process. Object.freeze() is
// runtime-only — it doesn't change the exported Plan/PlanId types — so this
// is a footgun-removal, not an API change.
export const PLANS: Record<PlanId, Plan> = Object.freeze({
  free: Object.freeze({
    id: 'free',
    label: 'Free',
    storageBytes: 2 * GIB,
    maxProjects: 2,
    maxPackagesPerProject: 2,
  }),
  standard: Object.freeze({
    id: 'standard',
    label: 'Standard',
    storageBytes: 100 * GIB,
    maxProjects: null,
    maxPackagesPerProject: null,
  }),
});

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
