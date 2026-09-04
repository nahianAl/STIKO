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
