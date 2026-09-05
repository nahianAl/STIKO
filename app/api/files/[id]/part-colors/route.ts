import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';

/**
 * Set or clear the colour of one part of a 3D model, for everyone who opens the package.
 *
 * The client hides the colour pill for roles that may not do this, but that is presentation
 * only — this route is the actual boundary. Same shape and same gate as the transform route
 * beside it: colouring a part and moving the object are the same class of shared-scene edit,
 * which is why canTransform covers both rather than a parallel capability being invented.
 *
 * Visibility deliberately has no endpoint. Hiding a part is a way of LOOKING at a model and
 * is session-only, exactly as a cross-section plane's pose is.
 */

/** Six-digit hex with a leading #. Anything else would render as black with no error shown. */
const HEX = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canTransform) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const partKey = body?.partKey;
  const color = body?.color;

  if (typeof partKey !== 'string' || partKey.length === 0 || partKey.length > 200) {
    return NextResponse.json({ error: 'Invalid part' }, { status: 400 });
  }
  if (color !== null && (typeof color !== 'string' || !HEX.test(color))) {
    return NextResponse.json({ error: 'Invalid colour' }, { status: 400 });
  }

  if (color === null) {
    // Clearing an override returns the part to whatever the model itself says, which may be
    // an auto-colour or its original material. Deleting the row IS the reset.
    await sql`
      DELETE FROM part_colors WHERE file_id = ${params.id} AND part_key = ${partKey}
    `;
    return NextResponse.json({ ok: true });
  }

  await sql`
    INSERT INTO part_colors (id, file_id, part_key, color, set_by)
    VALUES (${randomUUID()}, ${params.id}, ${partKey}, ${color}, ${session.user.id})
    ON CONFLICT (file_id, part_key)
    DO UPDATE SET color = EXCLUDED.color, set_by = EXCLUDED.set_by
  `;

  return NextResponse.json({ ok: true });
}
