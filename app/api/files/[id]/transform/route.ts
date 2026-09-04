import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { isValidTransform } from '@/lib/objectTransform';

/**
 * Move or rotate a 3D object for everyone who opens the package.
 *
 * The client hides the gizmo for roles that may not do this, but that is
 * presentation only — this route is the actual boundary.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // getFileAccess resolves the file's version and applies the scope, which the
  // portalForFile + getPackageAccess pair did not.
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canTransform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!isValidTransform(body)) {
    // A non-finite value here would write NaN into the column and make the object
    // disappear from the viewport with no error surfaced anywhere.
    return NextResponse.json({ error: 'Invalid transform' }, { status: 400 });
  }

  const [px, py, pz] = body.position;
  const [rx, ry, rz] = body.rotation;

  await sql`
    UPDATE files
    SET position_x = ${px}, position_y = ${py}, position_z = ${pz},
        rotation_x = ${rx}, rotation_y = ${ry}, rotation_z = ${rz}
    WHERE id = ${params.id}
  `;

  return NextResponse.json({ ok: true });
}
