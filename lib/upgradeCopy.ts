/**
 * What the upgrade dialog says, as pure text.
 *
 * Kept out of the component so node --test can import it: relative imports
 * only (no `@/` alias), and the payload type is type-only.
 */
import { formatBytes } from './design.ts';
import { PLANS } from './plans.ts';
import type { Plan, PlanId } from './plans.ts';
import { TRASH_RETENTION_DAYS } from './trash.ts';
import type { PlanLimitPayload } from './planLimits.ts';
import type { AccountUsage } from './queries.ts';

/** The Standard pitch, derived from the catalogue so it cannot drift from it. */
export function standardPerks(): string {
  return `Standard gives you ${formatBytes(
    PLANS.standard.storageBytes
  )}, unlimited projects and unlimited packages in each.`;
}

/** The owner's plan as the 402 named it, or null when it did not (or named nothing known). */
function refusedPlan(p: PlanLimitPayload): Plan | null {
  const id = (p as { plan?: unknown }).plan;
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PLANS, id)
    ? PLANS[id as keyof typeof PLANS]
    : null;
}

/**
 * Whether the dialog may show the Monthly/Yearly buttons.
 *
 * Only a Free OWNER can be helped by paying. Standard's storage is capped too,
 * and a Standard owner sent to Checkout would pay for the plan they already
 * have and still be refused. A payload that does not say its plan offers no
 * checkout either: a wrong "no" costs a click on See plans, a wrong "yes" costs
 * someone $20.
 */
export function offersCheckout(p: PlanLimitPayload | null): boolean {
  if (!p) return true;
  return p.isOwner && refusedPlan(p)?.id === 'free';
}

export function headline(p: PlanLimitPayload | null): { title: string; subtitle: string } {
  const perks = standardPerks();
  if (!p) return { title: 'Upgrade to Standard', subtitle: perks };
  const plan = refusedPlan(p);
  const isFree = plan?.id === 'free';

  if (!p.isOwner) {
    const title =
      p.limit === 'storage' ? 'This project is out of storage' : 'This project is at its limit';
    if (p.limit === 'packages') {
      return {
        title,
        subtitle: isFree
          ? `This project's owner is on the Free plan, which allows ${p.max} packages per project. Ask them to upgrade to Standard.`
          : 'This project has reached its package limit.',
      };
    }
    // The plan is named only when the payload says it; otherwise the owner's
    // plan is not something this copy knows.
    if (isFree) {
      return {
        title,
        subtitle:
          p.limit === 'storage'
            ? "This project's owner is on the Free plan and has used its storage. Ask them to upgrade to Standard."
            : "This project's owner is on the Free plan and has used its projects. Ask them to upgrade to Standard.",
      };
    }
    return {
      title,
      subtitle:
        p.limit === 'storage'
          ? "This project's owner has reached their storage limit."
          : "This project's owner has reached their project limit.",
    };
  }

  const left = Math.max(0, p.max - p.used);

  if (!isFree) {
    // Already on the top plan (or a plan this copy cannot name): there is
    // nothing to sell, only space to free.
    if (p.limit === 'projects') {
      return {
        title: plan ? `You've reached the ${plan.label} plan's ${p.max} projects` : "You've reached your project limit",
        subtitle: 'Move a project to the trash to make room for a new one.',
      };
    }
    if (p.limit === 'packages') {
      return {
        title: plan
          ? `This project has the ${plan.label} plan's ${p.max} packages`
          : 'This project is at its package limit',
        subtitle: 'Move a package to the trash to make room for a new one.',
      };
    }
    return {
      title: plan
        ? `You've reached the ${plan.label} plan's ${formatBytes(plan.storageBytes)}`
        : "You've reached your storage limit",
      subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(
        left
      )} left. Deleting files you no longer need frees space straight away; deleted packages and projects keep counting for ${TRASH_RETENTION_DAYS} days.`,
    };
  }

  if (p.limit === 'projects') {
    return { title: `You've used your ${p.max} Free projects`, subtitle: perks };
  }
  if (p.limit === 'packages') {
    // Trashed packages do not count toward this limit (their bytes still count
    // toward storage), so the trash is an honest second way out.
    return {
      title: `This project has its ${p.max} Free packages`,
      subtitle: `${perks} Or move a package to the trash to make room.`,
    };
  }
  return {
    title: 'Not enough storage',
    subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(left)} left of ${formatBytes(
      p.max
    )}. ${perks}`,
  };
}

/**
 * The toast after Stripe Checkout sends someone back with ?billing=success.
 *
 * /api/billing/return lands on that URL on its failure paths too (a sync that
 * could not reach Stripe, a webhook not yet processed), so the param alone is
 * not proof. Only a plan the server confirms as Standard earns the claim.
 * Nothing refetches the plan afterwards, so the fallback asks for a refresh.
 */
export function checkoutReturnToast(plan: PlanId | null | undefined): string {
  return plan === 'standard'
    ? "You're on Standard"
    : 'Payment received — refresh in a moment to see Standard.';
}

/** Storage used, as a fraction of the plan, at which the dashboard banner appears. */
export const NEAR_LIMIT_FRACTION = 0.8;

/**
 * The dashboard PlanBanner's line, or null for no banner.
 *
 * Free only: the banner's whole point is the Upgrade button, and Standard has
 * nothing to upgrade to. Projects are checked first, at or over the limit;
 * storage from NEAR_LIMIT_FRACTION of the plan upward.
 */
export function planBannerMessage(
  usage: Pick<AccountUsage, 'plan' | 'storage' | 'projects'>,
  format: (bytes: number) => string = formatBytes
): string | null {
  const { plan, storage, projects } = usage;
  if (plan.id !== 'free') return null;
  if (projects.max !== null && projects.count >= projects.max) {
    return `You're using ${projects.count} of ${projects.max} ${plan.label} projects.`;
  }
  if (storage.totalBytes >= plan.storageBytes * NEAR_LIMIT_FRACTION) {
    return `You've used ${format(storage.totalBytes)} of ${format(plan.storageBytes)} storage.`;
  }
  return null;
}
