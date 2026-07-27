/**
 * Shared design-system helpers. Values come from
 * stiko_handoff/02-design-system.md and 01-object-model.md.
 */

/** The five sticky notes, in palette order. */
export const NOTE_ORDER = ['yellow', 'red', 'blue', 'green', 'purple'] as const;
export type NoteColor = (typeof NOTE_ORDER)[number];

export interface NoteSwatch {
  /** Pastel fill. */
  pastel: string;
  /** Dark text that pairs with the pastel. */
  text: string;
  /** Saturated accent for left-borders, pin outlines and markup strokes. */
  accent: string;
}

export const NOTES: Record<NoteColor, NoteSwatch> = {
  // Purple has no accent of its own in the spec; it borrows the primary, which
  // is the nearest saturated neighbour and keeps strokes visible on white.
  yellow: { pastel: '#FFFCCE', text: '#7A5E00', accent: '#FFCF2E' },
  red: { pastel: '#FFE2E2', text: '#B23A52', accent: '#FF6B6B' },
  blue: { pastel: '#E2F2FF', text: '#2f7fc4', accent: '#4A9FE0' },
  green: { pastel: '#EDFFDA', text: '#4B7A28', accent: '#7BC24A' },
  purple: { pastel: '#EBE4FD', text: '#6b4fc4', accent: '#8094F5' },
};

/**
 * Stable, non-cryptographic string hash. Used to pin a tag or a person to the
 * same swatch every time — 01 requires the same tag to be the same colour
 * within a project, and an avatar to keep its colour across sessions.
 */
export function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0; // keep it a 32-bit int
  }
  return Math.abs(h);
}

/** Pick one of the five notes deterministically from any string. */
export function noteFor(input: string): NoteColor {
  return NOTE_ORDER[hashString(input) % NOTE_ORDER.length];
}

/** Swatch for a tag string (01: "the same tag is always the same colour"). */
export function tagSwatch(tag: string): NoteSwatch {
  return NOTES[noteFor(tag.trim().toLowerCase())];
}

/** Swatch for a person, keyed by their stable id. */
export function avatarSwatch(id: string): NoteSwatch {
  return NOTES[noteFor(id)];
}

/** Initials for an avatar: first letter of the first two words, else the first
 *  two letters. Falls back to '?' so an avatar is never blank. */
export function initials(nameOrEmail: string): string {
  const name = (nameOrEmail ?? '').trim();
  if (!name) return '?';
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const bare = name.split('@')[0];
  return bare.slice(0, 2).toUpperCase();
}

/**
 * File-type chip colours (02). Anything unrecognised falls through to grey
 * rather than being forced into a palette colour it doesn't belong in.
 */
const FILE_CHIP: Record<string, { bg: string; fg: string }> = {
  PDF: { bg: '#FFE2E2', fg: '#B23A52' },
  GLB: { bg: '#EBE4FD', fg: '#6b4fc4' },
  GLTF: { bg: '#EBE4FD', fg: '#6b4fc4' },
  STEP: { bg: '#EBE4FD', fg: '#6b4fc4' },
  STP: { bg: '#EBE4FD', fg: '#6b4fc4' },
  IMG: { bg: '#E2F2FF', fg: '#2f7fc4' },
  PNG: { bg: '#E2F2FF', fg: '#2f7fc4' },
  JPG: { bg: '#E2F2FF', fg: '#2f7fc4' },
  JPEG: { bg: '#E2F2FF', fg: '#2f7fc4' },
  DWG: { bg: '#EDFFDA', fg: '#4B7A28' },
  DXF: { bg: '#EDFFDA', fg: '#4B7A28' },
};

export function fileChip(filename: string): {
  label: string;
  bg: string;
  fg: string;
} {
  // Take the extension only when there actually is one — split('.').pop() on a
  // bare "README" hands back the whole name, which would render as the chip.
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toUpperCase() : '';
  const hit = FILE_CHIP[ext];
  return {
    // Long extensions would blow out a 9px chip, so anything unusual is
    // labelled generically rather than truncated mid-word.
    label: ext && ext.length <= 4 ? ext : 'FILE',
    bg: hit?.bg ?? '#EFEFF4',
    fg: hit?.fg ?? '#5A6076',
  };
}

/**
 * Derive a default package name from a set of filenames — 2c: "Named
 * automatically from your files". Prefers a common folder, then a common
 * filename prefix, and returns '' when the files share nothing, so the caller
 * can leave the field empty rather than inventing a bad name.
 */
export function derivePackageName(paths: string[]): string {
  if (paths.length === 0) return '';

  // A shared top-level folder is the strongest signal.
  const folders = paths.map((p) => (p.includes('/') ? p.split('/')[0] : null));
  if (folders[0] && folders.every((f) => f === folders[0])) {
    return cleanName(folders[0]);
  }

  if (paths.length === 1) {
    const base = paths[0].split('/').pop() ?? paths[0];
    return cleanName(base.replace(/\.[^.]+$/, ''));
  }

  // Otherwise fall back to the longest common prefix of the bare filenames.
  const names = paths.map((p) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, ''));
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  // A one- or two-character overlap is coincidence, not a name.
  const cleaned = cleanName(prefix);
  return cleaned.length >= 3 ? cleaned : '';
}

function cleanName(raw: string): string {
  return raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Relative time, in the terse form the screens use ("2h ago", "3d ago"). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
