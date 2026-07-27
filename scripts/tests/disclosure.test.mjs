import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCLOSURE, EMPTY_DISCLOSURE } from '../../lib/disclosure.ts';

const s = (over) => ({ ...EMPTY_DISCLOSURE, ...over });

test('a brand-new account earns nothing', () => {
  const fresh = EMPTY_DISCLOSURE;
  for (const [name, predicate] of Object.entries(DISCLOSURE)) {
    assert.equal(predicate(fresh), false, `${name} should be hidden at the floor`);
  }
});

test('home stays a flat package list until a second package exists', () => {
  assert.equal(DISCLOSURE.groupByProject(s({ packageCount: 1 })), false);
  assert.equal(DISCLOSURE.groupByProject(s({ packageCount: 2 })), true);
});

test('search is earned by packages OR by files', () => {
  assert.equal(DISCLOSURE.showSearch(s({ packageCount: 2 })), false);
  assert.equal(DISCLOSURE.showSearch(s({ packageCount: 3 })), true);
  assert.equal(DISCLOSURE.showSearch(s({ fileCount: 19 })), false);
  assert.equal(DISCLOSURE.showSearch(s({ fileCount: 20 })), true);
});

test('the bell appears with the first notification, not before', () => {
  assert.equal(DISCLOSURE.showNotifications(s({ notificationCount: 0 })), false);
  assert.equal(DISCLOSURE.showNotifications(s({ notificationCount: 1 })), true);
});

test('"Needs you" is never rendered empty', () => {
  assert.equal(DISCLOSURE.showNeedsYou(s({ needsYouCount: 0 })), false);
  assert.equal(DISCLOSURE.showNeedsYou(s({ needsYouCount: 1 })), true);
});

test('project tabs need both packages and people', () => {
  assert.equal(
    DISCLOSURE.showProjectTabs(s({ packagesInProject: 2, peopleCount: 2 })),
    false
  );
  assert.equal(
    DISCLOSURE.showProjectTabs(s({ packagesInProject: 1, peopleCount: 5 })),
    false
  );
  assert.equal(
    DISCLOSURE.showProjectTabs(s({ packagesInProject: 2, peopleCount: 3 })),
    true
  );
});

test('"Waiting on" needs two reviewers AND something published', () => {
  assert.equal(
    DISCLOSURE.showWaitingOn(s({ reviewerCount: 2, hasPublishedVersion: false })),
    false
  );
  assert.equal(
    DISCLOSURE.showWaitingOn(s({ reviewerCount: 1, hasPublishedVersion: true })),
    false
  );
  assert.equal(
    DISCLOSURE.showWaitingOn(s({ reviewerCount: 2, hasPublishedVersion: true })),
    true
  );
});

test('the version rail waits for a SECOND version', () => {
  assert.equal(DISCLOSURE.showVersionRail(s({ versionCount: 1 })), false);
  assert.equal(DISCLOSURE.showVersionRail(s({ versionCount: 2 })), true);
});

test('status chips wait for a published version', () => {
  assert.equal(DISCLOSURE.showStatusChips(s({ hasPublishedVersion: false })), false);
  assert.equal(DISCLOSURE.showStatusChips(s({ hasPublishedVersion: true })), true);
});
