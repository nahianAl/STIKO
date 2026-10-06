import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { MAX_SUGGESTIONS, suggestPatterns } from '@/lib/peopleSuggest';

/**
 * People the caller could invite to this package without retyping an address.
 *
 * Only ever the caller's own connections: anyone who stands beside them on a
 * package they can open — its participants, and the owner and coordinators of
 * its project. Nobody is suggested whom the caller could not already come
 * across in the product, so this cannot be used to browse Stiko's users.
 *
 * Gated exactly like sending an invite. Someone who may not invite to this
 * package has no reason to search for invitees.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const portalId = request.nextUrl.searchParams.get('portalId');
  if (!portalId) {
    return NextResponse.json({ error: 'portalId required' }, { status: 400 });
  }

  const access = await getPackageAccess(userId, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const patterns = suggestPatterns(request.nextUrl.searchParams.get('q') ?? '');
  if (!patterns) return NextResponse.json([]);

  // `visible` is visiblePackageIds() from lib/access.ts written as a CTE, so
  // the whole answer is one round trip. If that function's rule changes, this
  // must change with it.
  //
  // `already` is everyone who can open the target package today: suggesting
  // them would only produce a redundant invitation.
  const rows = await sql`
    WITH visible AS (
      SELECT DISTINCT po.id AS portal_id, po.project_id, pr.owner_id
      FROM portals po
      JOIN projects pr ON pr.id = po.project_id
      LEFT JOIN project_members pm
        ON pm.project_id = pr.id AND pm.user_id = ${userId}
      LEFT JOIN participants pa
        ON pa.portal_id = po.id AND pa.user_id = ${userId}
      WHERE po.deleted_at IS NULL
        AND pr.deleted_at IS NULL
        AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL OR pa.user_id IS NOT NULL)
    ),
    connections AS (
      SELECT pa.user_id FROM participants pa JOIN visible v ON v.portal_id = pa.portal_id
      UNION
      SELECT v.owner_id FROM visible v
      UNION
      SELECT pm.user_id FROM project_members pm JOIN visible v ON v.project_id = pm.project_id
    ),
    already AS (
      SELECT pa.user_id FROM participants pa WHERE pa.portal_id = ${portalId}
      UNION
      SELECT pr.owner_id
      FROM portals po JOIN projects pr ON pr.id = po.project_id
      WHERE po.id = ${portalId}
      UNION
      SELECT pm.user_id
      FROM portals po JOIN project_members pm ON pm.project_id = po.project_id
      WHERE po.id = ${portalId}
    )
    SELECT u.name, u.email, u.company
    FROM users u
    WHERE u.id IN (SELECT user_id FROM connections WHERE user_id IS NOT NULL)
      AND u.id NOT IN (SELECT user_id FROM already WHERE user_id IS NOT NULL)
      AND u.id <> ${userId}
      AND (
        u.email ILIKE ${patterns.prefix}
        OR u.name ILIKE ${patterns.prefix}
        OR u.name ILIKE ${patterns.word}
      )
    ORDER BY u.name NULLS LAST, u.email
    LIMIT ${MAX_SUGGESTIONS}
  `;

  // An allowlist of fields, and no user ids: the field only needs something to
  // show and an address to fill in.
  return NextResponse.json(
    rows.map((r) => ({
      name: (r.name as string | null) ?? null,
      email: r.email as string,
      company: (r.company as string | null) ?? null,
    }))
  );
}
