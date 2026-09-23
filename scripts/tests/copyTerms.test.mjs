import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * "Submission" is the user-facing word; "version" survives only in code. This
 * is the same rule as portal -> package (see the 2026-09-22 submissions spec).
 *
 * Walks every string literal, template-literal chunk and JSX text under app/,
 * components/ and lib/, and fails on any that still says "version", "versions",
 * "versioned" or "versioning", or that renders a V- or v-badge (`V${n}`, or
 * V{n} in JSX), outside the short list below of strings that are not about
 * submissions at all.
 *
 * Skipped by construction: the text of sql`` templates (table and column
 * names; templates nested in their ${} are still checked), import specifiers,
 * string-literal TYPES, and strings starting with "/" (routes like /api/versions).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORD = /\bversion(s|ed|ing)?\b/i;
// A V- or v-badge right before an interpolation: `V${n}` in a template, V{n} in JSX.
const BADGE_TAIL = /(^|[^A-Za-z])[Vv]\s*$/;

/** Strings that say "version" and mean something other than a submission. */
const ALLOWED = [
  // Developer diagnostics: logged, never rendered.
  (file, text) => /^Failed to fetch\b/.test(text),
  // "This version" of the APP, in the missing-migration error.
  (file, text) => /this version needs\. Run `npm run migrate`/.test(text),
  // The change feed's entity key: an identifier that happens to be a string.
  (file, text) => file === 'lib/portalActivity.ts' && text === 'versions',
];

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(path.join(ROOT, d));
  return out;
}

function findOffenders() {
  const offenders = [];
  for (const abs of sourceFiles()) {
    const file = path.relative(ROOT, abs).split(path.sep).join('/');
    const sf = ts.createSourceFile(
      abs,
      fs.readFileSync(abs, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    // Only a sql`` template's OWN text is SQL.
    const isSqlText = (n) => {
      let tpl = null;
      if (ts.isNoSubstitutionTemplateLiteral(n)) tpl = n;
      else if (ts.isTemplateHead(n)) tpl = n.parent;
      else if (ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) tpl = n.parent.parent;
      return !!tpl && ts.isTaggedTemplateExpression(tpl.parent) && tpl.parent.tag.getText(sf) === 'sql';
    };

    const flag = (n, text, why) => {
      if (ALLOWED.some((ok) => ok(file, text))) return;
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      offenders.push(`${file}:${line + 1} ${why}: ${JSON.stringify(text.trim().slice(0, 100))}`);
    };

    const visit = (n) => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
      if (
        ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
      ) {
        const text = n.text;
        if (!isSqlText(n) && !text.startsWith('/')) {
          if (WORD.test(text)) flag(n, text, 'says "version"');
          else if ((ts.isTemplateHead(n) || ts.isTemplateMiddle(n)) && BADGE_TAIL.test(text)) {
            flag(n, text, 'V-badge');
          }
        }
      } else if (ts.isJsxText(n)) {
        if (WORD.test(n.text)) flag(n, n.text, 'says "version"');
        else if (BADGE_TAIL.test(n.text)) flag(n, n.text, 'V-badge');
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return offenders;
}

test('no user-facing string says "version": the word is "submission"', () => {
  const offenders = findOffenders();
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`);
});
