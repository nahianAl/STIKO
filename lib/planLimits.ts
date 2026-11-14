/**
 * What the Free plan refuses, as pure rules.
 *
 * Pure and dependency-free so node --test can import it: no `@/` alias, and
 * Plan is a type-only import. The server gate (lib/planGate.ts) loads usage and
 * calls these; nothing here knows about the database or HTTP.
 */
import type { Plan, PlanId } from './plans';

/**
 * Limits are on only while billing is on. With the kill switch thrown nobody
 * can lift a limit by paying, so enforcing one would trap people. Mirrors
 * billingEnabled() in lib/billing.ts; duplicated rather than imported so this
 * module stays free of value imports.
 */
export function limitsEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_ENABLED === 'true' && !!env.STRIPE_SECRET_KEY;
}

/** Trashed projects are not counted; the caller passes the active count. */
export function canCreateProject(plan: Pick<Plan, 'maxProjects'>, activeProjectCount: number): boolean {
  if (plan.maxProjects === null) return true;
  return activeProjectCount < plan.maxProjects;
}

/** Exactly at the limit is allowed. A nonsense claim is refused, not waved through. */
export function canAddBytes(plan: Pick<Plan, 'storageBytes'>, usedBytes: number, addBytes: number): boolean {
  if (!Number.isFinite(addBytes) || addBytes < 0) return false;
  return usedBytes + addBytes <= plan.storageBytes;
}

/**
 * A size the client declared for an upload: a whole number of bytes, zero
 * included. Zero-byte files uploaded before plan limits existed, and refusing
 * them would leave one stuck 'failed' in every batch that contains it.
 */
export function isDeclaredFileSize(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

export type PlanLimitKind = 'projects' | 'storage';

/** The body of every 402. The client turns it into the upgrade dialog. */
export interface PlanLimitPayload {
  error: string;
  code: 'plan_limit';
  limit: PlanLimitKind;
  /**
   * The OWNER's plan at the time of the refusal. Standard's storage is capped
   * too, so a 402 is not proof the owner is on Free: the dialog must not sell
   * Standard to someone who already has it. Optional on the wire check below,
   * and a body without it is treated as "plan unknown", which offers no checkout.
   */
  plan: PlanId;
  /** False when the caller is a collaborator on someone else's project. */
  isOwner: boolean;
  /** Projects: active count. Storage: bytes used (trash included). */
  used: number;
  max: number;
  /** Storage: bytes this request wanted to add. Projects: 1. */
  adding: number;
}

/** Tolerant: `plan` is not required, so a body without it still opens the dialog. */
export function isPlanLimitPayload(v: unknown): v is PlanLimitPayload {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.code === 'plan_limit' && (o.limit === 'projects' || o.limit === 'storage');
}
