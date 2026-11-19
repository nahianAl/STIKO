import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompanyProfileRequired, companyProfilePath } from '../../lib/kyc/companyGateClient.ts';

test('recognises the 409 and leaves the body readable', async () => {
  const res = new Response(JSON.stringify({ code: 'company_profile_required' }), { status: 409 });
  assert.equal(await isCompanyProfileRequired(res), true);
  assert.deepEqual(await res.json(), { code: 'company_profile_required' });
  assert.equal(await isCompanyProfileRequired(new Response('{}', { status: 409 })), false);
  assert.equal(await isCompanyProfileRequired(new Response('{}', { status: 402 })), false);
});

test('builds the /welcome path that returns them', () => {
  assert.equal(companyProfilePath('/new?project=p1'), '/welcome?callbackUrl=%2Fnew%3Fproject%3Dp1');
});
