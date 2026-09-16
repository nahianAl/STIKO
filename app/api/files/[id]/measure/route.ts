import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { isLengthUnit } from '@/lib/measure/units';

/**
 * Set the display unit and/or the calibration for one file.
 *
 * One route rather than two because the gate is the interesting part and it belongs in one
 * place. The client hides controls a role may not use, but that is presentation only — this is
 * the actual boundary.
 *
 * The three-way rule: a reviewer who opens an uncalibrated drawing can calibrate it and get to
 * work, because blocking that blocks the feature's main use case. But once a calibration exists,
 * changing it silently shifts every number everyone else reads, which is the same class of
 * shared-scene edit as moving an object or colouring a part — so overwriting needs canTransform.
 */

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
  if (!access.canComment) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || (body.unit === undefined && body.calibration === undefined)) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  if (body.unit !== undefined) {
    if (!isLengthUnit(body.unit)) {
      return NextResponse.json({ error: 'Invalid unit' }, { status: 400 });
    }
    await sql`UPDATE files SET measure_unit = ${body.unit} WHERE id = ${params.id}`;
  }

  if (body.calibration !== undefined) {
    const { page, mmPerUnit } = body.calibration ?? {};

    if (!Number.isInteger(page) || page < 0) {
      return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
    }
    // Mirrors the CHECK constraint. A non-positive or non-finite scale would not merely be
    // wrong, it would make every reading on the file wrong with no error shown anywhere.
    if (typeof mmPerUnit !== 'number' || !Number.isFinite(mmPerUnit) || mmPerUnit <= 0) {
      return NextResponse.json({ error: 'Invalid calibration' }, { status: 400 });
    }

    const existing = await sql`
      SELECT id FROM file_calibrations
      WHERE file_id = ${params.id} AND page_number = ${page}
    `;

    if (existing.length > 0 && !access.canTransform) {
      return NextResponse.json(
        { error: 'This file is already calibrated. Ask the package owner to change it.' },
        { status: 403 }
      );
    }

    await sql`
      INSERT INTO file_calibrations (id, file_id, page_number, mm_per_unit, set_by)
      VALUES (${randomUUID()}, ${params.id}, ${page}, ${mmPerUnit}, ${session.user.id})
      ON CONFLICT (file_id, page_number)
      DO UPDATE SET mm_per_unit = EXCLUDED.mm_per_unit, set_by = EXCLUDED.set_by
    `;
  }

  return NextResponse.json({ ok: true });
}
