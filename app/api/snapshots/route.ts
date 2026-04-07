import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { s3, BUCKET } from '@/lib/s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export async function POST(request: NextRequest) {
  const { dataUrl } = await request.json();

  if (!dataUrl || typeof dataUrl !== 'string') {
    return NextResponse.json({ error: 'dataUrl is required' }, { status: 400 });
  }

  // Parse base64 data URL: "data:image/jpeg;base64,/9j/4AAQ..."
  const match = dataUrl.match(/^data:([\w/+-]+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json({ error: 'Invalid data URL format' }, { status: 400 });
  }

  const contentType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const storageKey = `snapshots/${uuidv4()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return NextResponse.json({ storageKey }, { status: 201 });
}
