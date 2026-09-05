import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoColors, ACCENTS, MAX_AUTO_COLORED } from '../../lib/model/autoColor.ts';

/** A PartNode shaped just enough for the ranking — autoColors reads key and triangles only. */
function part(key, triangles) {
  return { key, name: key, children: [], meshes: [], triangles };
}

test('the largest assembly stays grey and the next four take accents', () => {
  const parts = [
    part('0', 1000), part('1', 900), part('2', 800),
    part('3', 700), part('4', 600), part('5', 500),
  ];

  const colors = autoColors(parts, false);

  assert.equal(colors.has('0'), false, 'largest keeps the base grey');
  assert.deepEqual([...colors.keys()], ['1', '2', '3', '4']);
  assert.deepEqual([...colors.values()], [...ACCENTS]);
  assert.equal(colors.size, MAX_AUTO_COLORED);
});

test('a sixth assembly and beyond stay grey', () => {
  const parts = Array.from({ length: 12 }, (_, i) => part(String(i), 1000 - i));
  assert.equal(autoColors(parts, false).size, MAX_AUTO_COLORED);
});

test('ranking is by triangle count, not declaration order', () => {
  const parts = [part('0', 10), part('1', 5000), part('2', 20)];
  const colors = autoColors(parts, false);

  assert.equal(colors.has('1'), false, 'the biggest part is the one left grey');
  assert.deepEqual([...colors.keys()], ['2', '0']);
});

test('a model with one top-level assembly gets no colour at all', () => {
  assert.equal(autoColors([part('0', 500)], false).size, 0);
});

test('an empty model gets no colour', () => {
  assert.equal(autoColors([], false).size, 0);
});

test('a model with authored colours is left alone', () => {
  const parts = [part('0', 1000), part('1', 900), part('2', 800)];
  assert.equal(autoColors(parts, true).size, 0);
});

test('equal triangle counts break ties by key, so the result is deterministic', () => {
  const parts = [part('2', 100), part('0', 100), part('1', 100), part('3', 100)];

  const first = autoColors(parts, false);
  const second = autoColors([...parts].reverse(), false);

  assert.deepEqual([...first.entries()], [...second.entries()]);
  assert.equal(first.has('0'), false, 'lowest key wins the tie and stays grey');
});

test('only top-level assemblies are considered — children are never auto-coloured', () => {
  const wheel = { ...part('1', 900), children: [part('1/0', 500), part('1/1', 400)] };
  const colors = autoColors([part('0', 1000), wheel], false);

  assert.deepEqual([...colors.keys()], ['1']);
});

test('a lone top-level part with children descends and auto-colours the children', () => {
  // Shaped like stepToGlb's output: buildNode(result.root, 'root') wraps the whole
  // assembly in one stamped node, so buildPartTree hands back exactly one top-level
  // PartNode even though the real structure is one level down.
  const root = {
    ...part('0', 0),
    children: [
      part('0/0', 1000), part('0/1', 900), part('0/2', 800),
      part('0/3', 700), part('0/4', 600), part('0/5', 500),
    ],
  };

  const colors = autoColors([root], false);

  assert.equal(colors.has('0/0'), false, 'largest child keeps the base grey');
  assert.deepEqual([...colors.keys()], ['0/1', '0/2', '0/3', '0/4']);
  assert.deepEqual([...colors.values()], [...ACCENTS]);
});

test('a doubly-wrapped root descends twice before ranking', () => {
  const innerChildren = [part('0/0/0', 900), part('0/0/1', 800), part('0/0/2', 700)];
  const outer = {
    ...part('0', 0),
    children: [{ ...part('0/0', 0), children: innerChildren }],
  };

  const colors = autoColors([outer], false);

  assert.equal(colors.has('0/0/0'), false, 'largest grandchild keeps the base grey');
  assert.deepEqual([...colors.keys()], ['0/0/1', '0/0/2']);
});

test('a lone top-level part with NO children still gets nothing', () => {
  // Genuinely one part, nothing to differentiate from — unlike the wrapped-root cases
  // above, there is no substructure to descend into.
  assert.equal(autoColors([part('0', 500)], false).size, 0);
});

test('a flat multi-part model is unaffected by the wrapper-descend rule', () => {
  // parts.length !== 1 here, so the descend loop must never engage — this is the same
  // ranking the very first test in this file exercises, kept as an explicit regression
  // guard against the new wrapper-descending code touching the ordinary case.
  const parts = [
    part('0', 1000), part('1', 900), part('2', 800),
    part('3', 700), part('4', 600), part('5', 500),
  ];

  const colors = autoColors(parts, false);

  assert.equal(colors.has('0'), false, 'largest keeps the base grey');
  assert.deepEqual([...colors.keys()], ['1', '2', '3', '4']);
});
