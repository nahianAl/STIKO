import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headline, offersCheckout, checkoutReturnToast } from '../../lib/upgradeCopy.ts';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const payload = (over) => ({
  error: 'x',
  code: 'plan_limit',
  limit: 'projects',
  plan: 'free',
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

test('a collaborator out of Free storage is pointed at the owner, not at a price', () => {
  const h = headline(payload({ limit: 'storage', isOwner: false }));
  assert.equal(h.title, 'This project is out of storage');
  assert.equal(
    h.subtitle,
    "This project's owner is on the Free plan and has used its storage. Ask them to upgrade to Standard."
  );
});

test('a collaborator at the Free project limit is pointed at the owner', () => {
  const h = headline(payload({ limit: 'projects', isOwner: false }));
  assert.equal(h.title, 'This project is at its limit');
  assert.equal(
    h.subtitle,
    "This project's owner is on the Free plan and has used its projects. Ask them to upgrade to Standard."
  );
});

test('only a Free owner (or the generic pitch) is offered a checkout', () => {
  assert.equal(offersCheckout(null), true);
  assert.equal(offersCheckout(payload({ plan: 'free', isOwner: true })), true);
  assert.equal(offersCheckout(payload({ plan: 'free', isOwner: false })), false);
  assert.equal(offersCheckout(payload({ limit: 'storage', plan: 'standard', isOwner: true })), false);
  assert.equal(offersCheckout(payload({ limit: 'storage', plan: 'standard', isOwner: false })), false);
});

test('a payload without a plan never offers a checkout (cannot tell it is Free)', () => {
  const { plan, ...noPlan } = payload({ limit: 'storage' });
  assert.equal(plan, 'free');
  assert.equal(offersCheckout(noPlan), false);
});

test('a Standard owner at 100 GB is told the Standard limit and how to free space, not sold Standard', () => {
  const h = headline(
    payload({ limit: 'storage', plan: 'standard', used: 100 * GIB - 10 * MIB, max: 100 * GIB, adding: 50 * MIB })
  );
  assert.equal(h.title, "You've reached the Standard plan's 100 GB");
  assert.match(h.subtitle, /needs 50 MB/);
  assert.match(h.subtitle, /10 MB left/);
  assert.match(h.subtitle, /emptying the trash/);
  assert.doesNotMatch(h.title + h.subtitle, /[Uu]pgrade|Free plan/);
});

test('a collaborator on a Standard owner\'s full project is not told the owner is on Free', () => {
  const h = headline(payload({ limit: 'storage', plan: 'standard', isOwner: false, max: 100 * GIB }));
  assert.equal(h.title, 'This project is out of storage');
  assert.equal(h.subtitle, "This project's owner has reached their storage limit.");
  assert.doesNotMatch(h.subtitle, /Free|[Uu]pgrade/);
});

test('a collaborator with an unknown plan is not told which plan the owner is on', () => {
  const { plan: _p, ...noPlan } = payload({ limit: 'storage', isOwner: false });
  const h = headline(noPlan);
  assert.equal(h.subtitle, "This project's owner has reached their storage limit.");
});

test('an owner whose plan the payload does not name gets no Free or Standard claim', () => {
  const { plan: _p, ...noPlan } = payload({ limit: 'storage', used: GIB, max: 2 * GIB, adding: 2 * GIB });
  const h = headline(noPlan);
  assert.equal(h.title, "You've reached your storage limit");
  assert.doesNotMatch(h.title + h.subtitle, /Free plan|Standard/);
});

test('the post-checkout toast claims Standard only when the plan says so', () => {
  assert.equal(checkoutReturnToast('standard'), "You're on Standard");
  const pending = 'Payment received — refresh in a moment to see Standard.';
  assert.equal(checkoutReturnToast('free'), pending);
  assert.equal(checkoutReturnToast(undefined), pending);
  assert.equal(checkoutReturnToast(null), pending);
});
