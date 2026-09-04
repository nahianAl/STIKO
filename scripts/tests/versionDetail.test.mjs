import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uploaderLabel,
  formatFileSize,
  versionSubtitle,
  changelogFallback,
  fileMetaLine,
} from '../../lib/versionDetail.ts';

// --- Who uploaded it ------------------------------------------------------

test('a known uploader is named', () => {
  assert.equal(uploaderLabel('Maya Chen'), 'Maya Chen');
});

test('a missing uploader is stated, not guessed', () => {
  // uploaded_by is ON DELETE SET NULL, and pre-migration-005 rows were
  // backfilled from versions.created_by, which can itself be null.
  assert.equal(uploaderLabel(null), 'Uploader unknown');
});

test('an empty name is treated as missing, not printed as blank', () => {
  assert.equal(uploaderLabel(''), 'Uploader unknown');
});

// --- Sizes ----------------------------------------------------------------

test('bytes below a kilobyte are shown as bytes', () => {
  assert.equal(formatFileSize(900), '900 B');
});

test('kilobytes carry one decimal', () => {
  assert.equal(formatFileSize(2048), '2.0 KB');
});

test('megabytes carry one decimal', () => {
  assert.equal(formatFileSize(2516582), '2.4 MB');
});

test('the boundary at one kibibyte is a kilobyte, not 1024 bytes', () => {
  assert.equal(formatFileSize(1024), '1.0 KB');
});

test('the boundary at one mebibyte is a megabyte', () => {
  assert.equal(formatFileSize(1048576), '1.0 MB');
});

// --- The drawer header ----------------------------------------------------

test('the current published version says so', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: true,
      isPublished: true,
      dateLabel: 'Sep 2, 2026',
      createdByName: 'Maya Chen',
    }),
    'Current · Published Sep 2, 2026 by Maya Chen'
  );
});

test('an older published version omits the Current marker', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: false,
      isPublished: true,
      dateLabel: 'Aug 28, 2026',
      createdByName: 'Maya Chen',
    }),
    'Published Aug 28, 2026 by Maya Chen'
  );
});

test('a draft is labelled a draft and dated by creation', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: true,
      isPublished: false,
      dateLabel: 'Sep 2, 2026',
      createdByName: 'Maya Chen',
    }),
    'Draft · Created Sep 2, 2026 by Maya Chen'
  );
});

test('a deleted author drops the by-clause rather than printing null', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: false,
      isPublished: true,
      dateLabel: 'Aug 28, 2026',
      createdByName: null,
    }),
    'Published Aug 28, 2026'
  );
});

// --- The changelog section ------------------------------------------------

test('a real changelog needs no fallback', () => {
  assert.equal(
    changelogFallback({ changelog: 'Reworked the ceiling plan.', isPublished: true }),
    null
  );
});

test('a published version with no changelog says nothing was written', () => {
  assert.equal(
    changelogFallback({ changelog: null, isPublished: true }),
    'No description was written for this version.'
  );
});

test('whitespace is not a changelog', () => {
  assert.equal(
    changelogFallback({ changelog: '   \n  ', isPublished: true }),
    'No description was written for this version.'
  );
});

test('a draft says it is not published rather than that nothing was written', () => {
  // The changelog is captured at publish time, so a draft has not had the
  // chance to carry one. Reporting it as missing would blame the uploader.
  assert.equal(
    changelogFallback({ changelog: null, isPublished: false }),
    'Not published yet.'
  );
});

// --- The file card meta line ----------------------------------------------

test('the meta line joins uploader, date and size', () => {
  assert.equal(
    fileMetaLine({
      uploadedByName: 'Maya Chen',
      dateLabel: 'Sep 2, 4:12 PM',
      fileSize: 2516582,
    }),
    'Maya Chen · Sep 2, 4:12 PM · 2.4 MB'
  );
});

test('the meta line still reads correctly with no uploader', () => {
  assert.equal(
    fileMetaLine({
      uploadedByName: null,
      dateLabel: 'Aug 30, 11:02 AM',
      fileSize: 921600,
    }),
    'Uploader unknown · Aug 30, 11:02 AM · 900.0 KB'
  );
});
