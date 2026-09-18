import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { storageKeysForFiles } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';
import { TRASH_RETENTION_DAYS } from '@/lib/trash';

// The default Vercel maxDuration is not enough headroom for a batch of
// PURGE_BATCH_SIZE ids plus their cascades plus a chunked deleteObjects walk.
// 60s is the platform ceiling this app can use without a plan change.
export const maxDuration = 60;

// How many expired portals, and how many expired projects, one run resolves.
// Unbounded was the bug: the first production run faces up to
// TRASH_RETENTION_DAYS of accumulated trash at once, with no way to bound how
// long the handler runs before Vercel kills it. Filling this batch and
// leaving the remainder for tomorrow's run is correct and expected — see the
// `filled` field on the response, which is how a reader tells "trash fully
// drained" from "more waiting."
const PURGE_BATCH_SIZE = 500;

// How many S3 keys go into one deleteObjects call. deleteObjects (lib/s3.ts)
// fans out one DeleteObjectCommand per key via an unbounded Promise.all, so
// without chunking here, a full batch's worth of keys would all be in flight
// at once. Chunked and awaited sequentially instead, so at most this many
// DELETE requests are ever outstanding together.
const S3_DELETE_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Hard-delete everything past its window, and free its storage.
 *
 * Cleanup only. Expiry is computed at read time, so an expired item is already
 * invisible and unrestorable whether or not this has run — a missed schedule
 * costs storage, not correctness. That is deliberate: migrations here have been
 * forgotten twice and there is no staging environment to catch a silent
 * scheduler failure.
 *
 * Idempotent, and safe to run twice concurrently: every DELETE below is
 * guarded on id lists resolved from the same window it selects by, so a
 * second run either finds an already-shrunk candidate set or nothing.
 *
 * Bounded, not exhaustive: each run resolves at most PURGE_BATCH_SIZE expired
 * portals and PURGE_BATCH_SIZE expired projects. A timeout mid-run can only
 * cost this batch's worth of newly-orphaned keys being retried tomorrow — see
 * the note above deleteObjects below for why that specific failure is the one
 * this design cannot allow to be permanent.
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

  // Resolved ONCE and reused as a bind parameter for every statement below.
  // The Neon HTTP driver auto-commits each tagged call — there is no
  // transaction spanning this handler — so three independent
  // `now() - cutoff` evaluations would each land a little later than the
  // last, and a row whose deleted_at falls in that sliver would be caught by
  // a later DELETE without ever appearing in an earlier SELECT, orphaning its
  // keys. Asking the database once keeps every statement judging the exact
  // same instant. This must stay a value read from Postgres's clock, never a
  // JS `Date` computed here — the two can disagree by unknown skew.
  const [{ ts }] = await sql`SELECT now() - ${cutoff}::interval AS ts`;

  // Expired portal ids, oldest first, bounded. A portal swept in by a project
  // delete carries the SAME deleted_at as its project (see the UPDATE in
  // app/api/projects/[id]/route.ts), so it is already <= ts here with no join
  // to `projects` needed to find it.
  const expiredPortals = await sql`
    SELECT id FROM portals
    WHERE deleted_at IS NOT NULL AND deleted_at <= ${ts}
    ORDER BY deleted_at ASC
    LIMIT ${PURGE_BATCH_SIZE}
  `;
  const portalIds = expiredPortals.map((p) => p.id as string);

  // Expired project ids, independently bounded — this batch and the one
  // above are two separate LIMITs, so a project can land in this batch while
  // one of its own portals misses the portal batch above (if there are more
  // than PURGE_BATCH_SIZE expired portals system-wide). The storage-key
  // query right below is written to cover that gap.
  const expiredProjects = await sql`
    SELECT id FROM projects
    WHERE deleted_at IS NOT NULL AND deleted_at <= ${ts}
    ORDER BY deleted_at ASC
    LIMIT ${PURGE_BATCH_SIZE}
  `;
  const projectIds = expiredProjects.map((p) => p.id as string);

  // Storage keys, collected BEFORE either DELETE below: afterwards the rows
  // naming them are gone. Matched on portal ids OR on portals belonging to a
  // doomed project id (not portal ids alone), precisely to cover the gap
  // noted above — a portal that misses this run's portal batch but whose
  // project is in this run's project batch still gets its files' keys
  // collected here, even though the portals DELETE below won't touch it (it
  // is removed later by the projects DELETE's cascade instead).
  //
  // This is NOT a complete accounting of everything this purge orphans. It
  // collects only files.storage_key and files.converted_storage_key
  // (storageKeysForFiles, lib/access.ts). Comment snapshots
  // (snapshots/{uuid}) and comment attachments (comment-attachments/{uuid})
  // cascade away with the same `files` rows but are deliberately excluded
  // from that function — see the note above storageKeysForFiles for why
  // collecting them would be a security bug, not an oversight. Those two
  // kinds of object are orphaned in the bucket permanently the moment this
  // purge runs, with nothing left in the database ever able to name them
  // again.
  // Casts on every ANY() below: these lists are EMPTY on the normal daily run
  // (nothing expired), and the Neon HTTP driver sends parameters as text, so
  // Postgres cannot infer an empty array's element type without help. Same
  // trap and same fix as scopeList in app/api/portals/[id]/activity/route.ts.
  const doomedFiles = await sql`
    SELECT f.id
    FROM files f
    JOIN versions v ON v.id = f.version_id
    JOIN portals po ON po.id = v.portal_id
    WHERE po.id = ANY(${portalIds}::text[])
       OR po.project_id = ANY(${projectIds}::text[])
  `;
  const doomedKeys = await storageKeysForFiles(
    doomedFiles.map((f) => f.id as string)
  );

  // Portals before projects — load-bearing, not stylistic. Every portal this
  // run will purge already has deleted_at <= ts (directly, or swept in with
  // its project's timestamp — see above), so this explicit DELETE catches
  // it first, up to the portal batch limit, and purgedPackages counts it.
  // Reverse the order and the projects DELETE's cascade would remove those
  // same portal rows first, silently, before this statement ever ran against
  // them — purgedPackages would under-report while nothing looks wrong.
  const packages = await sql`
    DELETE FROM portals WHERE id = ANY(${portalIds}::text[]) RETURNING id
  `;
  const projects = await sql`
    DELETE FROM projects WHERE id = ANY(${projectIds}::text[]) RETURNING id
  `;

  // Last, and never inside a transaction with the two DELETEs above: this
  // repo's rows-first ordering trades a bounded, self-healing database
  // residue for an unbounded, permanent storage residue — the same tradeoff
  // deleteObjects documents for its own callers (lib/s3.ts). A row that
  // somehow survives this run's purge is still expired tomorrow, because the
  // predicate is time-based and only ever widens, so the next run finds and
  // clears it. An object deleted from storage while a row still named it
  // would instead read to a user as their file vanishing out from under
  // them, with no delete of their own to explain it. deleteObjects also never
  // throws on a per-key failure (it logs and moves on — see lib/s3.ts), so a
  // storage outage here cannot roll back the DELETEs above even if it wanted
  // to; it also means storageKeysAttempted below is not proof those objects
  // are actually gone.
  //
  // Chunked and sequential rather than one call over the whole list, so at
  // most S3_DELETE_CHUNK_SIZE DeleteObjectCommands are ever in flight at
  // once — see the constant's comment above.
  for (const keyBatch of chunk(doomedKeys, S3_DELETE_CHUNK_SIZE)) {
    await deleteObjects(keyBatch);
  }

  const summary = {
    purgedProjects: projects.length,
    purgedPackages: packages.length,
    // Keys ATTEMPTED, not confirmed deleted. deleteObjects swallows every
    // per-key failure and only console.errors it, so this number stays
    // exactly the same whether R2 was fully reachable or entirely down. Do
    // not read it as "objects freed" — check the deleteObjects error logs
    // for that.
    storageKeysAttempted: doomedKeys.length,
    // True when a batch hit PURGE_BATCH_SIZE, meaning there is likely more
    // expired trash than this run resolved and tomorrow's run has work
    // waiting. False means this category's trash is fully caught up as of
    // `ts`. Needed because the counts above cannot distinguish "batch full"
    // from "batch happened to match trash exactly."
    filled: {
      packages: portalIds.length === PURGE_BATCH_SIZE,
      projects: projectIds.length === PURGE_BATCH_SIZE,
    },
  };
  console.log('[cron/purge-trash]', summary);
  return NextResponse.json(summary);
}
