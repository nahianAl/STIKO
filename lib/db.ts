import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

function getFilePath(collection: string): string {
  return path.join(DATA_DIR, `${collection}.json`);
}

export function readCollection<T>(collection: string): T[] {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function writeCollection<T>(collection: string, data: T[]): void {
  const filePath = getFilePath(collection);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function addItem<T>(collection: string, item: T): T {
  const data = readCollection<T>(collection);
  data.push(item);
  writeCollection(collection, data);
  return item;
}

export function getById<T extends { id: string }>(collection: string, id: string): T | undefined {
  return readCollection<T>(collection).find(item => item.id === id);
}

export function updateItem<T extends { id: string }>(collection: string, id: string, updates: Partial<T>): T | undefined {
  const data = readCollection<T>(collection);
  const index = data.findIndex(item => item.id === id);
  if (index === -1) return undefined;
  data[index] = { ...data[index], ...updates };
  writeCollection(collection, data);
  return data[index];
}

export function deleteItem<T extends { id: string }>(collection: string, id: string): boolean {
  const data = readCollection<T>(collection);
  const filtered = data.filter(item => item.id !== id);
  if (filtered.length === data.length) return false;
  writeCollection(collection, filtered);
  return true;
}

export function filterBy<T>(collection: string, predicate: (item: T) => boolean): T[] {
  return readCollection<T>(collection).filter(predicate);
}
