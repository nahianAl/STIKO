import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { readCollection, addItem } from '@/lib/db';
import { Project } from '@/lib/types';

export async function GET() {
  const projects = readCollection<Project>('projects');
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const { name } = await request.json();
  const project: Project = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
  };
  addItem('projects', project);
  return NextResponse.json(project, { status: 201 });
}
