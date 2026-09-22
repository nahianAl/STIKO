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
  packageAttention,
  projectAttention,
  packagesLabel,
  openCommentsLabel,
  packageMeta,
  packageCountLabel,
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

test('the filter row needs both an owned and an invited project', () => {
  const oneOwned = groupProjects([pkg()], [proj()]);
  assert.equal(showFilterRow(oneOwned), false);

  // Two owned, none invited: "Shared with me" could never match anything.
  const twoOwned = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other' })]
  );
  assert.equal(showFilterRow(twoOwned), false);

  // A pure guest across two projects: "Owned by me" could never match.
  const twoInvited = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [
      proj({ ownedByMe: false, myRole: 'commenter' }),
      proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'viewer' }),
    ]
  );
  assert.equal(showFilterRow(twoInvited), false);

  // One of each is the only shape where all three buttons mean something.
  const mixed = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'commenter' })]
  );
  assert.equal(showFilterRow(mixed), true);
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

/* ------------------------------------------------------------- attention -- */

test('a package needing nothing has no attention pill', () => {
  assert.equal(packageAttention(pkg({ mentions: 0, seenLatest: true })), null);
});

test('mentions outrank an unseen version', () => {
  const a = packageAttention(pkg({ mentions: 2, seenLatest: false }));
  assert.equal(a.kind, 'mention');
  assert.equal(a.label, '2 mentions');
  assert.equal(a.bg, '#FFE2E2');
  assert.equal(a.fg, '#B23A52');
});

test('a single mention reads singular', () => {
  assert.equal(packageAttention(pkg({ mentions: 1 })).label, '1 mention');
});

test('an unseen version with no mentions is a new-version pill', () => {
  const a = packageAttention(pkg({ mentions: 0, seenLatest: false, versionNumber: 3 }));
  assert.equal(a.kind, 'new_version');
  assert.equal(a.label, 'New version');
  assert.equal(a.bg, '#FFFCCE');
  assert.equal(a.fg, '#7A5E00');
});

test('a package with no version cannot carry a new-version pill', () => {
  assert.equal(
    packageAttention(pkg({ mentions: 0, seenLatest: false, versionNumber: null })),
    null
  );
});

test('the project pill is the first attention-carrying package', () => {
  const a = projectAttention([
    pkg({ id: 'a', mentions: 0, seenLatest: true }),
    pkg({ id: 'b', mentions: 0, seenLatest: false, versionNumber: 2 }),
    pkg({ id: 'c', mentions: 5 }),
  ]);
  assert.equal(a.kind, 'new_version');
});

test('a project where nothing needs you has no pill', () => {
  assert.equal(projectAttention([pkg({ mentions: 0, seenLatest: true })]), null);
});

test('a project with no packages has no pill', () => {
  assert.equal(projectAttention([]), null);
});

/* ---------------------------------------------------------------- labels -- */

test('the package count is singular only for one', () => {
  assert.equal(packagesLabel(0), '0 packages');
  assert.equal(packagesLabel(1), '1 package');
  assert.equal(packagesLabel(4), '4 packages');
});

test('the open-comments line says Nothing open at zero', () => {
  assert.equal(openCommentsLabel(0), 'Nothing open');
  assert.equal(openCommentsLabel(1), '1 open comment');
  assert.equal(openCommentsLabel(13), '13 open comments');
});

const NOW = Date.parse('2026-09-22T12:00:00Z');

test('package meta joins version, quoted changelog and age', () => {
  assert.equal(
    packageMeta(
      pkg({
        versionNumber: 4,
        changelog: 'Gutter detail added',
        updatedAt: '2026-09-22T10:00:00Z',
      }),
      NOW
    ),
    'V4 · "Gutter detail added" · 2h ago'
  );
});

test('package meta drops a missing changelog', () => {
  assert.equal(
    packageMeta(
      pkg({ versionNumber: 3, changelog: null, updatedAt: '2026-09-19T12:00:00Z' }),
      NOW
    ),
    'V3 · 3d ago'
  );
});

test('package meta drops a missing or unparseable time', () => {
  assert.equal(packageMeta(pkg({ versionNumber: 2, updatedAt: null }), NOW), 'V2');
  assert.equal(packageMeta(pkg({ versionNumber: 2, updatedAt: 'nope' }), NOW), 'V2');
});

test('a package with no version asks for files', () => {
  assert.equal(
    packageMeta(pkg({ versionNumber: null, changelog: 'ignored' }), NOW),
    'No files yet — add some'
  );
});

test('the count prefers open comments, then files, then empty', () => {
  assert.equal(packageCountLabel(pkg({ openComments: 7, fileCount: 12 })), '7 open');
  assert.equal(packageCountLabel(pkg({ openComments: 0, fileCount: 1 })), '1 file');
  assert.equal(packageCountLabel(pkg({ openComments: 0, fileCount: 9 })), '9 files');
  assert.equal(packageCountLabel(pkg({ openComments: 0, fileCount: 0 })), 'empty');
});
