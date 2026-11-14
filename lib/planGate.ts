import 'server-only';
import { NextResponse } from 'next/server';
import { getAccountUsage } from '@/lib/queries';
import {
  canAddBytes,
  canCreateProject,
  limitsEnforced,
  type PlanLimitPayload,
} from '@/lib/planLimits';
import { formatBytes } from '@/lib/design';

/**
 * The server side of the Free-plan limits. Every check is against the project
 * OWNER's plan and usage: a collaborator uploading into someone's project
 * spends the owner's storage, because the owner is the one who pays.
 *
 * Returns null when the request may proceed.
 */
export async function projectLimitRefusal(
  ownerId: string,
  callerId: string
): Promise<PlanLimitPayload | null> {
  if (!limitsEnforced()) return null;
  const usage = await getAccountUsage(ownerId);
  if (canCreateProject(usage.plan, usage.projects.count)) return null;
  const max = usage.plan.maxProjects ?? 0;
  return {
    error: `The Free plan includes ${max} projects. Upgrade to Standard for unlimited projects.`,
    code: 'plan_limit',
    limit: 'projects',
    isOwner: ownerId === callerId,
    used: usage.projects.count,
    max,
    adding: 1,
  };
}

export async function storageLimitRefusal(
  ownerId: string,
  callerId: string,
  addBytes: number
): Promise<PlanLimitPayload | null> {
  if (!limitsEnforced()) return null;
  const usage = await getAccountUsage(ownerId);
  if (canAddBytes(usage.plan, usage.storage.totalBytes, addBytes)) return null;
  return {
    error: `This needs ${formatBytes(addBytes)}, and the ${usage.plan.label} plan's ${formatBytes(
      usage.plan.storageBytes
    )} has ${formatBytes(Math.max(0, usage.plan.storageBytes - usage.storage.totalBytes))} left.`,
    code: 'plan_limit',
    limit: 'storage',
    isOwner: ownerId === callerId,
    used: usage.storage.totalBytes,
    max: usage.plan.storageBytes,
    adding: addBytes,
  };
}

/** 402 Payment Required: the client recognises the body by its `code`. */
export function planLimitResponse(p: PlanLimitPayload): NextResponse {
  return NextResponse.json(p, { status: 402 });
}
