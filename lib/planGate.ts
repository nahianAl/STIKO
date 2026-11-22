import 'server-only';
import { NextResponse } from 'next/server';
import { getAccountUsage, projectPackageUsage } from '@/lib/queries';
import {
  canAddBytes,
  canAddPackage,
  canCreateProject,
  limitsEnforced,
  type PlanLimitPayload,
} from '@/lib/planLimits';
import { formatBytes } from '@/lib/design';

/**
 * The server side of the plan limits. Every check is against the project
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
  const upsell = usage.plan.id === 'free' ? ' Upgrade to Standard for unlimited projects.' : '';
  return {
    error: `The ${usage.plan.label} plan includes ${max} projects.${upsell}`,
    code: 'plan_limit',
    limit: 'projects',
    plan: usage.plan.id,
    isOwner: ownerId === callerId,
    used: usage.projects.count,
    max,
    adding: 1,
  };
}

/**
 * One more live package in `projectId`, against its OWNER's plan. Every path
 * that makes a package live in a project must call this for THAT project:
 * creating one, moving one in, and restoring one from the trash. A project that
 * does not exist is not refused here; the caller's own lookup 404s it.
 */
export async function packageLimitRefusal(
  projectId: string,
  callerId: string
): Promise<PlanLimitPayload | null> {
  if (!limitsEnforced()) return null;
  const usage = await projectPackageUsage(projectId);
  if (!usage || canAddPackage(usage.plan, usage.livePackages)) return null;
  const max = usage.plan.maxPackagesPerProject ?? 0;
  const upsell = usage.plan.id === 'free' ? ' Upgrade to Standard for unlimited packages.' : '';
  return {
    error: `The ${usage.plan.label} plan includes ${max} packages per project.${upsell}`,
    code: 'plan_limit',
    limit: 'packages',
    plan: usage.plan.id,
    isOwner: usage.ownerId === callerId,
    used: usage.livePackages,
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
    plan: usage.plan.id,
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
