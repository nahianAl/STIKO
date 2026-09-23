import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { feedFilters, type PortalDigest } from '@/lib/portalActivity';

/**
 * The portal's change feed: has anything this viewer may see changed?
 *
 * Returns NO content — no bodies, no names, no ids. Only a (count, latest
 * stamp) pair per entity. The client re-runs the existing loader for whichever
 * pair moved, so every access rule stays in the routes that already own it and
 * is never restated here.
 *
 * Polled once every few seconds per open portal, so it is one statement.
 */

/** TIMESTAMPTZ arrives as a Date from the HTTP driver, or null when MAX() saw no rows. */
function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** COUNT() is bigint, which the driver hands back as a string. */
function toCount(value: unknown): number {
  return Number(value ?? 0);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getPackageAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { includeDrafts, versionIds } = feedFilters(access);
  // `scoped` and `scopeList` are separate because an EMPTY scope list is
  // meaningful — a reviewer narrowed to no versions — and `= ANY('{}')` is
  // false for every row, which is exactly right. Collapsing the two would hand
  // that reviewer the whole package.
  const scoped = versionIds !== null;
  const scopeList = versionIds ?? [];

  // Casts on every parameter: the HTTP driver sends values as text, and
  // Postgres cannot infer a type for a bare placeholder sitting alone in an OR
  // or against an empty array.
  const rows = await sql`
    WITH visible_versions AS (
      SELECT v.id, v.created_at, v.published_at, v.renamed_at
      FROM versions v
      WHERE v.portal_id = ${params.id}
        AND (${includeDrafts}::boolean OR v.published_at IS NOT NULL)
        AND (NOT ${scoped}::boolean OR v.id = ANY(${scopeList}::text[]))
    ),
    visible_files AS (
      SELECT f.id, f.created_at
      FROM files f
      JOIN visible_versions vv ON vv.id = f.version_id
    ),
    visible_comments AS (
      SELECT c.created_at, c.edited_at
      FROM comments c
      JOIN visible_files vf ON vf.id = c.file_id
    )
    SELECT
      (SELECT COUNT(*) FROM participants WHERE portal_id = ${params.id}) AS "participantsN",
      (SELECT MAX(created_at) FROM participants WHERE portal_id = ${params.id}) AS "participantsAt",
      (SELECT COUNT(*) FROM visible_versions) AS "versionsN",
      -- published_at is folded in for the same reason edited_at is folded into
      -- the comment stamp below: an IN-PLACE edit moves neither half of a
      -- (count, stamp) pair on its own. Publishing sets published_at on a row
      -- that already exists, so for anyone whose includeDrafts is true the
      -- draft was already counted and nothing about it moves — their rail would
      -- go on calling a published version a draft, and the file delete confirm
      -- would go on offering the light wording for it.
      -- GREATEST skips NULLs (see the note on the comment stamp), so an
      -- all-draft package still yields the created_at maximum.
      -- renamed_at is folded in for the same reason: a rename changes a row in
      -- place, so without it nobody else's rail would show the new name.
      (SELECT GREATEST(MAX(created_at), MAX(published_at), MAX(renamed_at)) FROM visible_versions) AS "versionsAt",
      (SELECT COUNT(*) FROM visible_files) AS "filesN",
      (SELECT MAX(created_at) FROM visible_files) AS "filesAt",
      (SELECT COUNT(*) FROM visible_comments) AS "commentsN",
      -- GREATEST skips NULL inputs in Postgres and returns NULL only when every
      -- input is NULL, so a package where nothing has been edited yields the
      -- created_at maximum rather than NULL. Several other SQL engines
      -- propagate NULL here instead, which would silently blind the cursor.
      (SELECT GREATEST(MAX(created_at), MAX(edited_at)) FROM visible_comments) AS "commentsAt"
  `;

  const row = rows[0] ?? {};

  const digest: PortalDigest = {
    participants: { n: toCount(row.participantsN), at: toIso(row.participantsAt) },
    versions: { n: toCount(row.versionsN), at: toIso(row.versionsAt) },
    files: { n: toCount(row.filesN), at: toIso(row.filesAt) },
    comments: { n: toCount(row.commentsN), at: toIso(row.commentsAt) },
  };

  return NextResponse.json(digest, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
