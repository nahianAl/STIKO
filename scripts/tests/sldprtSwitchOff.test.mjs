// This locks in the production kill switches. NEXT_PUBLIC_CAD_CONVERSION_FORMATS (a list, or 'off')
// is the rollback for every converted format; unset, the legacy NEXT_PUBLIC_SLDPRT_CONVERSION=off
// still rolls back SolidWorks alone. Every other test runs with both unset (SolidWorks on).
// lib/fileFormats.ts reads the variables once, at import, so each case runs in a child process with
// its own environment. With a format off, uploads of it are refused with its export advice, but a
// part that was already converted must keep opening: opensAsModel decides a CAD file by its GLB,
// not the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FORMATS = pathToFileURL(fileURLToPath(new URL('../../lib/fileFormats.ts', import.meta.url))).href;
const CONVERSION = pathToFileURL(fileURLToPath(new URL('../../lib/cadConversion.ts', import.meta.url))).href;

const SCRIPT = `
const f = await import(${JSON.stringify(FORMATS)});
const c = await import(${JSON.stringify(CONVERSION)});
console.log(JSON.stringify({
  supported: f.SUPPORTED_EXTENSIONS.has('sldprt'),
  modelFormats: f.MODEL_FORMATS.includes('sldprt'),
  accept: f.ACCEPT_ATTRIBUTE.split(',').includes('.sldprt'),
  advice: f.adviceFor('P.SLDPRT'),
  convertedOpens: c.opensAsModel('p.sldprt', 'k/p.sldprt.glb'),
  unconvertedOpens: c.opensAsModel('p.sldprt', null),
  stepOpens: c.opensAsModel('a.step', null),
  dwgSupported: f.isSupportedFilename('a.dwg'),
  iptSupported: f.isSupportedFilename('a.ipt'),
  sldprtAdvice: f.adviceFor('a.sldprt'),
  sldprtSupported: f.isSupportedFilename('a.sldprt'),
  anyConverted: ['a.sldprt', 'a.sldasm', 'a.ipt', 'a.catpart', 'a.prt', 'a.x_t', 'a.x_b', 'a.jt', 'a.sat']
    .filter((n) => f.isSupportedFilename(n)),
  iptConvertedOpens: c.opensAsModel('a.ipt', 'k/a.ipt.glb'),
  iptPending: c.isPendingCad('a.ipt', null),
}));
`;

// A case's environment: the legacy switch and the format list. Anything inherited from the parent
// is deleted first, so a developer's or CI's own setting cannot change what a case proves.
function run(legacy, list) {
  const env = { ...process.env };
  delete env.NEXT_PUBLIC_CAD_CONVERSION_FORMATS;
  delete env.NEXT_PUBLIC_SLDPRT_CONVERSION;
  if (legacy !== undefined) env.NEXT_PUBLIC_SLDPRT_CONVERSION = legacy;
  if (list !== undefined) env.NEXT_PUBLIC_CAD_CONVERSION_FORMATS = list;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
    env,
    cwd: ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

for (const value of ['off', ' OFF ']) {
  test(`with the switch ${JSON.stringify(value)}, .sldprt is refused with advice and converted parts still open`, () => {
    const r = run(value);
    assert.equal(r.supported, false, 'SUPPORTED_EXTENSIONS must not have sldprt');
    assert.equal(r.modelFormats, false, 'MODEL_FORMATS must not have sldprt');
    assert.equal(r.accept, false, 'ACCEPT_ATTRIBUTE must not offer .sldprt');
    assert.deepEqual(r.advice, { app: 'SolidWorks', advice: 'Save As STEP, then upload.' });
    assert.equal(r.convertedOpens, true, 'an already-converted part must keep opening');
    assert.equal(r.unconvertedOpens, false);
    assert.equal(r.stepOpens, true);
    assert.equal(r.dwgSupported, true);
  });
}

test('with the switch "on", .sldprt is supported and has no refusal advice', () => {
  const r = run('on');
  assert.equal(r.supported, true);
  assert.equal(r.accept, true);
  assert.equal(r.advice, null);
});

test('with the legacy switch unset, .sldprt is supported (today\'s behaviour)', () => {
  const r = run(undefined);
  assert.equal(r.supported, true);
  assert.equal(r.iptSupported, false);
});

test('NEW switch "ipt": Inventor parts are accepted, SolidWorks parts are refused with their advice', () => {
  const r = run(undefined, 'ipt');
  assert.equal(r.iptSupported, true);
  assert.equal(r.sldprtSupported, false);
  assert.deepEqual(r.sldprtAdvice, { app: 'SolidWorks', advice: 'Save As STEP, then upload.' });
  assert.equal(r.convertedOpens, true, 'an already-converted .sldprt must keep opening');
});

test('NEW switch "off": none of the converted formats is supported', () => {
  const r = run(undefined, 'off');
  assert.deepEqual(r.anyConverted, []);
});

test('the NEW switch wins over the legacy one: "sldprt" with legacy "off" still converts SolidWorks', () => {
  const r = run('off', 'sldprt');
  assert.equal(r.sldprtSupported, true);
  assert.equal(r.accept, true);
  assert.equal(r.advice, null);
});

test('a format switched off by the NEW switch still opens once converted, and shows as pending until then', () => {
  const r = run(undefined, 'sldprt');
  assert.equal(r.iptSupported, false);
  assert.equal(r.iptConvertedOpens, true, 'an already-converted .ipt must keep opening');
  assert.equal(r.iptPending, true, 'an unconverted .ipt is pending, not a plain unsupported file');
});
