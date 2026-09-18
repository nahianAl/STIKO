import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { storageKeysForFiles } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';
import { TRASH_RETENTION_DAYS } from '@/lib/trash';

/**
 * Hard-delete everything past its window, and free its storage.
 *
 * Cleanup only. Expiry is computed at read time, so an expired item is already
 * invisible and unrestorable whether or not this has run — a missed schedule
 * costs storage, not correctness. That is deliberate: migrations here have been
 * forgotten twice and there is no staging environment to catch a silent
 * scheduler failure.
 *
 * Idempotent, and safe to run twice concurrently: the DELETEs are guarded on
 * the same window they select by, so a second run finds nothing.
 */
export async function GET(request: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this the
  // endpoint is an unauthenticated mass-delete for anyone who guesses the path.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/purge-trash] CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = `${TRASH_RETENTION_DAYS} days`;

  // Collected BEFORE the delete: afterwards nothing names these objects, and
  // they would sit in the bucket forever. Covers both packages trashed directly
  // and every package under a trashed project, since deleting the project
  // cascades to portals -> versions -> files.
  const doomedFiles = await sql`
    SELECT f.id
    FROM files f
    JOIN versions v ON v.id = f.version_id
    JOIN portals po ON po.id = v.portal_id
    JOIN projects pr ON pr.id = po.project_id
    WHERE (po.deleted_at IS NOT NULL AND po.deleted_at <= now() - ${cutoff}::interval)
       OR (pr.deleted_at IS NOT NULL AND pr.deleted_at <= now() - ${cutoff}::interval)
  `;
  const doomedKeys = await storageKeysForFiles(
    doomedFiles.map((f) => f.id as string)
  );

  // Packages first. A project's own DELETE cascades its portals anyway, but
  // doing packages explicitly keeps the counts honest about what was removed.
  const packages = await sql`
    DELETE FROM portals
    WHERE deleted_at IS NOT NULL
      AND deleted_at <= now() - ${cutoff}::interval
    RETURNING id
  `;
  const projects = await sql`
    DELETE FROM projects
    WHERE deleted_at IS NOT NULL
      AND deleted_at <= now() - ${cutoff}::interval
    RETURNING id
  `;

  // Last, and never inside a transaction with the rows: deleteObjects swallows
  // per-key failures, and a storage outage must not roll back a delete the
  // database has already committed. An orphaned object is recoverable; a row
  // that survives its own purge is not.
  await deleteObjects(doomedKeys);

  const summary = {
    purgedProjects: projects.length,
    purgedPackages: packages.length,
    deletedObjects: doomedKeys.length,
  };
  console.log('[cron/purge-trash]', summary);
  return NextResponse.json(summary);
}
