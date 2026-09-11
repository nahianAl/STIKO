import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMyRole,
  projectPeople,
  groupProjects,
  filterGroups,
  showFilterRow,
  needsYou,
  homeStats,
} from '../../lib/home.ts';

const pkg = (over = {}) => ({
  id: 'p1',
  name: 'Package',
  tag: null,
  projectId: 'proj1',
  projectName: 'Project',
  status: 'in_review',
  versionNumber: 1,
  changelog: null,
  fileCount: 0,
  openComments: 0,
  updatedAt: null,
  updatedByName: null,
  people: [],
  seenLatest: true,
  mentions: 0,
  ...over,
});

const proj = (over = {}) => ({
  id: 'proj1',
  name: 'Project',
  ownedByMe: true,
  createdByName: 'Maya Chen',
  myRole: 'owner',
  ...over,
});

/* ---------------------------------------------------------------- myRole -- */

test('owning the project beats every other signal', () => {
  assert.equal(
    deriveMyRole({ ownedByMe: true, memberRole: 'coordinator', participantRoles: ['viewer'] }),
    'owner'
  );
});

test('a project member role beats a package participant role', () => {
  assert.equal(
    deriveMyRole({ ownedByMe: false, memberRole: 'coordinator', participantRoles: ['viewer'] }),
    'coordinator'
  );
});

test('a guest falls back to their strongest package role', () => {
  assert.equal(
    deriveMyRole({ ownedByMe: false, memberRole: null, participantRoles: ['viewer', 'commenter'] }),
    'commenter'
  );
});

test('no role anywhere is null, not a default', () => {
  // The chip must degrade to a bare "Invited" rather than inventing a role.
  assert.equal(
    deriveMyRole({ ownedByMe: false, memberRole: null, participantRoles: [] }),
    null
  );
});

/* ---------------------------------------------------------------- people -- */

test('people are the union across packages, with their highest role', () => {
  const people = projectPeople([
    pkg({ id: 'a', people: [{ id: 'u1', name: 'Ada', role: 'viewer' }] }),
    pkg({ id: 'b', people: [{ id: 'u1', name: 'Ada', role: 'uploader' }, { id: 'u2', name: 'Bo', role: 'commenter' }] }),
  ]);

  assert.deepEqual(people, [
    { id: 'u1', name: 'Ada', role: 'uploader', packageCount: 2 },
    { id: 'u2', name: 'Bo', role: 'commenter', packageCount: 1 },
  ]);
});

test('people are ordered by role strength, then by name', () => {
  const people = projectPeople([
    pkg({ people: [
      { id: 'u1', name: 'Zoe', role: 'viewer' },
      { id: 'u2', name: 'Ada', role: 'viewer' },
      { id: 'u3', name: 'Bo', role: 'uploader' },
    ] }),
  ]);
  assert.deepEqual(people.map((p) => p.name), ['Bo', 'Ada', 'Zoe']);
});

test('a person on a package with no role still appears', () => {
  // participants.role is NOT NULL, but the payload is shared with pending
  // invitees, and a missing role must not delete the person from the panel.
  const people = projectPeople([pkg({ people: [{ id: 'u1', name: 'Ada' }] })]);
  assert.deepEqual(people, [{ id: 'u1', name: 'Ada', role: null, packageCount: 1 }]);
});

/* ----------------------------------------------------------------- group -- */

test('packages are grouped under their project with roll-ups', () => {
  const groups = groupProjects(
    [
      pkg({ id: 'a', openComments: 4 }),
      pkg({ id: 'b', openComments: 2 }),
      pkg({ id: 'c', projectId: 'proj2', projectName: 'Other', openComments: 1 }),
    ],
    [proj(), proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'commenter' })]
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0].project.id, 'proj1');
  assert.equal(groups[0].packageCount, 2);
  assert.equal(groups[0].openComments, 6);
  assert.equal(groups[1].packageCount, 1);
  assert.equal(groups[1].openComments, 1);
});

test('a project with no packages still gets a card', () => {
  // "New project" creates an empty project, and the empty card IS the prompt
  // to add a package. Dropping it would make the button look broken.
  const groups = groupProjects([], [proj()]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].packageCount, 0);
  assert.deepEqual(groups[0].packages, []);
  assert.deepEqual(groups[0].people, []);
});

test('a package whose project is missing from the payload is still shown', () => {
  // Losing a package because a join went wrong is worse than a card with a
  // thin header: the package is the thing with the user's work in it.
  const groups = groupProjects([pkg({ projectId: 'ghost', projectName: 'Ghost' })], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].project.id, 'ghost');
  assert.equal(groups[0].project.name, 'Ghost');
  assert.equal(groups[0].project.ownedByMe, false);
  assert.equal(groups[0].packageCount, 1);
});

/* ---------------------------------------------------------------- filter -- */

test('the filter splits owned from invited', () => {
  const groups = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'commenter' })]
  );
  assert.deepEqual(filterGroups(groups, 'all').map((g) => g.project.id), ['proj1', 'proj2']);
  assert.deepEqual(filterGroups(groups, 'owned').map((g) => g.project.id), ['proj1']);
  assert.deepEqual(filterGroups(groups, 'shared').map((g) => g.project.id), ['proj2']);
});

test('the filter row is hidden when there is nothing to filter', () => {
  const oneOwned = groupProjects([pkg()], [proj()]);
  assert.equal(showFilterRow(oneOwned), false);

  const twoOwned = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other' })]
  );
  assert.equal(showFilterRow(twoOwned), true);

  const mixed = groupProjects(
    [pkg()],
    [proj({ ownedByMe: false, myRole: 'commenter' })]
  );
  assert.equal(showFilterRow(mixed), false);
});

/* ----------------------------------------------------------------- stats -- */

test('needsYou matches the predicate getHomeData already uses', () => {
  assert.equal(needsYou(pkg({ mentions: 1 })), true);
  assert.equal(needsYou(pkg({ versionNumber: 3, seenLatest: false })), true);
  assert.equal(needsYou(pkg({ versionNumber: 3, seenLatest: true })), false);
  assert.equal(needsYou(pkg({ versionNumber: null, seenLatest: false })), false);
});

test('the rail tiles count over visible packages only', () => {
  const stats = homeStats([
    pkg({ id: 'a', openComments: 3, mentions: 1, status: 'in_review' }),
    pkg({ id: 'b', openComments: 2, status: 'approved' }),
    pkg({ id: 'c', openComments: 0, status: 'in_review' }),
  ]);
  assert.deepEqual(stats, { needsYou: 1, openComments: 5, inReview: 2 });
});
