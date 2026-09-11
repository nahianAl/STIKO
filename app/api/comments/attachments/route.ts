import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { getUploadPresignedUrl } from '@/lib/s3';
import { validateAttachmentRequest } from '@/lib/attachmentUpload';
import { getFileAccess } from '@/lib/access';

export async function POST(request: NextRequest) {
  // This route had no auth() call at all, and middleware does not cover it:
  // '/api/comments' in PUBLIC_PATHS is a prefix match, so this path inherited
  // the exemption meant for the comments API. Anyone on the internet could mint
  // unlimited presigned write URLs into the bucket.
  //
  // It stays under that exemption and returns JSON rather than redirecting, for
  // the same reason as /api/versions: fetch follows a 307 to /login and reads
  // the resulting HTML 200 as success.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validated = validateAttachmentRequest(await request.json());
  if (!validated.ok) {
    const status = validated.reason === 'too_large' ? 413 : 400;
    const message = {
      malformed: 'filename, contentType and a positive integer size are required',
      unsupported_type: 'That file type cannot be attached',
      too_large: 'Attachment is too large',
    }[validated.reason];

    return NextResponse.json({ error: message }, { status });
  }

  // auth() alone only established that SOMEONE was logged in. Signup is open, so
  // that let any account mint unlimited 25MB presigned writes into the bucket
  // without belonging to a single package. An attachment is only ever meaningful
  // hanging off a comment, so the right bound is the same one /api/comments uses:
  // you must be able to see the file, and you must be able to comment on it.
  //
  // getFileAccess also enforces version scoping, so a commenter invited to one
  // version cannot mint writes by naming a file in another.
  const access = await getFileAccess(session.user.id, validated.fileId);
  // 404 rather than 403 for a non-member, matching /api/comments: whether a given
  // file exists is itself not public information.
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canComment) {
    return NextResponse.json(
      { error: 'Your role on this package is view-only' },
      { status: 403 }
    );
  }

  const storageKey = `comment-attachments/${uuidv4()}${validated.extension}`;

  const presignedUrl = await getUploadPresignedUrl(
    storageKey,
    validated.contentType,
    300,
    validated.size
  );

  return NextResponse.json({ presignedUrl, storageKey }, { status: 200 });
}
