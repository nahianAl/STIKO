import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HIGHLIGHT_WIDTH_FACTOR,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_COLOR,
  DEFAULT_MARKUP_COLOR,
  highlightStrokeWidth,
  colorOnArmHighlight,
} from '../../lib/markup/highlight.ts';
import { PALETTE } from '../../lib/commentColors.ts';

test('highlighter is a wide, translucent stroke', () => {
  assert.equal(highlightStrokeWidth(4), 4 * HIGHLIGHT_WIDTH_FACTOR);
  assert.ok(HIGHLIGHT_OPACITY > 0 && HIGHLIGHT_OPACITY < 1);
});

test('highlighter yellow is the palette yellow, so the swatch row shows it selected', () => {
  assert.equal(PALETTE.find((p) => p.name === 'yellow').accent.toLowerCase(), HIGHLIGHT_COLOR.toLowerCase());
});

test('arming the highlighter on the default colour switches to yellow', () => {
  assert.equal(colorOnArmHighlight(DEFAULT_MARKUP_COLOR), HIGHLIGHT_COLOR);
  assert.equal(colorOnArmHighlight(DEFAULT_MARKUP_COLOR.toLowerCase()), HIGHLIGHT_COLOR);
});

test('arming the highlighter keeps any colour the user chose', () => {
  assert.equal(colorOnArmHighlight('#4A9FE0'), '#4A9FE0');
  assert.equal(colorOnArmHighlight('#123456'), '#123456');
});
