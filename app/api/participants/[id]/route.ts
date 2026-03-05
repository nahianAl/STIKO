import { NextRequest, NextResponse } from 'next/server';
import { deleteItem } from '@/lib/db';
import { Participant } from '@/lib/types';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const deleted = deleteItem<Participant>('participants', params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
