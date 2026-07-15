// lib/commentColors.ts
// Single source of truth for sticky-note pastel colors used by comment cards,
// avatars, and teardrop pins so a comment's pin, card accent, and avatar always match.

export interface Pastel {
  name: string;
  swatch: string; // pastel fill (swatch chip, pin fill, avatar bg)
  dark: string;   // dark text on the pastel (number in pin, initials in avatar)
  accent: string; // saturated variant (card left-accent border, markup stroke)
}

// Order matches the toolbar swatch order in the mock.
export const PALETTE: Pastel[] = [
  { name: 'yellow', swatch: '#FFFCCE', dark: '#7A5E00', accent: '#FFCF2E' },
  { name: 'red',    swatch: '#FFE2E2', dark: '#B23A52', accent: '#FF6B6B' },
  { name: 'blue',   swatch: '#E2F2FF', dark: '#2f7fc4', accent: '#4A9FE0' },
  { name: 'green',  swatch: '#EDFFDA', dark: '#4B7A28', accent: '#7BC24A' },
  { name: 'purple', swatch: '#EBE4FD', dark: '#6b4fc4', accent: '#9A82F0' },
];

/** Deterministic, total mapping of any string key to a palette entry. */
export function paletteForKey(key: string): Pastel {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function paletteForComment(c: { author: string }): Pastel {
  return paletteForKey(c.author || 'Anonymous');
}
