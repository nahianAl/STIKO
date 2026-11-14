import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess, isProjectMember } from '@/lib/access';
import { packageCountedBytes } from '@/lib/queries';
import { planLimitResponse, storageLimitRefusal } from '@/lib/planGate';

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

  const rows = await sql`
    SELECT id, project_id AS "projectId", name, tag,
           link_access AS "linkAccess",
           created_at AS "createdAt"
    FROM portals WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(rows[0]);
}

/** PATCH — name, tag, project, link access (3l). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getPackageAccess(session.user.id, params.id);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, tag, projectId, linkAccess } = await request.json();

  if (name !== undefined) {
    if (!String(name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }
    await sql`UPDATE portals SET name = ${String(name).trim()} WHERE id = ${params.id}`;
  }
  if (tag !== undefined) {
    // An empty tag clears it — the field is optional and freeform.
    const clean = String(tag ?? '').trim();
    await sql`UPDATE portals SET tag = ${clean || null} WHERE id = ${params.id}`;
  }
  if (projectId !== undefined) {
    // Moving a package hands every project member of the DESTINATION project
    // access to its files, versions and comments. Manage rights on the source
    // package are not enough — without this check a coordinator could push a
    // package into a project they don't belong to and leak it wholesale, which
    // is precisely the boundary violation 09 warns about.
    if (!(await isProjectMember(session.user.id, projectId))) {
      return NextResponse.json(
        { error: 'You cannot move this package into that project' },
        { status: 403 }
      );
    }

    // Storage is charged to the OWNER of the project a package sits in, so a move
    // to a project with a different owner hands that owner every byte of the
    // package. Without this check a Free user could upload into a helper's
    // project (their quota, not theirs) and then move the package into their
    // own. Same owner: nothing changes hands. A move cannot change the
    // destination's project count (the destination is a live project, which
    // isProjectMember above requires, and no project is created or revived), so
    // there is no project limit to check.
    const owners = await sql`
      SELECT src.owner_id AS "srcOwnerId", dest.owner_id AS "destOwnerId"
      FROM portals po
      JOIN projects src ON src.id = po.project_id
      JOIN projects dest ON dest.id = ${projectId}
      WHERE po.id = ${params.id}
    `;
    if (!owners[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { srcOwnerId, destOwnerId } = owners[0] as { srcOwnerId: string; destOwnerId: string };
    if (destOwnerId !== srcOwnerId) {
      const packageBytes = await packageCountedBytes(params.id);
      const refusal = await storageLimitRefusal(destOwnerId, session.user.id, packageBytes);
      if (refusal) return planLimitResponse(refusal);
    }

    await sql`UPDATE portals SET project_id = ${projectId} WHERE id = ${params.id}`;
  }
  if (linkAccess !== undefined) {
    await sql`UPDATE portals SET link_access = ${Boolean(linkAccess)} WHERE id = ${params.id}`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Previously any signed-in user could delete any package by id. Deletion is
  // now restricted to whoever can manage the package.
  const access = await getPackageAccess(session.user.id, params.id);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await sql`
    UPDATE portals
    SET deleted_at = ${new Date().toISOString()},
        deleted_by = ${session.user.id},
        -- FALSE: deleted on its own, so it keeps its own clock and its own
        -- trash card, and restoring its project will not revive it.
        deleted_with_project = FALSE
    WHERE id = ${params.id} AND deleted_at IS NULL
    RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
