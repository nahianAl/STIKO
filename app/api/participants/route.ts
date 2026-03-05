import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { addItem, filterBy } from '@/lib/db';
import { Participant } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const portalId = searchParams.get('portalId');
  const participants = filterBy<Participant>('participants', (p) => p.portalId === portalId);
  return NextResponse.json(participants);
}

export async function POST(request: NextRequest) {
  const { portalId, email, role } = await request.json();
  const participant: Participant = {
    id: uuidv4(),
    portalId,
    email,
    role,
    createdAt: new Date().toISOString(),
  };
  addItem('participants', participant);
  return NextResponse.json(participant, { status: 201 });
}
