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
