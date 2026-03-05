import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { addItem, filterBy } from '@/lib/db';
import { Comment } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  const comments = filterBy<Comment>('comments', (c) => c.fileId === fileId);
  return NextResponse.json(comments);
}

export async function POST(request: NextRequest) {
  const { fileId, content, xPosition, yPosition, parentCommentId, author } = await request.json();
  const comment: Comment = {
    id: uuidv4(),
    fileId,
    parentCommentId: parentCommentId ?? null,
    content,
    xPosition: xPosition ?? null,
    yPosition: yPosition ?? null,
    author,
    createdAt: new Date().toISOString(),
  };
  addItem('comments', comment);
  return NextResponse.json(comment, { status: 201 });
}
