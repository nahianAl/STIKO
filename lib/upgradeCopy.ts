/**
 * What the upgrade dialog says, as pure text.
 *
 * Kept out of the component so node --test can import it: relative imports
 * only (no `@/` alias), and the payload type is type-only.
 */
import { formatBytes } from './design.ts';
import { PLANS } from './plans.ts';
import type { Plan } from './plans.ts';
import type { PlanLimitPayload } from './planLimits.ts';

/** The Standard pitch, derived from the catalogue so it cannot drift from it. */
export function standardPerks(): string {
  return `Standard gives you ${formatBytes(PLANS.standard.storageBytes)} and unlimited projects.`;
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
    return {
      title: plan
        ? `You've reached the ${plan.label} plan's ${formatBytes(plan.storageBytes)}`
        : "You've reached your storage limit",
      subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(
        left
      )} left. Free up space by deleting files you no longer need or emptying the trash.`,
    };
  }

  if (p.limit === 'projects') {
    return { title: `You've used your ${p.max} Free projects`, subtitle: perks };
  }
  return {
    title: 'Not enough storage',
    subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(left)} left of ${formatBytes(
      p.max
    )}. ${perks}`,
  };
}
