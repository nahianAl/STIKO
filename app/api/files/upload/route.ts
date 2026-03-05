import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { addItem } from '@/lib/db';
import { FileRecord } from '@/lib/types';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const versionId = formData.get('versionId') as string;
  const files = formData.getAll('files') as File[];

  const createdRecords: FileRecord[] = [];

  for (const file of files) {
    const filename = file.name;
    const storageKey = `uploads/${versionId}/${filename}`;
    const savePath = path.join(process.cwd(), 'public', 'uploads', versionId, filename);

    fs.mkdirSync(path.dirname(savePath), { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    fs.writeFileSync(savePath, Buffer.from(arrayBuffer));

    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const fileType = file.type || ext;

    const record: FileRecord = {
      id: uuidv4(),
      versionId,
      filename,
      storageKey,
      fileSize: file.size,
      fileType,
      createdAt: new Date().toISOString(),
    };

    addItem('files', record);
    createdRecords.push(record);
  }

  return NextResponse.json(createdRecords, { status: 201 });
}
