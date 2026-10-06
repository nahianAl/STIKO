import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { mentionableUsers } from '@/lib/mentionable';

/**
 * Who the caller may @mention on this file.
 *
 * Built on the server because only the server knows each person's scope, and
 * filtering in the browser would mean shipping every scope to it. The list
 * necessarily shows who can open THIS file — the product decision is that only
 * people who can open it can be mentioned — so a scoped commenter who compares
 * it with the roster can tell which reviewers cannot open this submission. It
 * reveals that and nothing more: no emails, no scopes, nobody outside the
 * file. The picker shows a name and a company.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  }

  const access = await getFileAccess(userId, fileId);
  // Not an oracle: a nonexistent file and an out-of-scope one both answer 404.
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Only someone composing a comment needs this list.
  if (!access.canComment) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const people = await mentionableUsers(fileId);
  return NextResponse.json(people.filter((p) => p.userId !== userId));
}
