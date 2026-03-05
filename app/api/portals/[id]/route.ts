import { NextRequest, NextResponse } from 'next/server';
import { getById, deleteItem } from '@/lib/db';
import { Portal } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const portal = getById<Portal>('portals', params.id);
  if (!portal) {
    return NextResponse.json({ error: 'Portal not found' }, { status: 404 });
  }
  return NextResponse.json(portal);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const deleted = deleteItem<Portal>('portals', params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Portal not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
