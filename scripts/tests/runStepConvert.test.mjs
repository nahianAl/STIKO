import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runStepConvert,
  STEP_CONVERT_TIMEOUT_MS,
  STEP_VIEWER_TIMEOUT_MS,
} from '../../lib/model/runStepConvert.ts';

/** A worker that never answers — the shape of the bug this whole change exists to fix. */
function silentWorker(log) {
  return {
    postMessage() {},
    terminate() {
      log.terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
}

test('the two timeout budgets are the ones the spec fixed', () => {
  assert.equal(STEP_CONVERT_TIMEOUT_MS, 120000);
  assert.equal(STEP_VIEWER_TIMEOUT_MS, 60000);
});

test('a worker that never replies resolves null and is terminated', async () => {
  // THE regression test. Before this change the equivalent call was a synchronous WASM
  // invocation on the main thread that could not be timed out at all, and the viewport
  // spun forever. Deleting this test re-opens that failure mode.
  const log = { terminated: false };
  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => silentWorker(log),
    timeoutMs: 30,
  });
  assert.equal(result, null);
  assert.equal(log.terminated, true, 'a wedged worker must be killed, not merely abandoned');
});

test('a successful conversion resolves the buffer and terminates the worker', async () => {
  const log = { terminated: false };
  const payload = new ArrayBuffer(16);
  const worker = {
    postMessage() {
      queueMicrotask(() => worker.onmessage({ data: { ok: true, buffer: payload } }));
    },
    terminate() {
      log.terminated = true;
    },
    onmessage: null,
    onerror: null,
  };

  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => worker,
    timeoutMs: 5000,
  });
  assert.equal(result, payload);
  assert.equal(log.terminated, true, 'the worker must not be leaked on the success path');
});

test('a worker reporting failure resolves null rather than throwing', async () => {
  // Callers treat null as "use the original file". A throw here would propagate into the
  // upload loop and could fail an upload that has already succeeded.
  const worker = {
    postMessage() {
      queueMicrotask(() => worker.onmessage({ data: { ok: false, error: 'bad file' } }));
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  const result = await runStepConvert(new ArrayBuffer(8), { createWorker: () => worker });
  assert.equal(result, null);
});

test('a worker that crashes outright resolves null', async () => {
  // onerror rather than onmessage: this is the out-of-memory path.
  const worker = {
    postMessage() {
      queueMicrotask(() => worker.onerror({ message: 'out of memory' }));
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  };
  const result = await runStepConvert(new ArrayBuffer(8), { createWorker: () => worker });
  assert.equal(result, null);
});

test('a worker that cannot be constructed resolves null', async () => {
  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => {
      throw new Error('Worker is not defined');
    },
  });
  assert.equal(result, null);
});

test('a late reply after a timeout cannot resolve twice', async () => {
  // settled-guard check: a worker that replies just after being killed must not run finish()
  // a second time. Calling resolve() twice on an already-settled promise is a silent no-op,
  // so the only way to detect a missing guard is via a side effect of finish() that a second
  // run would repeat: worker.terminate(). The stub counts its calls, and we assert the exact
  // count — one from the timeout, and still one (not two) after the late reply arrives — so
  // this test fails if the `settled` guard in runStepConvert is ever removed.
  let terminateCount = 0;
  let captured = null;
  const worker = {
    postMessage() {
      captured = () => worker.onmessage({ data: { ok: true, buffer: new ArrayBuffer(4) } });
    },
    terminate() {
      terminateCount += 1;
    },
    onmessage: null,
    onerror: null,
  };
  const result = await runStepConvert(new ArrayBuffer(8), {
    createWorker: () => worker,
    timeoutMs: 10,
  });
  assert.equal(result, null);
  assert.equal(terminateCount, 1, 'the timeout path must terminate the worker exactly once');
  captured();
  assert.equal(terminateCount, 1, 'a late reply after the timeout must not terminate again');
});
