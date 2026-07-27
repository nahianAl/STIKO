import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isProjectMember, visiblePackageIds } from '@/lib/access';

/**
 * GET — packages this user may see.
 *
 * This route previously returned EVERY package in the database to anyone, with
 * no session at all, and any single project's packages by id. A package is a
 * permission boundary (01), so the result is now scoped to what the caller
 * actually has access to.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get('projectId');

  if (projectId) {
    // Listing a project's packages is a project-member action; a guest must not
    // learn what else lives alongside the package they were invited to.
    if (!(await isProjectMember(session.user.id, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const rows = await sql`
      SELECT id, project_id AS "projectId", name, tag, created_at AS "createdAt"
      FROM portals
      WHERE project_id = ${projectId} AND archived_at IS NULL
      ORDER BY created_at DESC
    `;
    return NextResponse.json(rows);
  }

  const visible = await visiblePackageIds(session.user.id);
  if (visible.length === 0) return NextResponse.json([]);

  const rows = await sql`
    SELECT id, project_id AS "projectId", name, tag, created_at AS "createdAt"
    FROM portals
    WHERE id = ANY(${visible})
    ORDER BY created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, projectId } = await request.json();

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  // Creating a package inside a project is a project-member action. Without
  // this, anyone signed in could plant a package in someone else's project.
  if (!(await isProjectMember(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await sql`
    INSERT INTO portals (id, project_id, name)
    VALUES (${uuidv4()}, ${projectId}, ${String(name).trim()})
    RETURNING id, project_id AS "projectId", name, tag, created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
