import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPresignedUrl } from '@/lib/s3';

export async function POST(request: NextRequest) {
  const { filename, contentType } = await request.json();

  if (!filename || !contentType) {
    return NextResponse.json({ error: 'filename and contentType are required' }, { status: 400 });
  }

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const storageKey = `comment-attachments/${uuidv4()}${ext}`;

  const presignedUrl = await getUploadPresignedUrl(storageKey, contentType);

  return NextResponse.json({ presignedUrl, storageKey }, { status: 200 });
}
