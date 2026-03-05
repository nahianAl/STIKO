import { NextRequest, NextResponse } from 'next/server';
import { filterBy } from '@/lib/db';
import { FileRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const versionId = searchParams.get('versionId');
  const files = filterBy<FileRecord>('files', (f) => f.versionId === versionId);
  return NextResponse.json(files);
}
