import { NextRequest, NextResponse } from 'next/server';
import { getById } from '@/lib/db';
import { FileRecord } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const file = getById<FileRecord>('files', params.id);
  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
  return NextResponse.json(file);
}
