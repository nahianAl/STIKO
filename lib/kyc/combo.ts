/** Pure rules for components/welcome/ComboSelect.tsx. */
import { matchesSearch } from './profile.ts';

export function toggleValue(values: string[], id: string, max: number): string[] {
  if (values.includes(id)) return values.filter((v) => v !== id);
  if (values.length >= max) return values;
  return [...values, id];
}

/** Same array back when nothing moves, so React skips the update. */
export function moveValue(values: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= values.length || to >= values.length) return values;
  const next = [...values];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function visibleOptions<T extends { label: string; synonyms?: readonly string[] }>(
  options: readonly T[],
  query: string
): T[] {
  return options.filter((o) => matchesSearch(o, query));
}

export function nextActive(current: number, count: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): number {
  if (count <= 0) return 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (current + 1) % count;
  return (current - 1 + count) % count;
}
