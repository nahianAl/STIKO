/**
 * How a Stiko server event becomes a PostHog capture. Pure.
 *
 * The plan's rule 3: every event carries user_id, workspace_id, segment_id and
 * track. The spec's rule: no names, emails, filenames, comment text or tokens.
 */
import { analyticsAllowed } from '../geo.ts';
import {
  extensionOf as rawExtensionOf, SUPPORTED_EXTENSIONS, NATIVE_CAD_ADVICE,
} from '../fileFormats.ts';

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

/** Keys that are forbidden by name (compared lowercased, camelCase split to snake_case). */
const FORBIDDEN_KEYS = new Set([
  'filename', 'file_name', 'name', 'email', 'project_name', 'package_name',
  'token', 'invite_token', 'body', 'comment', 'note',
  'first_name', 'last_name', 'full_name', 'display_name', 'text', 'message', 'title',
]);

/** A key ending in email / name / filename / token is a person, file or secret value. */
const FORBIDDEN_KEY_PATTERN = /(^|_)(email|name|filename|token)$/;

/**
 * PostHog-reserved keys. Callers must not inject them; buildCapture and
 * buildGroupIdentify add their own AFTER stripping. $geoip_disable is one: every
 * server event sets it, because the request comes from a Vercel data centre and
 * PostHog would otherwise file the person under that location. __proto__ is here so a
 * JSON-parsed payload cannot swap the prototype of the stripped copy.
 */
const RESERVED_KEYS = new Set([
  '$set', '$set_once', '$groups', '$lib', 'distinct_id', '$group_type', '$group_key', '$group_set',
  '$geoip_disable', '__proto__',
]);

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (RESERVED_KEYS.has(lower)) return true;
  // is_* flags (e.g. is_business_email) are booleans Stiko sends on purpose.
  if (lower.startsWith('is_')) return false;
  // fileName / userEmail / project-name → file_name / user_email / project_name
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  return FORBIDDEN_KEYS.has(snake) || FORBIDDEN_KEY_PATTERN.test(snake);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isScalar(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v) || v instanceof Date;
}

/** A value with no nested object in it: a scalar, or an array of scalars. */
function isFlat(v: unknown): boolean {
  return isScalar(v) || (Array.isArray(v) && v.every(isScalar));
}

function stripLevel(props: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (isForbiddenKey(k)) continue;
    if (isFlat(v)) out[k] = v;
    // One level of nesting is stripped and kept; anything deeper is dropped whole.
    else if (depth === 0 && isPlainObject(v)) out[k] = stripLevel(v, depth + 1);
  }
  return out;
}

/**
 * Removes PII-bearing and PostHog-reserved keys. Matching is case-insensitive
 * and by pattern, not only by list. Recurses one level into plain objects;
 * deeper objects, objects inside arrays and non-plain objects are dropped.
 */
export function stripForbidden(props: Record<string, unknown>): Record<string, unknown> {
  return stripLevel(props, 0);
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
  properties.$geoip_disable = true;

  return { uuid, event: input.event, distinctId: input.distinctId, properties };
}

/**
 * Carries no consent check: callers must skip it for users whose consent is
 * denied or pending (lib/analytics/server.ts does).
 */
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
      $geoip_disable: true,
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

/** Entering active from one of these is a recovered payment or a resume. */
const RECOVERY_STATUSES = new Set(['past_due', 'unpaid', 'paused']);

/**
 * Stripe status transitions that are funnel events. Stripe redelivers and
 * reorders webhooks; firing only on ENTERING a state is what makes it safe.
 * past_due / unpaid / paused → active is a recovered payment or a resume, not
 * a new subscription. incomplete, incomplete_expired, canceled and null → active are.
 */
export function billingTransitionEvents(
  prev: string | null,
  next: string | null
): Array<'trial_started' | 'subscription_started'> {
  if (next === prev) return [];
  if (next === 'trialing') return ['trial_started'];
  if (next === 'active' && !(prev && RECOVERY_STATUSES.has(prev))) return ['subscription_started'];
  return [];
}

/** True for an extension Stiko accepts or can advise on. Own keys only, so 'constructor' is not one. */
function isKnownExtension(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.has(ext) || Object.prototype.hasOwnProperty.call(NATIVE_CAD_ADVICE, ext);
}

/**
 * The file extension when it is a type Stiko accepts, '' when there is none, and
 * 'other' for any extension it does not know. An unknown extension is never
 * echoed back: 'Rev 2.Dana' is a fragment of a filename, not a file type.
 */
export function extensionOf(filename: string): string {
  const ext = rawExtensionOf(filename);
  if (!ext) return '';
  return isKnownExtension(ext) ? ext : 'other';
}

/**
 * For the rejected-upload event, where the extension arrives from the browser
 * already split off (and already shaped [a-z0-9_]{1,10}, which still lets
 * "Rev 2.Dana" through as 'dana'). A format Stiko knows is kept — that is the
 * demand signal the event exists for — and so is the '(none)' marker; anything
 * else is 'other'.
 */
export function reportableExtension(ext: string): string {
  if (ext === '(none)') return ext;
  return isKnownExtension(ext) ? ext : 'other';
}
