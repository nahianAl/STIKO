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
 *
 * Shape: validate everything first, write everything last. Every gate below — unit shape,
 * page/scale shape, and the canTransform check on an existing calibration — can still reject the
 * request, and a rejected request must leave the database untouched. So nothing is written until
 * every gate has passed; see the boundary comment below before adding a write earlier.
 */

// Postgres INT's maximum. file_calibrations.page_number is declared INT, so a page beyond this
// would overflow the column and throw "integer out of range" instead of returning a clean 400.
const POSTGRES_INT_MAX = 2147483647;

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

  if (body.unit !== undefined && !isLengthUnit(body.unit)) {
    return NextResponse.json({ error: 'Invalid unit' }, { status: 400 });
  }

  let calibration: { page: number; mmPerUnit: number } | null = null;

  if (body.calibration !== undefined) {
    const { page, mmPerUnit } = body.calibration ?? {};

    if (!Number.isInteger(page) || page < 0 || page > POSTGRES_INT_MAX) {
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

    calibration = { page, mmPerUnit };
  }

  // Validate/write boundary: every 401/404/403/400 above has already returned, so from here on
  // the request is fully accepted. Nothing before this line executes a write — that is what
  // keeps a rejected request from leaving a partial write behind. Do not move a write above it.
  const writeUnit = body.unit !== undefined
    ? sql`UPDATE files SET measure_unit = ${body.unit} WHERE id = ${params.id}`
    : null;
  const writeCalibration = calibration
    ? sql`
        INSERT INTO file_calibrations (id, file_id, page_number, mm_per_unit, set_by)
        VALUES (${randomUUID()}, ${params.id}, ${calibration.page}, ${calibration.mmPerUnit}, ${session.user.id})
        ON CONFLICT (file_id, page_number)
        DO UPDATE SET mm_per_unit = EXCLUDED.mm_per_unit, set_by = EXCLUDED.set_by
      `
    : null;

  // sql.transaction takes an array of queries and cannot interleave JavaScript between them,
  // which is exactly why every validation and the existence SELECT above had to happen first.
  if (writeUnit && writeCalibration) {
    await sql.transaction([writeUnit, writeCalibration]);
  } else if (writeUnit) {
    await writeUnit;
  } else if (writeCalibration) {
    await writeCalibration;
  }

  return NextResponse.json({ ok: true });
}
