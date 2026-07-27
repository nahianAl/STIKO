import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Everything "Who can see this" (4d) needs — including, crucially, the people
 * on the project who do NOT have access. Naming who cannot see it is the
 * entire value of that popover.
 */
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

  const portalRows = await sql`
    SELECT po.id, po.name, po.tag, po.link_access AS "linkAccess",
           po.project_id AS "projectId", pr.name AS "projectName",
           pr.owner_id AS "ownerId"
    FROM portals po JOIN projects pr ON pr.id = po.project_id
    WHERE po.id = ${params.id}
  `;
  const portal = portalRows[0];
  if (!portal) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const people = await sql`
    SELECT u.id, u.name, u.email, u.company, p.role
    FROM participants p JOIN users u ON u.id = p.user_id
    WHERE p.portal_id = ${params.id}
    UNION
    SELECT u.id, u.name, u.email, u.company, 'owner' AS role
    FROM users u WHERE u.id = ${portal.ownerId}
  `;

  // Project members and guests on sibling packages who are NOT on this one.
  // Only ever computed for someone who can already see the project — a guest
  // must not learn who else exists.
  const notVisibleTo = access.isProjectMember
    ? await sql`
        SELECT DISTINCT u.id, u.name, u.email
        FROM users u
        WHERE (
          u.id IN (
            SELECT user_id FROM project_members WHERE project_id = ${portal.projectId}
          )
          OR u.id IN (
            SELECT pa.user_id FROM participants pa
            JOIN portals po2 ON po2.id = pa.portal_id
            WHERE po2.project_id = ${portal.projectId} AND po2.id <> ${params.id}
          )
        )
        AND u.id NOT IN (
          SELECT user_id FROM participants WHERE portal_id = ${params.id}
        )
        AND u.id <> ${portal.ownerId}
      `
    : [];

  return NextResponse.json({
    package: {
      id: portal.id,
      name: portal.name,
      tag: portal.tag,
      linkAccess: portal.linkAccess,
      projectId: portal.projectId,
      projectName: portal.projectName,
    },
    access,
    people: people.map((p) => ({
      id: p.id as string,
      name: (p.name as string) ?? (p.email as string),
      company: (p.company as string) ?? null,
      role: p.role as string,
    })),
    notVisibleTo: notVisibleTo.map((p) => ({
      id: p.id as string,
      name: (p.name as string) ?? (p.email as string),
    })),
  });
}
