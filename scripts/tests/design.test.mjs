import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_ORDER,
  NOTES,
  tagSwatch,
  avatarSwatch,
  initials,
  fileChip,
  derivePackageName,
  relativeTime,
} from '../../lib/design.ts';

test('every note has a pastel, a paired text colour and an accent', () => {
  for (const name of NOTE_ORDER) {
    const swatch = NOTES[name];
    assert.match(swatch.pastel, /^#[0-9A-Fa-f]{6}$/, `${name} pastel`);
    assert.match(swatch.text, /^#[0-9A-Fa-f]{6}$/, `${name} text`);
    assert.match(swatch.accent, /^#[0-9A-Fa-f]{6}$/, `${name} accent`);
  }
});

test('the same tag is always the same colour', () => {
  assert.deepEqual(tagSwatch('Structural'), tagSwatch('Structural'));
  // 01 says the tag is freeform text the coordinator types, so casing and
  // stray whitespace must not split one tag into two colours.
  assert.deepEqual(tagSwatch('Structural'), tagSwatch('  structural '));
});

test('a person keeps their avatar colour across calls', () => {
  assert.deepEqual(avatarSwatch('user-abc'), avatarSwatch('user-abc'));
});

test('initials take the first two words, then fall back', () => {
  assert.equal(initials('Marcus Reyes'), 'MR');
  assert.equal(initials('Lena'), 'LE');
  assert.equal(initials('jordan@example.com'), 'JO');
});

test('an avatar is never blank', () => {
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
});

test('file chips colour the known types and grey the rest', () => {
  assert.equal(fileChip('L3-Plan.pdf').label, 'PDF');
  assert.equal(fileChip('L3-Plan.pdf').fg, '#B23A52');
  assert.equal(fileChip('model.glb').fg, '#6b4fc4');
  assert.equal(fileChip('site.dwg').fg, '#4B7A28');
  // Unrecognised falls through to grey rather than a palette colour it has no
  // business in.
  assert.equal(fileChip('notes.xyz').bg, '#EFEFF4');
  assert.equal(fileChip('notes.xyz').label, 'XYZ');
});

test('a file with no extension still gets a chip', () => {
  assert.equal(fileChip('README').label, 'FILE');
});

test('a shared folder names the package', () => {
  assert.equal(
    derivePackageName([
      'Level 3 Structural/plan.pdf',
      'Level 3 Structural/section.pdf',
    ]),
    'Level 3 Structural'
  );
});

test('a single file names the package after itself', () => {
  assert.equal(derivePackageName(['L3-Structural-Plan.pdf']), 'L3 Structural Plan');
});

test('a common filename prefix names the package', () => {
  assert.equal(
    derivePackageName(['podium-plan.pdf', 'podium-section.pdf']),
    'podium'
  );
});

test('unrelated files produce no name rather than a bad one', () => {
  assert.equal(derivePackageName(['alpha.pdf', 'zulu.dwg']), '');
});

test('no files produce no name', () => {
  assert.equal(derivePackageName([]), '');
});

test('relative time reads the way the screens write it', () => {
  const now = Date.parse('2026-07-27T12:00:00Z');
  const ago = (ms) => relativeTime(new Date(now - ms).toISOString(), now);
  assert.equal(ago(5 * 1000), 'just now');
  assert.equal(ago(5 * 60 * 1000), '5m ago');
  assert.equal(ago(2 * 60 * 60 * 1000), '2h ago');
  assert.equal(ago(3 * 24 * 60 * 60 * 1000), '3d ago');
});

test('an unparseable timestamp renders as nothing, not "NaN ago"', () => {
  assert.equal(relativeTime('not a date'), '');
});
