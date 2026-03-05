import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { addItem, filterBy } from '@/lib/db';
import { Version } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const portalId = searchParams.get('portalId');
  const versions = filterBy<Version>('versions', (v) => v.portalId === portalId);
  versions.sort((a, b) => b.versionNumber - a.versionNumber);
  return NextResponse.json(versions);
}

export async function POST(request: NextRequest) {
  const { portalId } = await request.json();
  const existing = filterBy<Version>('versions', (v) => v.portalId === portalId);
  const maxVersion = existing.reduce((max, v) => Math.max(max, v.versionNumber), 0);
  const version: Version = {
    id: uuidv4(),
    portalId,
    versionNumber: maxVersion + 1,
    createdAt: new Date().toISOString(),
  };
  addItem('versions', version);
  return NextResponse.json(version, { status: 201 });
}
