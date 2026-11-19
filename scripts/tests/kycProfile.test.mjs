import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, FILE_TYPES } from '../../lib/kyc/catalog.ts';
import { SUPPORTED_EXTENSIONS } from '../../lib/fileFormats.ts';
import {
  rolesFor, reviewersFor, clientModelsFor, reviewTeamBandsFor, fileTypeGroupsFor, matchesSearch,
  normaliseDomain, emailDomain, isBusinessEmail, trackForSize, fileTypeSupported,
  validateCompany, validateRole, deriveCompany, deriveRole, decideOnboarding, allowedSubmission,
} from '../../lib/kyc/profile.ts';

const VALID = {
  website: 'acme.com', industry: 'MFG', markets: ['MK-11', 'MK-15'], clientModel: 'CM-3',
  companySize: 'CS-04', reviewTeamSize: 'RT-03', reviewers: ['rv-customers', 'rv-toolmakers'],
  fileTypes: ['FT-STEP', 'FT-PDF'],
};
const ft = (code) => FILE_TYPES.find((f) => f.code === code);

test('rolesFor: industry list in order; Other and null get every role once, Other last', () => {
  const ind = rolesFor('IND').map((r) => r.label);
  assert.equal(ind[0], 'Owner / Principal / Founder');
  assert.equal(ind.at(-1), 'Other');
  for (const combined of [rolesFor('OTH'), rolesFor(null), rolesFor('nope')]) {
    const codes = combined.map((r) => r.code);
    assert.equal(codes.length, ROLES.length);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(codes.at(-1), 'RL-99');
  }
});

test('reviewersFor: per parent segment; Other gets the de-duplicated union', () => {
  assert.deepEqual(reviewersFor('PRD').map((r) => r.label), [
    'Internal team', 'Customers', 'Suppliers / vendors', 'Contract manufacturers / factories',
    'Toolmakers / mold shops', 'Quality / inspection partners', 'Investors / leadership',
  ]);
  assert.deepEqual(reviewersFor('MFG'), reviewersFor('PRD'));
  const all = reviewersFor('OTH').map((r) => r.label);
  assert.equal(all.filter((l) => l === 'Internal team').length, 1);
  assert.equal(all.filter((l) => l === 'Clients').length, 1);
  assert.equal(all.length, 20);
});

test('clientModelsFor: CM-3 only for PRD, MFG, CST', () => {
  const has3 = (i) => clientModelsFor(i).some((c) => c.code === 'CM-3');
  assert.equal(has3('PRD'), true);
  assert.equal(has3('MFG'), true);
  assert.equal(has3('CST'), true);
  assert.equal(has3('INT'), false);
  assert.equal(has3('OTH'), false);
  assert.equal(has3(null), false);
  assert.equal(clientModelsFor('INT').length, 4);
});

test('reviewTeamBandsFor hides bands larger than the company', () => {
  const codes = (s) => reviewTeamBandsFor(s).map((b) => b.code);
  assert.deepEqual(codes('CS-01'), ['RT-01']);
  assert.deepEqual(codes('CS-02'), ['RT-01', 'RT-02']);
  assert.deepEqual(codes('CS-03'), ['RT-01', 'RT-02', 'RT-03']);
  assert.equal(codes('CS-08').length, 6);
  assert.equal(codes(null).length, 6);
  assert.equal(codes('bogus').length, 6);
});

test('fileTypeGroupsFor orders groups by industry and ends with Other', () => {
  assert.equal(fileTypeGroupsFor('PRD')[0].group, '3d_cad');
  assert.equal(fileTypeGroupsFor('ARC')[0].group, '2d_docs');
  assert.equal(fileTypeGroupsFor('VIZ')[0].group, 'images');
  assert.equal(fileTypeGroupsFor(null)[0].group, '3d_cad');
  const last = fileTypeGroupsFor('INT').at(-1);
  assert.equal(last.group, null);
  assert.deepEqual(last.types.map((t) => t.code), ['FT-99']);
  const total = fileTypeGroupsFor('GRD').reduce((n, g) => n + g.types.length, 0);
  assert.equal(total, FILE_TYPES.length);
});

test('matchesSearch: label or synonym, case-insensitive; empty query matches', () => {
  const cnc = ROLES.find((r) => r.code === 'RL-33');
  assert.equal(matchesSearch(cnc, 'CNC'), true);
  assert.equal(matchesSearch(cnc, 'machining'), true);
  assert.equal(matchesSearch(cnc, 'architect'), false);
  assert.equal(matchesSearch(cnc, '  '), true);
  assert.equal(matchesSearch(ROLES.find((r) => r.code === 'RL-31'), 'molding'), true);
  assert.equal(matchesSearch(ROLES.find((r) => r.code === 'RL-60'), 'millwork'), true);
});

test('normaliseDomain stores the bare domain or rejects', () => {
  const cases = [
    ['acme.com', 'acme.com'], ['  ACME.com ', 'acme.com'], ['https://www.Acme.com/about?x=1', 'acme.com'],
    ['http://shop.acme.co.uk:8080/', 'shop.acme.co.uk'], ['www.acme.com.', 'acme.com'],
    ['jo@acme.com', 'acme.com'], ['acme', null], ['', null], ['http://', null],
    ['192.168.0.1', null], ['ac me.com', null], ['-acme.com', null],
  ];
  for (const [input, want] of cases) assert.equal(normaliseDomain(input), want, input);
});

test('emailDomain only for business email', () => {
  assert.equal(emailDomain('jo@Acme.com'), 'acme.com');
  assert.equal(emailDomain('jo@gmail.com'), null);
  assert.equal(isBusinessEmail('jo@hotmail.ca'), false);
  assert.equal(isBusinessEmail('jo@ergonic.ca'), true);
});

test('trackForSize', () => {
  assert.equal(trackForSize('CS-01'), 'prosumer');
  assert.equal(trackForSize('CS-02'), 'small_team');
  assert.equal(trackForSize('CS-05'), 'mid_team');
  assert.equal(trackForSize('CS-08'), 'large_team');
  assert.equal(trackForSize('just_me'), null);
});

test('fileTypeSupported follows lib/fileFormats.ts, not the source doc', () => {
  assert.equal(fileTypeSupported(ft('FT-WEBP')), true);
  assert.equal(fileTypeSupported(ft('FT-MOV')), true);
  assert.equal(fileTypeSupported(ft('FT-STEP')), true);
  assert.equal(fileTypeSupported(ft('FT-USD')), false);
  assert.equal(fileTypeSupported(ft('FT-BIM')), false);
  assert.equal(fileTypeSupported(ft('FT-99')), false);
  assert.equal(fileTypeSupported(ft('FT-SLDPRT')), SUPPORTED_EXTENSIONS.has('sldprt'));
});

test('validateCompany accepts a full answer and maps reviewers to codes', () => {
  const r = validateCompany(VALID, 'jo@acme.com');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    companyDomain: 'acme.com', websiteSource: 'prefilled', industry: 'MFG', industryOtherText: null,
    markets: ['MK-11', 'MK-15'], marketOtherText: null, clientModel: 'CM-3', companySize: 'CS-04',
    reviewTeamSize: 'RT-03', reviewerCodes: ['ER-CLIENT', 'ER-TOOLING'], fileTypes: ['FT-STEP', 'FT-PDF'],
    fileTypeOtherText: null,
  });
});

test('validateCompany: website source', () => {
  assert.equal(validateCompany({ ...VALID, website: 'other.io' }, 'jo@acme.com').value.websiteSource, 'typed');
  assert.equal(validateCompany(VALID, 'jo@gmail.com').value.websiteSource, 'typed');
  const none = validateCompany({ ...VALID, website: '', noWebsite: true }, 'jo@acme.com').value;
  assert.equal(none.websiteSource, 'none');
  assert.equal(none.companyDomain, null);
});

test('validateCompany: reviewers sharing a code are stored once', () => {
  const r = validateCompany(
    { ...VALID, industry: 'IND', clientModel: 'CM-1', reviewers: ['rv-manufacturers', 'rv-prototype-shops'] },
    'jo@acme.com'
  );
  assert.deepEqual(r.value.reviewerCodes, ['ER-MANUFACTURER']);
});

test('validateCompany: optional multi-selects may be empty or absent', () => {
  const { reviewers, fileTypes, ...rest } = VALID;
  const r = validateCompany(rest, 'jo@acme.com');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.reviewerCodes, []);
  assert.deepEqual(r.value.fileTypes, []);
});

test('validateCompany reports the first bad field', () => {
  const bad = (patch, field) =>
    assert.deepEqual(validateCompany({ ...VALID, ...patch }, 'jo@acme.com'), { ok: false, field }, JSON.stringify(patch));
  bad({ website: 'not a site' }, 'website');
  bad({ website: '' }, 'website');
  bad({ industry: 'XX' }, 'industry');
  bad({ industry: 'OTH', clientModel: 'CM-1' }, 'industryOtherText');
  bad({ industry: 'OTH', industryOtherText: 'x'.repeat(121), clientModel: 'CM-1' }, 'industryOtherText');
  bad({ markets: [] }, 'markets');
  bad({ markets: ['MK-01', 'MK-02', 'MK-03', 'MK-04'] }, 'markets');
  bad({ markets: ['MK-01', 'MK-01'] }, 'markets');
  bad({ markets: ['MK-77'] }, 'markets');
  bad({ markets: 'MK-01' }, 'markets');
  bad({ markets: ['MK-99'] }, 'marketOtherText');
  bad({ industry: 'INT', clientModel: 'CM-3', reviewers: [] }, 'clientModel');
  bad({ companySize: 'CS-99' }, 'companySize');
  bad({ companySize: 'CS-02', reviewTeamSize: 'RT-03' }, 'reviewTeamSize');
  bad({ reviewers: ['rv-agencies'] }, 'reviewers');
  bad({ reviewers: ['rv-customers', 'rv-customers'] }, 'reviewers');
  bad({ fileTypes: ['FT-NOPE'] }, 'fileTypes');
  bad({ fileTypes: ['FT-99'] }, 'fileTypeOtherText');
  assert.deepEqual(validateCompany(null, ''), { ok: false, field: 'website' });
});

test('validateCompany keeps Other text trimmed', () => {
  const r = validateCompany(
    { ...VALID, industry: 'OTH', industryOtherText: '  Boat building ', clientModel: 'CM-1', reviewers: [],
      markets: ['MK-99'], marketOtherText: ' Yachts ', fileTypes: ['FT-99'], fileTypeOtherText: ' .skp ' },
    'jo@acme.com'
  );
  assert.equal(r.value.industryOtherText, 'Boat building');
  assert.equal(r.value.marketOtherText, 'Yachts');
  assert.equal(r.value.fileTypeOtherText, '.skp');
});

test('validateRole filters by industry; null industry gets the combined list', () => {
  assert.deepEqual(validateRole({ role: 'RL-33' }, 'MFG'), { ok: true, value: { roleCode: 'RL-33', roleOtherText: null } });
  assert.deepEqual(validateRole({ role: 'RL-40' }, 'MFG'), { ok: false, field: 'role' });
  assert.equal(validateRole({ role: 'RL-40' }, null).ok, true);
  assert.equal(validateRole({ role: 'RL-40' }, 'OTH').ok, true);
  assert.deepEqual(validateRole({ role: 'RL-99' }, 'MFG'), { ok: false, field: 'roleOtherText' });
  assert.deepEqual(validateRole({ role: 'RL-99', roleOtherText: ' Owner of a shop ' }, 'MFG').value,
    { roleCode: 'RL-99', roleOtherText: 'Owner of a shop' });
  assert.deepEqual(validateRole({}, null), { ok: false, field: 'role' });
});

test('deriveCompany', () => {
  const d = deriveCompany(validateCompany(VALID, 'jo@acme.com').value);
  assert.deepEqual(d, {
    parentSegment: 'PD', primaryMarket: 'MK-11', sizeMin: 10, sizeMax: 24, rtMin: 5, rtMax: 9,
    icpSizeFit: true, track: 'mid_team',
    fileTypeSupport: [{ code: 'FT-STEP', supported: true }, { code: 'FT-PDF', supported: true }],
  });
  const small = deriveCompany(validateCompany({ ...VALID, companySize: 'CS-02', reviewTeamSize: 'RT-02' }, '').value);
  assert.equal(small.icpSizeFit, false);
  const big = deriveCompany(validateCompany({ ...VALID, companySize: 'CS-08', reviewTeamSize: 'RT-06' }, '').value);
  assert.equal(big.sizeMax, null);
  assert.equal(big.rtMax, null);
  const other = deriveCompany(validateCompany({ ...VALID, industry: 'OTH', industryOtherText: 'x', clientModel: 'CM-1', reviewers: [] }, '').value);
  assert.equal(other.parentSegment, null);
});

test('deriveRole', () => {
  assert.deepEqual(deriveRole('RL-20'), { roleFamily: 'leadership', seniority: 'owner_exec', decisionMaker: true, nonBuyer: false });
  assert.deepEqual(deriveRole('RL-21'), { roleFamily: 'engineering', seniority: 'director', decisionMaker: true, nonBuyer: false });
  assert.deepEqual(deriveRole('RL-22'), { roleFamily: 'engineering', seniority: 'manager_lead', decisionMaker: false, nonBuyer: false });
  assert.deepEqual(deriveRole('RL-10'), { roleFamily: 'education', seniority: 'student', decisionMaker: false, nonBuyer: true });
  assert.deepEqual(deriveRole('RL-99'), { roleFamily: 'other', seniority: null, decisionMaker: false, nonBuyer: false });
});

test('decideOnboarding', () => {
  const d = (roleDone, companyDone, needsCompany) => decideOnboarding({ roleDone, companyDone, needsCompany });
  assert.equal(d(false, false, true), 'full');
  assert.equal(d(false, false, false), 'role');
  assert.equal(d(false, true, true), 'role');
  assert.equal(d(true, false, false), 'company');
  assert.equal(d(true, false, true), 'company');
  assert.equal(d(true, true, true), 'done');
  assert.equal(d(true, true, false), 'done');
});

test('allowedSubmission: the expected kind, or a company edit once done', () => {
  assert.equal(allowedSubmission('full', 'full'), true);
  assert.equal(allowedSubmission('role', 'full'), false);
  assert.equal(allowedSubmission('company', 'full'), false);
  assert.equal(allowedSubmission('role', 'role'), true);
  assert.equal(allowedSubmission('full', 'role'), false);
  assert.equal(allowedSubmission('company', 'company'), true);
  assert.equal(allowedSubmission('company', 'done'), true);
  assert.equal(allowedSubmission('full', 'done'), false);
  assert.equal(allowedSubmission('role', 'done'), false);
});
