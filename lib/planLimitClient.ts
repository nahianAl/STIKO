'use client';

import { isPlanLimitPayload, type PlanLimitPayload } from '@/lib/planLimits';

export const UPGRADE_EVENT = 'stiko:upgrade';

/** A 402 plan-limit body, or null for any other response. Reads a clone. */
export async function readPlanLimit(res: Response): Promise<PlanLimitPayload | null> {
  if (res.status !== 402) return null;
  const body = await res.clone().json().catch(() => null);
  return isPlanLimitPayload(body) ? body : null;
}

/** Opens the one UpgradeDialog mounted in the root layout. */
export function openUpgradeDialog(payload: PlanLimitPayload | null): void {
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT, { detail: payload }));
}

/** Thrown by helpers whose callers only catch; carries the 402 body. */
export class PlanLimitError extends Error {
  payload: PlanLimitPayload;
  constructor(payload: PlanLimitPayload) {
    super(payload.error);
    this.name = 'PlanLimitError';
    this.payload = payload;
  }
}
