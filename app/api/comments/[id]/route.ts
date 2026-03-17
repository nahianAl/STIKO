import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await sql`DELETE FROM comments WHERE id = ${params.id} RETURNING id`;
  if (!result[0]) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
