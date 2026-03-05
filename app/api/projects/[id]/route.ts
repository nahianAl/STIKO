import { NextRequest, NextResponse } from 'next/server';
import { getById, deleteItem } from '@/lib/db';
import { Project } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = getById<Project>('projects', params.id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const deleted = deleteItem<Project>('projects', params.id);
  if (!deleted) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
