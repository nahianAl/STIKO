import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRoster, pendingCount } from '../../lib/projectRoster.ts';

const pkg = (name, people = [], pending = []) => ({ id: name, name, people, pending });
const person = (id, role, over = {}) => ({
  id, name: id, email: `${id}@x.co`, role, ...over,
});

test('someone on two packages is listed once, counted twice', () => {
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter')]),
    pkg('B', [person('dana', 'commenter')]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].packageCount, 2);
});

test('the role shown is the strongest held anywhere', () => {
  // Uploader on one package out of two must not read as commenter.
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter')]),
    pkg('B', [person('dana', 'uploader')]),
  ]);
  assert.equal(r[0].role, 'uploader');
});

test('a pending invite appears, flagged, keyed on its email', () => {
  const r = projectRoster([
    pkg('A', [], [{ email: 'mia@acme.com', role: 'viewer' }]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].pending, true);
  assert.equal(r[0].key, 'mia@acme.com');
  assert.equal(r[0].email, 'mia@acme.com');
  assert.equal(r[0].name, 'mia@acme.com', 'no display name exists yet');
});

test('an invite the person has since accepted is not listed twice', () => {
  // The accepted row wins: same human, and a pending chip beside their
  // avatar would be a lie once they are in.
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter', { email: 'mia@acme.com' })],
             [{ email: 'mia@acme.com', role: 'viewer' }]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].pending, false);
  assert.equal(r[0].key, 'dana');
});

test('pending matching is case-insensitive on the email', () => {
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter', { email: 'Mia@Acme.com' })],
             [{ email: 'mia@acme.com', role: 'viewer' }]),
  ]);
  assert.equal(r.length, 1, 'MIA@ACME.COM and mia@acme.com are one person');
});

test('the same pending email on two packages collapses to one entry', () => {
  const r = projectRoster([
    pkg('A', [], [{ email: 'mia@acme.com', role: 'viewer' }]),
    pkg('B', [], [{ email: 'mia@acme.com', role: 'commenter' }]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].packageCount, 2);
  assert.equal(r[0].role, 'commenter', 'strongest pending role wins too');
});

test('accepted people sort above pending, then by role, then by name', () => {
  const r = projectRoster([
    pkg('A',
      [person('zoe', 'viewer'), person('adam', 'uploader')],
      [{ email: 'mia@acme.com', role: 'uploader' }]),
  ]);
  assert.deepEqual(r.map((e) => e.key), ['adam', 'zoe', 'mia@acme.com']);
});

test('an empty project has an empty roster', () => {
  assert.deepEqual(projectRoster([]), []);
  assert.equal(pendingCount([]), 0);
});

test('pendingCount counts only the pending entries', () => {
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter')],
      [{ email: 'mia@acme.com', role: 'viewer' },
       { email: 'ray@x.co', role: 'viewer' }]),
  ]);
  assert.equal(pendingCount(r), 2);
});
