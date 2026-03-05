import { NextRequest, NextResponse } from 'next/server';
import { deleteItem } from '@/lib/db';
import { Comment } from '@/lib/types';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const deleted = deleteItem<Comment>('comments', params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
