import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTrailingSlash, trailingSlashRedirectTarget } from '../../lib/trailingSlash.ts';

test('a slash-ended path loses its trailing slash(es)', () => {
  assert.equal(stripTrailingSlash('/settings/'), '/settings');
  assert.equal(stripTrailingSlash('/api/me/'), '/api/me');
  assert.equal(stripTrailingSlash('/a/b/c/'), '/a/b/c');
  assert.equal(stripTrailingSlash('/a//'), '/a');
  assert.equal(stripTrailingSlash('/a///'), '/a');
});

test('no redirect when there is no trailing slash, and none for the root', () => {
  assert.equal(stripTrailingSlash('/'), null);
  assert.equal(stripTrailingSlash('/settings'), null);
  assert.equal(stripTrailingSlash('/api/me'), null);
  assert.equal(stripTrailingSlash(''), null);
});

test('a path that is only slashes goes to the root', () => {
  assert.equal(stripTrailingSlash('//'), '/');
  assert.equal(stripTrailingSlash('///'), '/');
});

test('slashes inside the path are left alone', () => {
  assert.equal(stripTrailingSlash('/a//b/'), '/a//b');
});

test('the redirect target keeps the origin and the query string', () => {
  assert.equal(
    trailingSlashRedirectTarget('https://app.stiko.design/settings/?tab=billing&x=1'),
    'https://app.stiko.design/settings?tab=billing&x=1'
  );
  assert.equal(
    trailingSlashRedirectTarget('http://localhost:3000/api/me/'),
    'http://localhost:3000/api/me'
  );
});

test('the redirect target is null when nothing needs stripping', () => {
  assert.equal(trailingSlashRedirectTarget('https://app.stiko.design/'), null);
  assert.equal(trailingSlashRedirectTarget('https://app.stiko.design/settings?x=1'), null);
});

test('a protocol-relative-looking path cannot turn into a redirect to another host', () => {
  // //evil.com/ is a PATH on our host. Resolving "//evil.com" against the origin would
  // make it a protocol-relative URL to evil.com; the target must stay on our origin.
  const target = trailingSlashRedirectTarget('https://app.stiko.design//evil.com/');
  assert.equal(new URL(target).origin, 'https://app.stiko.design');
  assert.equal(new URL(target).pathname, '//evil.com');
});
