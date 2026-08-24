import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capComments,
  labelAuthors,
  buildVersionPrompt,
} from '../../lib/ai/prompt.ts';

const raw = (over = {}) => ({
  id: 'c1',
  author: 'Dana Whitfield',
  authorKey: 'user-1',
  text: 'The clearance here is too tight.',
  file: 'level3.step',
  isReply: false,
  ...over,
});

test('capComments keeps the newest and reports what it dropped', () => {
  const rows = Array.from({ length: 170 }, (_, i) => raw({ id: `c${i}` }));
  const { kept, omittedCount } = capComments(rows, 150);

  assert.equal(kept.length, 150);
  assert.equal(omittedCount, 20);
  // Input arrives newest-first, so the cap takes from the front.
  assert.equal(kept[0].id, 'c0');
});

test('capComments reports nothing omitted when under the limit', () => {
  const { kept, omittedCount } = capComments([raw(), raw({ id: 'c2' })], 150);
  assert.equal(kept.length, 2);
  assert.equal(omittedCount, 0);
});

test('labelAuthors replaces every real name with a stable pseudonym', () => {
  const { labelled, labels } = labelAuthors([
    raw({ id: 'c1', authorKey: 'user-1', author: 'Dana Whitfield' }),
    raw({ id: 'c2', authorKey: 'user-2', author: 'Ravi Chandra' }),
    raw({ id: 'c3', authorKey: 'user-1', author: 'Dana Whitfield' }),
  ]);

  assert.equal(labelled[0].author, 'Reviewer A');
  assert.equal(labelled[1].author, 'Reviewer B');
  // Same person, same label — the model can count distinct voices.
  assert.equal(labelled[2].author, 'Reviewer A');
  assert.equal(labels.get('Reviewer A'), 'user-1');
});

test('no real name or email survives into the prompt body', () => {
  // This is the privacy guarantee. If it regresses, personal data starts
  // leaving the building on every generation.
  const { labelled } = labelAuthors([
    raw({ author: 'Dana Whitfield', text: 'looks fine to me' }),
  ]);
  const { system, user } = buildVersionPrompt({
    versionNumber: 3,
    comments: labelled,
    facts: {
      commentCount: 1,
      openThreadCount: 1,
      approvedCount: 0,
      changesRequestedCount: 0,
      participantCount: 2,
      mostAnnotatedFile: 'level3.step',
    },
    priorThemes: [],
    omittedCount: 0,
  });

  assert.doesNotMatch(system + user, /Dana/);
  assert.doesNotMatch(system + user, /Whitfield/);
  assert.match(user, /Reviewer A/);
});

test('the prompt states an omitted count when comments were capped', () => {
  const { user } = buildVersionPrompt({
    versionNumber: 3,
    comments: [raw({ author: 'Reviewer A' })],
    facts: {
      commentCount: 312,
      openThreadCount: 4,
      approvedCount: 1,
      changesRequestedCount: 2,
      participantCount: 5,
      mostAnnotatedFile: 'level3.step',
    },
    priorThemes: [],
    omittedCount: 162,
  });

  assert.match(user, /162/);
});

test('prior themes are supplied so recurrence can be detected', () => {
  const { user } = buildVersionPrompt({
    versionNumber: 4,
    comments: [raw({ author: 'Reviewer A' })],
    facts: {
      commentCount: 1,
      openThreadCount: 0,
      approvedCount: 0,
      changesRequestedCount: 0,
      participantCount: 1,
      mostAnnotatedFile: null,
    },
    priorThemes: [
      { versionId: 'v3', title: 'Clearance at the pump housing', body: 'Raised by two reviewers.' },
    ],
    omittedCount: 0,
  });

  assert.match(user, /Clearance at the pump housing/);
  assert.match(user, /v3/);
});

test('the system prompt demands ids only from the supplied set', () => {
  const { system } = buildVersionPrompt({
    versionNumber: 1,
    comments: [raw({ author: 'Reviewer A' })],
    facts: {
      commentCount: 1,
      openThreadCount: 0,
      approvedCount: 0,
      changesRequestedCount: 0,
      participantCount: 1,
      mostAnnotatedFile: null,
    },
    priorThemes: [],
    omittedCount: 0,
  });

  assert.match(system, /commentIds/);
  assert.match(system, /JSON/);
});
