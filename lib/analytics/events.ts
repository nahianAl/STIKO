/**
 * How a Stiko server event becomes a PostHog capture. Pure.
 *
 * The plan's rule 3: every event carries user_id, workspace_id, segment_id and
 * track. The spec's rule: no names, emails, filenames, comment text or tokens.
 */
import { analyticsAllowed } from '../geo.ts';

export interface WorkspaceContext {
  workspaceId: string | null;
  segmentId: string;
  track: string;
  analyticsConsent: string | null;
}

export interface CaptureRow {
  uuid: string;
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}

export const ANONYMOUS_CONTEXT: WorkspaceContext = {
  workspaceId: null,
  segmentId: 'unknown',
  track: 'unknown',
  analyticsConsent: null,
};

const FORBIDDEN_KEYS = new Set([
  'filename', 'file_name', 'name', 'email', 'project_name', 'package_name',
  'token', 'invite_token', 'body', 'comment', 'note',
]);

export function stripForbidden(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!FORBIDDEN_KEYS.has(k)) out[k] = v;
  return out;
}

export function buildCapture(
  input: {
    event: string;
    distinctId: string;
    userId: string | null;
    context: WorkspaceContext;
    properties?: Record<string, unknown>;
    set?: Record<string, unknown>;
    setOnce?: Record<string, unknown>;
  },
  uuid: string
): CaptureRow | null {
  const { context } = input;
  if (!analyticsAllowed(context.analyticsConsent)) return null;

  const properties: Record<string, unknown> = {
    ...stripForbidden(input.properties ?? {}),
    user_id: input.userId,
    workspace_id: context.workspaceId,
    segment_id: context.segmentId,
    track: context.track,
  };
  if (context.workspaceId) properties.$groups = { workspace: context.workspaceId };
  if (input.set) properties.$set = stripForbidden(input.set);
  if (input.setOnce) properties.$set_once = stripForbidden(input.setOnce);
  properties.$lib = 'stiko-server';

  return { uuid, event: input.event, distinctId: input.distinctId, properties };
}

export function buildGroupIdentify(
  workspaceId: string,
  distinctId: string,
  groupSet: Record<string, unknown>,
  uuid: string
): CaptureRow {
  return {
    uuid,
    event: '$groupidentify',
    distinctId,
    properties: {
      $group_type: 'workspace',
      $group_key: workspaceId,
      $group_set: stripForbidden(groupSet),
      $lib: 'stiko-server',
    },
  };
}

export function toBatchPayload(apiKey: string, rows: Array<CaptureRow & { createdAt: string }>) {
  return {
    api_key: apiKey,
    batch: rows.map((r) => ({
      uuid: r.uuid,
      event: r.event,
      distinct_id: r.distinctId,
      properties: r.properties,
      timestamp: r.createdAt,
    })),
  };
}

/**
 * Stripe status transitions that are funnel events. Stripe redelivers and
 * reorders webhooks; firing only on ENTERING a state is what makes it safe.
 * past_due → active is a recovered payment, not a new subscription.
 */
export function billingTransitionEvents(
  prev: string | null,
  next: string | null
): Array<'trial_started' | 'subscription_started'> {
  if (next === prev) return [];
  if (next === 'trialing') return ['trial_started'];
  if (next === 'active' && prev !== 'past_due') return ['subscription_started'];
  return [];
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}
