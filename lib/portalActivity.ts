import type { VersionScope } from './capabilities';

/**
 * Pure logic behind the portal's change feed. No imports that touch I/O and no
 * `@/` alias — scripts/tests loads this file directly under `node --test`.
 */

/**
 * One entity's change cursor: how many rows this viewer may see, and the newest
 * timestamp among them.
 *
 * The PAIR is the point. A stamp alone detects an insert and nothing else, and
 * comments here are both editable and hard-deletable:
 *
 *   insert  count rises, stamp advances
 *   delete  count falls,  stamp sits still
 *   edit    count sits still, stamp advances (via comments.edited_at)
 *
 * `at` is null when there are no rows at all — MAX() over nothing is NULL.
 */
export interface EntityCursor {
  n: number;
  at: string | null;
}

export type PortalEntity = 'comments' | 'participants' | 'versions' | 'files';

export type PortalDigest = Record<PortalEntity, EntityCursor>;

export type DigestDiff = Record<PortalEntity, boolean>;

export const PORTAL_ENTITIES: PortalEntity[] = [
  'comments',
  'participants',
  'versions',
  'files',
];

/**
 * Which entities moved between two polls.
 *
 * A null `prev` means the caller has no baseline yet and reports NOTHING
 * changed. That is what makes the first poll a silent seed: without it, the
 * first response diffs against nothing, every entity reads as changed, and the
 * page re-fetches all four seconds after mount had already loaded them.
 */
export function diffDigest(prev: PortalDigest | null, next: PortalDigest): DigestDiff {
  const out = {} as DigestDiff;
  for (const key of PORTAL_ENTITIES) {
    const before = prev?.[key];
    const after = next?.[key];
    // A missing side means a malformed or older payload shape. Treat it as
    // quiet: a re-fetch loop is a worse failure than a missed update.
    if (!before || !after) {
      out[key] = false;
      continue;
    }
    out[key] = before.n !== after.n || before.at !== after.at;
  }
  return out;
}

/**
 * Return the PREVIOUS reference when the two payloads are structurally equal.
 *
 * Identity matters more than equality here. The portal hands these arrays to
 * the pin overlay and the 3D scene, which re-render whenever the reference
 * changes. The comment cursor is portal-wide, so a comment posted on another
 * file re-fetches THIS file's comments and gets byte-identical data back;
 * without this guard the viewer would churn every time anyone commented
 * anywhere in the package.
 *
 * JSON round-tripping is safe for these values specifically: they come
 * straight from a JSON response, so key order is whatever the serializer
 * produced and is stable between polls.
 */
export function preserveIfUnchanged<T>(prev: T, next: T): T {
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}

export interface FeedFilters {
  /**
   * Unpublished drafts count toward the cursor only for someone who may
   * publish. app/api/versions/route.ts hides draft rows from reviewers, so the
   * cursor deciding whether to re-fetch them must hide them too — otherwise a
   * reviewer's counter moves the moment an uploader starts a draft, disclosing
   * work in progress the route deliberately withholds.
   */
  includeDrafts: boolean;
  /**
   * null means every version in the package. An array means exactly these.
   *
   * An EMPTY array is meaningful and must not be collapsed to null: it is a
   * reviewer scoped to no versions at all, and null would hand them counts for
   * the whole package.
   */
  versionIds: string[] | null;
}

export function feedFilters(access: {
  canUpload: boolean;
  versionScope: VersionScope;
}): FeedFilters {
  return {
    includeDrafts: access.canUpload === true,
    versionIds: access.versionScope === 'all' ? null : [...access.versionScope],
  };
}
