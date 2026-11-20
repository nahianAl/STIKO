import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undoKeyOf, ownsTextUndo } from '../../lib/undo/shortcut.ts';

const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

test('Cmd+Z and Ctrl+Z undo', () => {
  assert.equal(undoKeyOf(key('z', { metaKey: true })), 'undo');
  assert.equal(undoKeyOf(key('z', { ctrlKey: true })), 'undo');
});

test('Shift+Cmd+Z, Ctrl+Shift+Z and Ctrl+Y redo; Shift reports a capital Z', () => {
  assert.equal(undoKeyOf(key('Z', { metaKey: true, shiftKey: true })), 'redo');
  assert.equal(undoKeyOf(key('z', { metaKey: true, shiftKey: true })), 'redo');
  assert.equal(undoKeyOf(key('Z', { ctrlKey: true, shiftKey: true })), 'redo');
  assert.equal(undoKeyOf(key('y', { ctrlKey: true })), 'redo');
});

test('not a shortcut: bare Z, Alt combos, Cmd+Y, IME composition', () => {
  assert.equal(undoKeyOf(key('z')), null);
  assert.equal(undoKeyOf(key('z', { metaKey: true, altKey: true })), null);
  assert.equal(undoKeyOf(key('y', { metaKey: true })), null);
  assert.equal(undoKeyOf(key('y', { ctrlKey: true, shiftKey: true })), null);
  assert.equal(undoKeyOf(key('z', { metaKey: true, isComposing: true })), null);
  assert.equal(undoKeyOf(key('x', { metaKey: true })), null);
});

test('text fields keep their own undo', () => {
  assert.equal(ownsTextUndo({ tagName: 'INPUT' }), true);
  assert.equal(ownsTextUndo({ tagName: 'textarea' }), true);
  assert.equal(ownsTextUndo({ tagName: 'SELECT' }), true);
  assert.equal(ownsTextUndo({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(ownsTextUndo({ tagName: 'BUTTON' }), false);
  assert.equal(ownsTextUndo({ tagName: 'BODY' }), false);
  assert.equal(ownsTextUndo(null), false);
});
