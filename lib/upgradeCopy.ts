/**
 * What the upgrade dialog says, as pure text.
 *
 * Kept out of the component so node --test can import it: relative imports
 * only (no `@/` alias), and the payload type is type-only.
 */
import { formatBytes } from './design.ts';
import { PLANS } from './plans.ts';
import type { PlanLimitPayload } from './planLimits.ts';

/** The Standard pitch, derived from the catalogue so it cannot drift from it. */
export function standardPerks(): string {
  return `Standard gives you ${formatBytes(PLANS.standard.storageBytes)} and unlimited projects.`;
}

export function headline(p: PlanLimitPayload | null): { title: string; subtitle: string } {
  const perks = standardPerks();
  if (!p) return { title: 'Upgrade to Standard', subtitle: perks };
  if (!p.isOwner) {
    return {
      title: p.limit === 'storage' ? 'This project is out of storage' : 'This project is at its limit',
      subtitle:
        p.limit === 'storage'
          ? "The project's owner is on the Free plan and has used its storage. Ask them to upgrade to Standard."
          : "The project's owner is on the Free plan and has used its projects. Ask them to upgrade to Standard.",
    };
  }
  if (p.limit === 'projects') {
    return { title: `You've used your ${p.max} Free projects`, subtitle: perks };
  }
  const left = Math.max(0, p.max - p.used);
  return {
    title: 'Not enough storage',
    subtitle: `This needs ${formatBytes(p.adding)} — you have ${formatBytes(left)} left of ${formatBytes(
      p.max
    )}. ${perks}`,
  };
}
