import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUndoHistory, UNDO_CAPACITY } from '../../lib/undo/history.ts';

/** A fake domain: each step just logs what was run. */
function fake() {
  const log = [];
  const step = (domain, name) => ({
    domain,
    undo: () => { log.push(`undo ${name}`); },
    redo: () => { log.push(`redo ${name}`); },
  });
  return { log, step };
}

test('undo walks back newest first; redo walks forward', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  h.record(step('measure', 'b'));
  assert.equal((await h.undo()).status, 'done');
  assert.equal((await h.undo()).status, 'done');
  assert.equal((await h.undo()).status, 'empty');
  assert.equal((await h.redo()).status, 'done');
  assert.deepEqual(log, ['undo b', 'undo a', 'redo a']);
  assert.deepEqual(h.depth(), { undo: 1, redo: 1 });
});

test('recording after an undo throws the redo steps away', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  h.record(step('markup', 'a'));
  h.record(step('markup', 'b'));
  await h.undo();
  h.record(step('markup', 'c'));
  assert.deepEqual(h.depth(), { undo: 2, redo: 0 });
  assert.equal((await h.redo()).status, 'empty');
});

test('capacity drops the oldest step', async () => {
  const h = createUndoHistory(3);
  const { log, step } = fake();
  for (const n of ['a', 'b', 'c', 'd']) h.record(step('markup', n));
  await h.undo(); await h.undo(); await h.undo();
  assert.equal((await h.undo()).status, 'empty');
  assert.deepEqual(log, ['undo d', 'undo c', 'undo b']);
});

test('the default capacity is 200', () => {
  assert.equal(UNDO_CAPACITY, 200);
  const h = createUndoHistory();
  const { step } = fake();
  for (let i = 0; i < 250; i++) h.record(step('markup', String(i)));
  assert.deepEqual(h.depth(), { undo: 200, redo: 0 });
});

test('dropDomain removes one domain from both stacks and keeps the rest in order', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  h.record(step('measure', 'b'));
  h.record(step('markup', 'c'));
  h.record(step('section', 'd'));
  await h.undo(); // d -> redo
  h.dropDomain('markup');
  assert.deepEqual(h.depth(), { undo: 1, redo: 1 });
  await h.undo(); // b
  await h.redo(); // b
  await h.redo(); // d
  assert.deepEqual(log, ['undo d', 'undo b', 'redo b', 'redo d']);
});

test('a rejecting step stays where it was and is reported', async () => {
  const h = createUndoHistory();
  let fail = true;
  h.record({
    domain: 'model',
    undo: async () => { if (fail) throw new Error('500'); },
    redo: async () => {},
  });
  const out = await h.undo();
  assert.equal(out.status, 'failed');
  assert.equal(out.error.message, '500');
  assert.deepEqual(h.depth(), { undo: 1, redo: 0 });
  assert.equal(h.isBusy(), false);
  fail = false;
  assert.equal((await h.undo()).status, 'done');
  assert.deepEqual(h.depth(), { undo: 0, redo: 1 });
});

test('a second undo while a step is in flight is refused as busy', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  let release;
  h.record(step('markup', 'a'));
  h.record({ domain: 'model', undo: () => new Promise((r) => { release = r; }), redo: () => {} });
  const first = h.undo();
  assert.equal(h.isBusy(), true);
  assert.equal((await h.undo()).status, 'busy');
  assert.equal((await h.redo()).status, 'busy');
  release();
  assert.equal((await first).status, 'done');
  assert.equal(h.isBusy(), false);
  assert.deepEqual(h.depth(), { undo: 1, redo: 1 });
});

test('flushers run before undo, so a not-yet-recorded change is undone first', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  let pending = true;
  const unregister = h.registerFlush(() => {
    if (pending) { pending = false; h.record(step('markup', 'pending')); }
  });
  await h.undo();
  assert.deepEqual(log, ['undo pending']);
  unregister();
  await h.undo();
  assert.deepEqual(log, ['undo pending', 'undo a']);
});

test('a flush before redo that records a change empties redo', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  h.record(step('markup', 'a'));
  await h.undo();
  h.registerFlush(() => h.record(step('markup', 'new')));
  assert.equal((await h.redo()).status, 'empty');
});

test('clear empties both stacks', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  h.record(step('markup', 'a'));
  h.record(step('markup', 'b'));
  await h.undo();
  h.clear();
  assert.deepEqual(h.depth(), { undo: 0, redo: 0 });
});

test('a step dropped while its undo was in flight does not reappear on redo', async () => {
  const h = createUndoHistory();
  let release;
  h.record({ domain: 'model', undo: () => new Promise((r) => { release = r; }), redo: () => {} });
  const first = h.undo();
  h.clear();
  release();
  assert.equal((await first).status, 'done');
  assert.deepEqual(h.depth(), { undo: 0, redo: 0 });
});

test('a record during an in-flight undo forks the timeline: the undone step does not land on redo', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  let release;
  h.record(step('markup', 'a'));
  h.record({ domain: 'model', undo: () => new Promise((r) => { release = r; }), redo: () => {} });
  const first = h.undo();
  h.record(step('markup', 'c'));
  release();
  assert.equal((await first).status, 'done');
  assert.deepEqual(h.depth(), { undo: 2, redo: 0 });
  assert.equal((await h.redo()).status, 'empty');
});

test('a record during an in-flight redo keeps the redone step undoable, older than the new step', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  let release;
  h.record({
    domain: 'model',
    undo: () => { log.push('undo m'); },
    redo: () => new Promise((r) => { release = r; }),
  });
  await h.undo();
  const second = h.redo();
  h.record(step('markup', 'c'));
  release();
  assert.equal((await second).status, 'done');
  assert.deepEqual(h.depth(), { undo: 2, redo: 0 });
  await h.undo();
  await h.undo();
  assert.deepEqual(log, ['undo m', 'undo c', 'undo m']);
});

test('a failed redo leaves the step on redo', async () => {
  const h = createUndoHistory();
  let fail = true;
  h.record({
    domain: 'model',
    undo: async () => {},
    redo: async () => { if (fail) throw new Error('500'); },
  });
  assert.equal((await h.undo()).status, 'done');
  const out = await h.redo();
  assert.equal(out.status, 'failed');
  assert.equal(out.error.message, '500');
  assert.deepEqual(h.depth(), { undo: 0, redo: 1 });
  assert.equal(h.isBusy(), false);
  fail = false;
  assert.equal((await h.redo()).status, 'done');
  assert.deepEqual(h.depth(), { undo: 1, redo: 0 });
});

test('a guard blocks undo and redo and leaves both stacks untouched', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  h.record(step('markup', 'b'));
  await h.undo(); // b -> redo
  h.registerGuard(() => true);
  assert.deepEqual(await h.undo(), { status: 'blocked' });
  assert.deepEqual(await h.redo(), { status: 'blocked' });
  assert.deepEqual(h.depth(), { undo: 1, redo: 1 });
  assert.deepEqual(log, ['undo b']);
  assert.equal(h.isBusy(), false);
});

test('a guard receives the top step of the source stack and the direction', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  const seen = [];
  h.registerGuard((s, direction) => {
    seen.push({ domain: s?.domain, direction });
    return s?.domain === 'model';
  });
  h.record(step('markup', 'k'));
  h.record(step('model', 'm'));
  // A model step on top: blocked, and the guard was shown that step and the direction.
  assert.equal((await h.undo()).status, 'blocked');
  assert.deepEqual(seen, [{ domain: 'model', direction: 'undo' }]);
  assert.deepEqual(h.depth(), { undo: 2, redo: 0 });
  // Take the model step out; a markup step on top undoes fine.
  h.dropDomain('model');
  assert.equal((await h.undo()).status, 'done');
  assert.deepEqual(log, ['undo k']);
  // Redo shows the guard the REDO stack's top step.
  assert.equal((await h.redo()).status, 'done');
  assert.deepEqual(seen.slice(-2), [
    { domain: 'markup', direction: 'undo' },
    { domain: 'markup', direction: 'redo' },
  ]);
  // Nothing left to redo: the guard sees `undefined` and the empty answer stands.
  assert.equal((await h.redo()).status, 'empty');
  assert.deepEqual(seen[seen.length - 1], { domain: undefined, direction: 'redo' });
});

test('a guard that blocks only one domain lets another domain through, in both directions', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.registerGuard((s) => s?.domain === 'model');
  h.record(step('model', 'm'));
  h.record(step('markup', 'k'));
  assert.equal((await h.undo()).status, 'done'); // markup on top
  assert.equal((await h.undo()).status, 'blocked'); // model now on top
  assert.equal((await h.redo()).status, 'done'); // redo top is markup
  assert.deepEqual(log, ['undo k', 'redo k']);
});

test('unregistering a guard unblocks', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  const unregister = h.registerGuard(() => true);
  assert.equal((await h.undo()).status, 'blocked');
  unregister();
  assert.equal((await h.undo()).status, 'done');
  assert.deepEqual(log, ['undo a']);
});

test('beginExternal makes undo and redo busy until released', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  h.record(step('markup', 'b'));
  await h.undo();
  assert.equal(h.isBusy(), false);
  const release = h.beginExternal();
  assert.equal(h.isBusy(), true);
  assert.equal((await h.undo()).status, 'busy');
  assert.equal((await h.redo()).status, 'busy');
  assert.deepEqual(h.depth(), { undo: 1, redo: 1 });
  release();
  assert.equal(h.isBusy(), false);
  assert.equal((await h.redo()).status, 'done');
  assert.deepEqual(log, ['undo b', 'redo b']);
});

test('releasing an external hold twice releases it once', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  h.record(step('markup', 'a'));
  const first = h.beginExternal();
  const second = h.beginExternal();
  first();
  first(); // must not also release `second`
  assert.equal(h.isBusy(), true);
  assert.equal((await h.undo()).status, 'busy');
  second();
  assert.equal(h.isBusy(), false);
  assert.equal((await h.undo()).status, 'done');
});

test('isBusy is true for a running step even with no external hold', async () => {
  const h = createUndoHistory();
  let release;
  h.record({ domain: 'model', undo: () => new Promise((r) => { release = r; }), redo: () => {} });
  const release0 = h.beginExternal();
  release0();
  const first = h.undo();
  assert.equal(h.isBusy(), true);
  release();
  await first;
  assert.equal(h.isBusy(), false);
});

test('a guard is consulted after the flushes, so it sees a step a flush just recorded', async () => {
  const h = createUndoHistory();
  const { log, step } = fake();
  h.record(step('markup', 'a'));
  const seen = [];
  h.registerFlush(() => {
    if (log.length === 0 && h.depth().undo === 1) h.record(step('model', 'flushed'));
  });
  h.registerGuard((s) => { seen.push(s?.domain); return s?.domain === 'model'; });
  assert.equal((await h.undo()).status, 'blocked');
  assert.deepEqual(seen, ['model']);
  assert.deepEqual(h.depth(), { undo: 2, redo: 0 });
  assert.deepEqual(log, []);
});

test('the guard is not consulted while busy', async () => {
  const h = createUndoHistory();
  const { step } = fake();
  h.record(step('markup', 'a'));
  let consulted = 0;
  h.registerGuard(() => { consulted++; return false; });
  const release = h.beginExternal();
  assert.equal((await h.undo()).status, 'busy');
  assert.equal(consulted, 0);
  release();
});
