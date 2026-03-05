import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { readCollection, addItem, filterBy } from '@/lib/db';
import { Portal } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (projectId) {
    const portals = filterBy<Portal>('portals', (p) => p.projectId === projectId);
    return NextResponse.json(portals);
  }

  const portals = readCollection<Portal>('portals');
  return NextResponse.json(portals);
}

export async function POST(request: NextRequest) {
  const { name, projectId } = await request.json();
  const portal: Portal = {
    id: uuidv4(),
    projectId,
    name,
    createdAt: new Date().toISOString(),
  };
  addItem('portals', portal);
  return NextResponse.json(portal, { status: 201 });
}
