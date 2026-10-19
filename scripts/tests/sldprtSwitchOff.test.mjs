// This locks in the production kill switch. NEXT_PUBLIC_SLDPRT_CONVERSION=off is the only rollback
// for SolidWorks conversion, but every other test runs with it unset (on). lib/fileFormats.ts reads
// the variable once, at import, so each case runs in a child process with its own environment.
// With the switch off, uploads of .sldprt are refused with "Save As STEP" advice, but a part that
// was already converted must keep opening: opensAsModel decides a .sldprt by its GLB, not the switch.
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
}));
`;

function run(value) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
    env: { ...process.env, NEXT_PUBLIC_SLDPRT_CONVERSION: value },
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
