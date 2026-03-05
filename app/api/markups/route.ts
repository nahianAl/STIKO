import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { addItem, filterBy } from '@/lib/db';
import { Markup } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  const markups = filterBy<Markup>('markups', (m) => m.fileId === fileId);
  return NextResponse.json(markups);
}

export async function POST(request: NextRequest) {
  const { fileId, type, data, style } = await request.json();
  const markup: Markup = {
    id: uuidv4(),
    fileId,
    type,
    data,
    style,
    createdAt: new Date().toISOString(),
  };
  addItem('markups', markup);
  return NextResponse.json(markup, { status: 201 });
}
