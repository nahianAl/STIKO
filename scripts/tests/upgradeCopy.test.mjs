import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headline } from '../../lib/upgradeCopy.ts';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const payload = (over) => ({
  error: 'x',
  code: 'plan_limit',
  limit: 'projects',
  isOwner: true,
  used: 2,
  max: 2,
  adding: 1,
  ...over,
});

test('no payload is the generic upgrade pitch, built from the Standard plan', () => {
  const h = headline(null);
  assert.equal(h.title, 'Upgrade to Standard');
  assert.equal(h.subtitle, 'Standard gives you 100 GB and unlimited projects.');
});

test('an owner at the project limit is told how many Free projects they used', () => {
  const h = headline(payload({ limit: 'projects', used: 2, max: 2 }));
  assert.equal(h.title, "You've used your 2 Free projects");
  assert.match(h.subtitle, /100 GB and unlimited projects/);
});

test('an owner out of storage sees what the upload needs and what is left', () => {
  const h = headline(
    payload({ limit: 'storage', used: 1.5 * GIB, max: 2 * GIB, adding: 600 * MIB })
  );
  assert.equal(h.title, 'Not enough storage');
  assert.match(h.subtitle, /needs 600 MB/);
  assert.match(h.subtitle, /512 MB left of 2 GB/);
  assert.match(h.subtitle, /100 GB and unlimited projects/);
});

test('storage left never goes negative when the account is already over', () => {
  const h = headline(
    payload({ limit: 'storage', used: 3 * GIB, max: 2 * GIB, adding: 1 * MIB })
  );
  assert.match(h.subtitle, /you have 0 B left of 2 GB/);
  assert.doesNotMatch(h.subtitle, /-/);
});

test('a collaborator out of storage is pointed at the owner, not at a price', () => {
  const h = headline(payload({ limit: 'storage', isOwner: false }));
  assert.equal(h.title, 'This project is out of storage');
  assert.equal(
    h.subtitle,
    "The project's owner is on the Free plan and has used its storage. Ask them to upgrade to Standard."
  );
});

test('a collaborator at the project limit is pointed at the owner', () => {
  const h = headline(payload({ limit: 'projects', isOwner: false }));
  assert.equal(h.title, 'This project is at its limit');
  assert.equal(
    h.subtitle,
    "The project's owner is on the Free plan and has used its projects. Ask them to upgrade to Standard."
  );
});
