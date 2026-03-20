import { NextRequest, NextResponse } from 'next/server';
import { getDownloadPresignedUrl } from '@/lib/s3';

export async function GET(request: NextRequest) {
  const storageKey = request.nextUrl.searchParams.get('key');

  if (!storageKey) {
    return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
  }

  const url = await getDownloadPresignedUrl(storageKey);
  return NextResponse.json({ url });
}
