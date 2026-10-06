import { sql } from '@/lib/db';
import { portalForFile } from '@/lib/access';
import { mentionLabel, type MentionablePerson } from '@/lib/mentions';

/**
 * Everyone who can open this file: the project owner, its coordinators, and
 * the package's participants whose scope covers the file's submission.
 *
 * Uploaders always. Commenters and viewers only when the submission is
 * published AND their scope covers it, because a draft is visible only to
 * whoever can upload (see app/api/versions/route.ts) and a mention emails
 * the file name and the comment text, which cannot be recalled. Project
 * members only when they are the owner or a coordinator, matching
 * getPackageAccess. A mention can therefore never reach someone who would
 * get a 404 from its link.
 *
 * Includes the caller. Whoever asks decides whether to drop themselves.
 */
export async function mentionableUsers(fileId: string): Promise<MentionablePerson[]> {
  const location = await portalForFile(fileId);
  if (!location) return [];

  const rows = await sql`
    SELECT u.id AS "userId", u.name, u.email, u.company, 'owner' AS role, 0 AS sort_order
    FROM portals po
    JOIN projects pr ON pr.id = po.project_id
    JOIN users u ON u.id = pr.owner_id
    WHERE po.id = ${location.portalId}
    UNION ALL
    SELECT u.id, u.name, u.email, u.company, pm.role, 1
    FROM portals po
    JOIN project_members pm ON pm.project_id = po.project_id
    JOIN users u ON u.id = pm.user_id
    WHERE po.id = ${location.portalId}
      AND pm.role = 'coordinator'
    UNION ALL
    SELECT u.id, u.name, u.email, u.company, pa.role, 2
    FROM participants pa
    JOIN users u ON u.id = pa.user_id
    JOIN versions v ON v.id = ${location.versionId}
    WHERE pa.portal_id = ${location.portalId}
      AND (
        pa.role = 'uploader'
        OR (
          v.published_at IS NOT NULL
          AND (
            pa.all_versions = TRUE
            OR EXISTS (
              SELECT 1 FROM participant_versions pv
              WHERE pv.participant_id = pa.id AND pv.version_id = ${location.versionId}
            )
          )
        )
      )
    ORDER BY sort_order, name NULLS LAST
  `;

  // One person can arrive by more than one route (an owner who is also listed
  // as a member). The first row wins, and the ordering above puts their
  // strongest role first.
  const seen = new Set<string>();
  const people: MentionablePerson[] = [];
  for (const r of rows) {
    const userId = r.userId as string;
    if (seen.has(userId)) continue;
    seen.add(userId);
    people.push({
      userId,
      label: mentionLabel(r.name as string | null, r.email as string),
      company: (r.company as string | null) ?? null,
      role: r.role as string,
    });
  }
  return people;
}
