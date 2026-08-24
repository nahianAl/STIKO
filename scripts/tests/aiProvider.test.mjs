import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, isConfigured, activeModel } from '../../lib/ai/provider.ts';

test('with no API key the provider reports failure instead of throwing', async () => {
  // Mirrors lib/email.ts: never pretend the third party was reached. The UI
  // shows facts and says summarisation is unconfigured.
  delete process.env.ATLAS_API_KEY;

  assert.equal(isConfigured(), false);

  const result = await complete({ system: 's', user: 'u' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/i);
});

test('activeModel falls back to the documented default', () => {
  delete process.env.ATLAS_MODEL;
  assert.equal(activeModel(), 'deepseek-v4-flash');

  process.env.ATLAS_MODEL = 'something-else';
  assert.equal(activeModel(), 'something-else');
  delete process.env.ATLAS_MODEL;
});

test('a 2xx response with an unreadable body is reported honestly, not as unreachable', async () => {
  // If res.json() were caught by the outer transport try/catch, this would
  // regress to "Could not reach the summarisation provider" — untrue, since
  // the provider was reached and answered 200. That would send an operator
  // hunting for a DNS/TLS/timeout problem that does not exist.
  const originalFetch = globalThis.fetch;
  process.env.ATLAS_API_KEY = 'dummy-key';

  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await complete({ system: 's', user: 'u' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /unreadable response body/i);
    assert.doesNotMatch(result.reason, /could not reach/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ATLAS_API_KEY;
  }
});
