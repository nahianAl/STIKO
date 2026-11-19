import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDUSTRIES, MARKETS, CLIENT_MODELS, SIZE_BANDS, REVIEW_TEAM_BANDS, ROLES, ROLE_LISTS,
  REVIEWERS, REVIEWER_LISTS, FILE_TYPES, FILE_GROUP_LABELS, FILE_GROUP_ORDER,
  OTHER_INDUSTRY, OTHER_MARKET, OTHER_ROLE, OTHER_FILE_TYPE,
} from '../../lib/kyc/catalog.ts';

const unique = (xs) => new Set(xs).size === xs.length;

test('industries: 11 plus Other last, each with a parent segment', () => {
  assert.deepEqual(INDUSTRIES.map((i) => i.code),
    ['IND', 'CON', 'PRD', 'MFG', 'ARC', 'INT', 'CST', 'VIZ', 'GRD', 'VID', 'PHO', 'OTH']);
  for (const i of INDUSTRIES) {
    if (i.code === OTHER_INDUSTRY) assert.equal(i.parent, null);
    else assert.ok(['ID', 'PD', 'AC', 'GV'].includes(i.parent), i.code);
    assert.ok(i.label && i.helper, i.code);
  }
});

test('markets: MK-01..MK-30 in order, then MK-99', () => {
  const codes = MARKETS.map((m) => m.code);
  assert.equal(codes.length, 31);
  for (let n = 1; n <= 30; n++) assert.equal(codes[n - 1], `MK-${String(n).padStart(2, '0')}`);
  assert.equal(codes[30], OTHER_MARKET);
  for (const m of MARKETS.slice(0, 30)) assert.ok(m.group, m.code);
});

test('client models CM-1..CM-5; only CM-3 is restricted, to PRD/MFG/CST', () => {
  assert.deepEqual(CLIENT_MODELS.map((c) => c.code), ['CM-1', 'CM-2', 'CM-3', 'CM-4', 'CM-5']);
  for (const c of CLIENT_MODELS) {
    if (c.code === 'CM-3') assert.deepEqual([...c.industries], ['PRD', 'MFG', 'CST']);
    else assert.equal(c.industries, undefined, c.code);
  }
});

test('size bands CS-01..CS-08 and review-team bands RT-01..RT-06 have ordered ranges', () => {
  assert.deepEqual(SIZE_BANDS.map((b) => b.code), ['CS-01', 'CS-02', 'CS-03', 'CS-04', 'CS-05', 'CS-06', 'CS-07', 'CS-08']);
  assert.deepEqual(SIZE_BANDS.map((b) => b.label), ['Just me', '2-4', '5-9', '10-24', '25-49', '50-99', '100-249', '250+']);
  assert.deepEqual(REVIEW_TEAM_BANDS.map((b) => b.code), ['RT-01', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06']);
  for (const list of [SIZE_BANDS, REVIEW_TEAM_BANDS]) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (i < list.length - 1) assert.ok(b.max !== null && b.max >= b.min, b.code);
      else assert.equal(b.max, null, b.code);
      if (i > 0) assert.equal(b.min, list[i - 1].max + 1, b.code);
    }
  }
});

test('roles: one code per label, every list ends with Other, every role used', () => {
  assert.ok(unique(ROLES.map((r) => r.code)));
  assert.ok(unique(ROLES.map((r) => r.label)));
  const used = new Set();
  for (const [industry, list] of Object.entries(ROLE_LISTS)) {
    assert.equal(list[list.length - 1], OTHER_ROLE, industry);
    assert.ok(unique(list), industry);
    for (const code of list) {
      assert.ok(ROLES.some((r) => r.code === code), `${industry} ${code}`);
      used.add(code);
    }
  }
  for (const r of ROLES) assert.ok(used.has(r.code), r.code);
  for (const r of ROLES) {
    assert.ok(r.family, r.code);
    if (r.code === OTHER_ROLE) assert.equal(r.seniority, null);
    else assert.ok(['owner_exec', 'director', 'manager_lead', 'individual', 'student'].includes(r.seniority), r.code);
  }
  assert.deepEqual(Object.keys(ROLE_LISTS).sort(),
    ['ARC', 'CON', 'CST', 'GRD', 'IND', 'INT', 'MFG', 'PHO', 'PRD', 'VID', 'VIZ']);
});

test('role list lengths match the source doc', () => {
  const len = (k) => ROLE_LISTS[k].length;
  assert.deepEqual(
    ['IND', 'CON', 'PRD', 'MFG', 'ARC', 'INT', 'CST', 'VIZ'].map(len),
    [11, 12, 12, 12, 11, 11, 11, 13]
  );
  assert.deepEqual(ROLE_LISTS.VIZ, ROLE_LISTS.GRD);
  assert.deepEqual(ROLE_LISTS.VIZ, ROLE_LISTS.PHO);
});

test('reviewers: unique ids, 13 shared ER codes, lists per parent segment', () => {
  assert.ok(unique(REVIEWERS.map((r) => r.id)));
  assert.ok(unique(REVIEWERS.map((r) => r.label)));
  assert.equal(new Set(REVIEWERS.map((r) => r.code)).size, 13);
  assert.deepEqual(Object.keys(REVIEWER_LISTS).sort(), ['AC', 'GV', 'ID', 'PD']);
  for (const list of Object.values(REVIEWER_LISTS)) {
    for (const id of list) assert.ok(REVIEWERS.some((r) => r.id === id), id);
  }
  assert.deepEqual(REVIEWER_LISTS.PD.length, 7);
  assert.deepEqual(REVIEWER_LISTS.AC.length, 8);
});

test('file types: unique codes, Other last, every grouped type in a known group', () => {
  assert.ok(unique(FILE_TYPES.map((f) => f.code)));
  assert.equal(FILE_TYPES[FILE_TYPES.length - 1].code, OTHER_FILE_TYPE);
  for (const f of FILE_TYPES) {
    if (f.code === OTHER_FILE_TYPE) assert.equal(f.group, null);
    else assert.ok(f.group in FILE_GROUP_LABELS, f.code);
    assert.ok(f.code.startsWith('FT-'), f.code);
  }
  for (const order of Object.values(FILE_GROUP_ORDER)) {
    assert.deepEqual([...order].sort(), Object.keys(FILE_GROUP_LABELS).sort());
  }
});
