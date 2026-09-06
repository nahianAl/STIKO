import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { s3, BUCKET } from '@/lib/s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { parseSnapshotDataUrl } from '@/lib/snapshotUpload';

export async function POST(request: NextRequest) {
  // This route stays listed in middleware's PUBLIC_PATHS and does its own auth,
  // returning JSON rather than a redirect. Removing it from that list would make
  // middleware 307 to /login; fetch follows redirects, so the caller would get a
  // 200 of HTML and believe the upload succeeded. Same reasoning as /api/versions.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { dataUrl } = await request.json();

  const parsed = parseSnapshotDataUrl(dataUrl);
  if (!parsed.ok) {
    const status = parsed.reason === 'too_large' ? 413 : 400;
    const message = {
      malformed: 'dataUrl must be a base64 image data URL',
      unsupported_type: 'Snapshots must be JPEG or PNG',
      too_large: 'Snapshot is too large',
    }[parsed.reason];

    return NextResponse.json({ error: message }, { status });
  }

  const storageKey = `snapshots/${uuidv4()}.${parsed.extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: parsed.buffer,
      ContentType: parsed.contentType,
    })
  );

  return NextResponse.json({ storageKey }, { status: 201 });
}
