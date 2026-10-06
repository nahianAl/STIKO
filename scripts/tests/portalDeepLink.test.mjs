import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalDeepLinkPath, parsePortalDeepLink } from '../../lib/portalDeepLink.ts';

test('a built link parses back to what it was built from', () => {
  const link = { versionId: 'v-1', fileId: 'f-1', commentId: 'c-1' };
  const path = portalDeepLinkPath('p-1', link);
  assert.equal(path, '/portal/p-1?submission=v-1&file=f-1&comment=c-1');
  assert.deepEqual(parsePortalDeepLink(path.slice(path.indexOf('?'))), link);
});

test('the comment is optional', () => {
  const link = { versionId: 'v-1', fileId: 'f-1', commentId: null };
  assert.equal(portalDeepLinkPath('p-1', link), '/portal/p-1?submission=v-1&file=f-1');
  assert.deepEqual(parsePortalDeepLink('?submission=v-1&file=f-1'), link);
});

test('a link missing its submission or its file is no link at all', () => {
  assert.equal(parsePortalDeepLink(''), null);
  assert.equal(parsePortalDeepLink('?file=f-1&comment=c-1'), null);
  assert.equal(parsePortalDeepLink('?submission=v-1'), null);
  assert.equal(parsePortalDeepLink('?submission=&file=f-1'), null);
});
