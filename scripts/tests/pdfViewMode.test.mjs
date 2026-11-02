import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_STORAGE_KEY,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  browserStorage,
  readStoredMode,
  writeStoredMode,
  effectiveMode,
  clampZoom,
  layoutPages,
  fitWidthScale,
  mostVisiblePage,
  pagesToRender,
  scrollTopForPage,
  anchoredScroll,
  scrollTopToReveal,
  cappedRenderScale,
} from '../../lib/pdf/viewMode.ts';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v) };
};
// What Safari private mode / blocked site data looks like: every call throws.
const throwing = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

// Three 100×100 pages, 10px gap, no padding: tops 0 / 110 / 220, bottoms 100 / 210 / 320.
const square = { width: 100, height: 100 };
const three = layoutPages([square, square, square], 1, 10, 0);

test('readStoredMode is "scroll" only for exactly "scroll"', () => {
  assert.equal(readStoredMode(memStorage({ [MODE_STORAGE_KEY]: 'scroll' })), 'scroll');
  assert.equal(readStoredMode(memStorage({ [MODE_STORAGE_KEY]: 'single' })), 'single');
  assert.equal(readStoredMode(memStorage({ [MODE_STORAGE_KEY]: 'SCROLL' })), 'single');
  assert.equal(readStoredMode(memStorage()), 'single');
  assert.equal(readStoredMode(null), 'single');
  assert.equal(readStoredMode(throwing), 'single');
});

test('writeStoredMode round-trips and never throws', () => {
  const s = memStorage();
  writeStoredMode(s, 'scroll');
  assert.equal(readStoredMode(s), 'scroll');
  writeStoredMode(s, 'single');
  assert.equal(readStoredMode(s), 'single');
  assert.doesNotThrow(() => writeStoredMode(throwing, 'scroll'));
  assert.doesNotThrow(() => writeStoredMode(null, 'scroll'));
});

test('browserStorage is null outside a browser', () => {
  assert.equal(browserStorage(), null);
});

test('effectiveMode: the sidebar decides; 1 page and a session force single; 0 (loading) does not', () => {
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 12, annotating: false }), 'scroll');
  assert.equal(effectiveMode({ sidebarOpen: false, numPages: 12, annotating: false }), 'single');
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 1, annotating: false }), 'single');
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 12, annotating: true }), 'single');
  assert.equal(effectiveMode({ sidebarOpen: true, numPages: 0, annotating: false }), 'scroll');
});

test('clampZoom keeps zoom within [0.05, 5]', () => {
  assert.equal(clampZoom(0.01), 0.05);
  assert.equal(clampZoom(0.1), 0.1);
  assert.equal(clampZoom(9), 5);
  assert.equal(clampZoom(1.5), 1.5);
});

test('layoutPages stacks scaled pages with a fixed gap and padding', () => {
  const L = layoutPages([{ width: 100, height: 200 }, { width: 300, height: 100 }], 2, 16, 24);
  assert.deepEqual(L.pages, [
    { page: 1, top: 24, bottom: 424, width: 200, height: 400 },
    { page: 2, top: 440, bottom: 640, width: 600, height: 200 },
  ]);
  assert.equal(L.contentHeight, 664);
  assert.equal(L.contentWidth, 648);
  assert.deepEqual(layoutPages([], 1, 16, 24), { pages: [], contentWidth: 48, contentHeight: 0 });
});

test('fitWidthScale fits the widest page inside the padding, clamped', () => {
  assert.equal(fitWidthScale([{ width: 100, height: 1 }, { width: 400, height: 1 }], 848, 24), 2);
  assert.equal(fitWidthScale([], 800, 24), 1);
  assert.equal(fitWidthScale([{ width: 100, height: 1 }], 0, 24), 1);
  assert.equal(fitWidthScale([{ width: 10, height: 1 }], 10048, 24), 5);
  // Large drawing sheets need a scale below the old 0.25 floor.
  assert.equal(fitWidthScale([{ width: 5000, height: 1 }], 1048, 24), 0.2);
  assert.equal(fitWidthScale([{ width: 100000, height: 1 }], 1048, 24), 0.05);
});

test('mostVisiblePage picks the page covering most of the viewport', () => {
  assert.equal(mostVisiblePage(three.pages, 0, 100, false), 1);
  assert.equal(mostVisiblePage(three.pages, 60, 160, false), 2);
  // Tie (50px each) goes to the lower page number.
  assert.equal(mostVisiblePage(three.pages, 50, 160, false), 1);
  // Viewport entirely inside a gap: the nearest page.
  assert.equal(mostVisiblePage(three.pages, 102, 109, false), 2);
  // Scrolled to the very end: the last page, even if it is not the biggest slice.
  assert.equal(mostVisiblePage(three.pages, 150, 320, true), 3);
  assert.equal(mostVisiblePage([], 0, 100, false), 1);
});

test('pagesToRender returns pages within the viewport plus overscan', () => {
  assert.deepEqual([...pagesToRender(three.pages, 115, 205, 0)], [2]);
  assert.deepEqual([...pagesToRender(three.pages, 115, 205, 20)], [1, 2, 3]);
});

test('scrollTopForPage puts the page top one gap below the top edge', () => {
  assert.equal(scrollTopForPage(three, 1, 10), 0);
  assert.equal(scrollTopForPage(three, 3, 10), 210);
  assert.equal(scrollTopForPage(three, 9, 10), 0);
});

test('anchoredScroll keeps the point under the pointer fixed across a zoom', () => {
  // Pointer at (175, 50) over scrollTop 140: content y 190 = 80px into page 2; content x 175 =
  // 75% across page 1's 100px box, which is centred in a 300px column (100..200).
  const base = { before: three, scrollLeft: 0, scrollTop: 140, pointerX: 175, pointerY: 50, viewportWidth: 300 };

  const x2 = layoutPages([square, square, square], 2, 10, 0); // tops 0/210/420, width 200
  assert.deepEqual(anchoredScroll({ ...base, after: x2, ratio: 2 }), { scrollLeft: 25, scrollTop: 320 });
  // Check: page 2 top 210 + 80×2 = 370 = 320 + 50. Page box 50..250, 75% = 200 = 25 + 175.

  const x4 = layoutPages([square, square, square], 4, 10, 0); // tops 0/410/820, width 400 > viewport
  assert.deepEqual(anchoredScroll({ ...base, after: x4, ratio: 4 }), { scrollLeft: 125, scrollTop: 680 });
  // Check: 410 + 80×4 = 730 = 680 + 50. Column is now 400 wide, page box 0..400, 75% = 300 = 125 + 175.

  // Never negative.
  const out = anchoredScroll({ ...base, scrollTop: 0, pointerY: 0, pointerX: 0, after: layoutPages([square], 0.5, 10, 0), before: layoutPages([square], 1, 10, 0), ratio: 0.5 });
  assert.ok(out.scrollLeft >= 0 && out.scrollTop >= 0);
});

test('scrollTopToReveal scrolls only when the item is out of view', () => {
  assert.equal(scrollTopToReveal(50, 90, 0, 100), null);
  assert.equal(scrollTopToReveal(120, 160, 0, 100), 60);
  assert.equal(scrollTopToReveal(10, 40, 20, 100), 10);
});

test('cappedRenderScale stays under the canvas area and side limits', () => {
  assert.equal(cappedRenderScale(1000, 1000, 2), 2);
  const s = cappedRenderScale(4000, 3000, 5);
  assert.ok(Math.abs(s - Math.sqrt(MAX_CANVAS_PIXELS / 12_000_000)) < 1e-9);
  assert.ok(4000 * 3000 * s * s <= MAX_CANVAS_PIXELS + 1);
  assert.equal(cappedRenderScale(20000, 10, 5), MAX_CANVAS_SIDE / 20000);
  assert.equal(cappedRenderScale(0, 10, 3), 3);
});
