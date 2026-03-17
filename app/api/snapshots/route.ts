import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl, getPublicUrl } from '@/lib/s3';

export async function POST(request: NextRequest) {
  const { projectId, portalId, contentType = 'image/jpeg' } = await request.json();

  const storageKey = `snapshots/${projectId}/${portalId}/${uuidv4()}.jpg`;
  const presignedUrl = await getUploadPresignedUrl(storageKey, contentType);
  const publicUrl = getPublicUrl(storageKey);

  return NextResponse.json({ presignedUrl, publicUrl }, { status: 201 });
}
