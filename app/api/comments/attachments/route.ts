import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { getUploadPresignedUrl } from '@/lib/s3';
import { validateAttachmentRequest } from '@/lib/attachmentUpload';

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

  const storageKey = `comment-attachments/${uuidv4()}${validated.extension}`;

  const presignedUrl = await getUploadPresignedUrl(
    storageKey,
    validated.contentType,
    300,
    validated.size
  );

  return NextResponse.json({ presignedUrl, storageKey }, { status: 200 });
}
