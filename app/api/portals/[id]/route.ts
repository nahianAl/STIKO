import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess, isProjectMember } from '@/lib/access';

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
           link_access AS "linkAccess", archived_at AS "archivedAt",
           created_at AS "createdAt"
    FROM portals WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(rows[0]);
}

/** PATCH — name, tag, project, link access, archive (3l). */
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

  const { name, tag, projectId, linkAccess, archived } = await request.json();

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
    await sql`UPDATE portals SET project_id = ${projectId} WHERE id = ${params.id}`;
  }
  if (linkAccess !== undefined) {
    await sql`UPDATE portals SET link_access = ${Boolean(linkAccess)} WHERE id = ${params.id}`;
  }
  if (archived !== undefined) {
    // Archiving is reversible, which is why it is offered as the alternative to
    // deletion on every destructive confirm.
    await sql`
      UPDATE portals SET archived_at = ${archived ? new Date().toISOString() : null}
      WHERE id = ${params.id}
    `;
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

  // Versions, files, comments, markups and participants all cascade.
  const result = await sql`
    DELETE FROM portals WHERE id = ${params.id} RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
