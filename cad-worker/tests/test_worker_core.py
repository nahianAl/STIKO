"""worker_core against a fake storage + callback server. No Modal, no GPU."""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import worker_core  # noqa: E402
from worker_core import JobFailed, Refused  # noqa: E402

GLB = b'glTF' + b'\x02\x00\x00\x00' + b'\x0c\x00\x00\x00'


class Fake(BaseHTTPRequestHandler):
    source = b'SLDPRT-BYTES'
    puts, callbacks, callback_statuses = [], [], []

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', '/source')
            self.end_headers()
            return
        if self.path == '/truncated':
            self.send_response(200)
            self.send_header('Content-Length', '100')
            self.end_headers()
            self.wfile.write(b'0123456789')
            return
        self.send_response(200)
        self.send_header('Content-Length', str(len(Fake.source)))
        self.end_headers()
        self.wfile.write(Fake.source)

    def do_PUT(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        Fake.puts.append((self.path, self.headers['Content-Type'], body))
        self.send_response(403 if self.path == '/forbidden' else 200)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        Fake.callbacks.append(body)
        status = Fake.callback_statuses.pop(0) if Fake.callback_statuses else 200
        if status == 'garbage':
            self.wfile.write(b'garbage\r\n')
            return
        self.send_response(status)
        self.end_headers()


@pytest.fixture
def server():
    Fake.source, Fake.puts, Fake.callbacks, Fake.callback_statuses = b'SLDPRT-BYTES', [], [], []
    srv = ThreadingHTTPServer(('127.0.0.1', 0), Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()
    srv.server_close()


def job(base, **over):
    j = {'sourceUrl': f'{base}/source', 'targetUrl': f'{base}/target', 'callbackUrl': f'{base}/callback',
         'fileId': 'f1', 'claimId': 'cad:1:2026-10-18T10:00:00.000Z', 'token': 'tok', 'filename': 'Part.SLDPRT'}
    j.update(over)
    return j


def fake_convert(src, usd, glb):
    assert src.read_bytes() == Fake.source
    glb.write_bytes(GLB)


# --- validate_job -----------------------------------------------------------------------------

STORAGE = worker_core.parse_hosts('.r2.cloudflarestorage.com')
CALLBACK = worker_core.parse_hosts('app.stiko.design')


def valid():
    return {'sourceUrl': 'https://acct.r2.cloudflarestorage.com/b/a.sldprt?X-Amz=1',
            'targetUrl': 'https://acct.r2.cloudflarestorage.com/b/a.sldprt.glb?X-Amz=1',
            'callbackUrl': 'https://app.stiko.design/api/conversions/cad-callback',
            'fileId': 'f', 'claimId': 'cad:1:x', 'token': 't', 'filename': 'a.sldprt'}


def test_a_valid_job_passes():
    assert worker_core.validate_job(valid(), STORAGE, CALLBACK)['fileId'] == 'f'


@pytest.mark.parametrize('field', worker_core.JOB_FIELDS)
def test_every_field_is_required(field):
    body = valid()
    del body[field]
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 400


@pytest.mark.parametrize('field,url', [
    ('sourceUrl', 'http://acct.r2.cloudflarestorage.com/b/a'),
    ('targetUrl', 'https://evil.example/b/a'),
    ('callbackUrl', 'https://app.stiko.design.evil.example/cb'),
    ('callbackUrl', 'http://app.stiko.design/cb'),
    ('sourceUrl', 'https://[abc/b/a'),
    ('sourceUrl', 'https://user:pw@acct.r2.cloudflarestorage.com/x'),
    ('targetUrl', 'https://acct.r2.cloudflarestorage.com:8443/x'),
    ('callbackUrl', 'https://app.stiKo.design/cb'),  # U+212A KELVIN SIGN, lowercases to ASCII k
])
def test_wrong_scheme_or_host_is_refused(field, url):
    body = valid()
    body[field] = url
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 400


@pytest.mark.parametrize('name,suffix', [
    ('a.sldprt', '.sldprt'), ('A.SLDPRT', '.sldprt'), ('asm.SLDASM', '.sldasm'), ('a.sldasm', '.sldasm'),
    ('bracket.ipt', '.ipt'), ('b.CATPart', '.catpart'),
    ('nx_part.prt', '.prt'), ('creo_part.prt.5', '.prt.5'), ('CREO.PRT.12', '.prt.12'),
    ('m.x_t', '.x_t'), ('m.X_B', '.x_b'), ('m.jt', '.jt'), ('m.sat', '.sat'), ('dir/sub/m.jt', '.jt'),
])
def test_input_suffix_for_convertible_files(name, suffix):
    assert worker_core.input_suffix(name) == suffix


@pytest.mark.parametrize('name', [
    'a.iam', 'a.catproduct', 'a.asm', 'a.asm.3', 'a.par', 'a.rvt', 'a.ifc', 'a.step',
    'notes.5', '.prt', '.prt.5', 'prt', 'a.prt.', 'a.prt.x', '',
    'a.prt.٥',  # Arabic-Indic five: \d would match it, the worker must not
    'a.prt.５',  # fullwidth five
    'a.prt.5\n',     # \Z, not $, so a trailing newline is not a version number
])
def test_input_suffix_refuses_everything_else(name):
    assert worker_core.input_suffix(name) is None


@pytest.mark.parametrize('name', ['a.ipt', 'a.prt.5', 'a.jt', 'a.sldprt', 'a.sldasm'])
def test_convertible_formats_are_accepted(name):
    body = valid()
    body['filename'] = name
    assert worker_core.validate_job(body, STORAGE, CALLBACK)['filename'] == name


@pytest.mark.parametrize('name', ['a.iam', 'a.rvt', 'a.step'])
def test_other_formats_are_refused_with_422(name):
    body = valid()
    body['filename'] = name
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 422


def test_the_input_keeps_the_real_suffix(server, tmp_path):
    seen = []

    def convert(src, usd, glb):
        seen.append(src.name)
        glb.write_bytes(GLB)

    worker_core.process_job(job(server, filename='creo_bracket.prt.5'), tmp_path, convert=convert, sleep=lambda s: None)
    worker_core.process_job(job(server, filename='Part.SLDPRT'), tmp_path, convert=convert, sleep=lambda s: None)
    assert seen == ['input.prt.5', 'input.sldprt']


# --- process_job ------------------------------------------------------------------------------

def test_success_uploads_the_glb_and_reports_it(server, tmp_path):
    payload = worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=lambda s: None)
    assert payload == {'fileId': 'f1', 'claimId': 'cad:1:2026-10-18T10:00:00.000Z', 'token': 'tok', 'ok': True, 'glbBytes': len(GLB)}
    assert Fake.puts == [('/target', 'model/gltf-binary', GLB)]
    assert Fake.callbacks == [payload]


def test_too_large_is_a_verdict_and_nothing_is_uploaded(server, tmp_path, monkeypatch):
    monkeypatch.setattr(worker_core, 'MAX_INPUT_BYTES', 4)
    payload = worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=lambda s: None)
    assert payload['ok'] is False and payload['reason'] == 'too_large'
    assert Fake.puts == [] and Fake.callbacks == [payload]


def test_a_conversion_verdict_is_reported(server, tmp_path):
    def unreadable(src, usd, glb):
        raise JobFailed('unreadable: bad file')
    payload = worker_core.process_job(job(server), tmp_path, convert=unreadable, sleep=lambda s: None)
    assert payload['ok'] is False and payload['reason'] == 'unreadable: bad file'
    assert Fake.callbacks == [payload]


def test_a_transient_failure_reports_nothing(server, tmp_path):
    def crash(src, usd, glb):
        raise RuntimeError('GPU fell over')
    assert worker_core.process_job(job(server), tmp_path, convert=crash, sleep=lambda s: None) is None
    assert Fake.callbacks == []


def test_a_redirecting_source_is_not_followed(server, tmp_path):
    assert worker_core.process_job(job(server, sourceUrl=f'{server}/redirect'), tmp_path,
                                   convert=fake_convert, sleep=lambda s: None) is None
    assert Fake.puts == [] and Fake.callbacks == []


def test_the_callback_is_retried_on_5xx(server, tmp_path):
    Fake.callback_statuses = [503, 502, 200]
    slept = []
    worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=slept.append)
    assert len(Fake.callbacks) == 3 and len(slept) == 2


def test_the_callback_is_not_retried_on_4xx(server, tmp_path):
    Fake.callback_statuses = [401]
    worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=lambda s: None)
    assert len(Fake.callbacks) == 1


def test_a_truncated_download_is_transient(server, tmp_path):
    calls = []
    def convert(src, usd, glb):
        calls.append(src)
        glb.write_bytes(GLB)
    assert worker_core.process_job(job(server, sourceUrl=f'{server}/truncated'), tmp_path,
                                   convert=convert, sleep=lambda s: None) is None
    assert calls == [] and Fake.puts == [] and Fake.callbacks == []


def test_a_403_on_the_upload_is_transient_and_reports_nothing(server, tmp_path):
    assert worker_core.process_job(job(server, targetUrl=f'{server}/forbidden'), tmp_path,
                                   convert=fake_convert, sleep=lambda s: None) is None
    assert Fake.callbacks == []


def test_a_garbage_callback_response_is_retried(server, tmp_path):
    Fake.callback_statuses = ['garbage', 200]
    slept = []
    payload = worker_core.process_job(job(server), tmp_path, convert=fake_convert, sleep=slept.append)
    assert payload is not None and len(Fake.callbacks) == 2 and len(slept) == 1


# --- default_convert's GLB check ------------------------------------------------------------------

def test_usd_to_glb_exit_3_is_a_verdict(tmp_path):
    class R:
        returncode, stdout, stderr = 3, '', 'no visible mesh in the converted part'
    with pytest.raises(JobFailed, match='no visible mesh'):
        worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=lambda *a, **k: R())


def test_output_that_is_not_a_glb_is_a_verdict(tmp_path):
    class R:
        returncode, stdout, stderr = 0, '{}', ''
    def run(*a, **k):
        (tmp_path / 'a.glb').write_bytes(b'not a glb')
        return R()
    with pytest.raises(JobFailed, match='bad_glb'):
        worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=run)


def _writes_glb_of(tmp_path, size):
    """A fake usd_to_glb run that leaves a valid-header GLB of exactly `size` bytes."""
    class R:
        returncode, stdout, stderr = 0, '{}', ''
    def run(*a, **k):
        (tmp_path / 'a.glb').write_bytes(b'glTF' + b'\0' * (size - 4))
        return R()
    return run


def test_a_glb_over_the_output_cap_is_a_verdict(tmp_path, monkeypatch):
    monkeypatch.setattr(worker_core, 'MAX_OUTPUT_BYTES', 64)
    with pytest.raises(JobFailed, match='too_large_output'):
        worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=_writes_glb_of(tmp_path, 65))


@pytest.mark.parametrize('size', [12, 63, 64])
def test_a_glb_at_or_below_the_output_cap_passes(tmp_path, monkeypatch, size):
    monkeypatch.setattr(worker_core, 'MAX_OUTPUT_BYTES', 64)
    worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=_writes_glb_of(tmp_path, size))


def test_the_output_cap_is_150_mb():
    assert worker_core.MAX_OUTPUT_BYTES == 150 * 1024 * 1024


def test_an_oversized_glb_is_reported_and_never_uploaded(server, tmp_path, monkeypatch):
    monkeypatch.setattr(worker_core, 'MAX_OUTPUT_BYTES', 8)
    class R:
        returncode, stdout, stderr = 0, '{}', ''
    def convert(src, usd, glb):
        def run(*a, **k):
            glb.write_bytes(b'glTF' + b'\0' * 60)
            return R()
        worker_core.run_usd_to_glb(usd, glb, run=run)
    payload = worker_core.process_job(job(server), tmp_path, convert=convert, sleep=lambda s: None)
    assert payload['ok'] is False and payload['reason'] == 'too_large_output'
    assert Fake.puts == [] and Fake.callbacks == [payload]


def test_a_converter_timeout_is_a_verdict(tmp_path):
    import subprocess
    def run(*a, **k):
        raise subprocess.TimeoutExpired(cmd='usd-convert-cad', timeout=1)
    with pytest.raises(JobFailed, match='timeout'):
        worker_core.run_converter(tmp_path / 'a.sldprt', tmp_path / 'a.usdc', run=run)


def test_a_converter_killed_by_a_signal_is_transient(tmp_path):
    class R:
        returncode, stdout, stderr = -9, '', ''
    with pytest.raises(RuntimeError) as e:
        worker_core.run_converter(tmp_path / 'a.sldprt', tmp_path / 'a.usdc', run=lambda *a, **k: R())
    assert not isinstance(e.value, JobFailed)


def test_a_converter_nonzero_exit_is_a_verdict(tmp_path):
    class R:
        returncode, stdout, stderr = 1, '', 'cannot parse'
    with pytest.raises(JobFailed, match='unreadable'):
        worker_core.run_converter(tmp_path / 'a.sldprt', tmp_path / 'a.usdc', run=lambda *a, **k: R())


@pytest.mark.parametrize('name,head,expected', [
    ('input.catpart', b'V5_CFV2\x00', True),
    ('input.prt', b'SPLMSSTR' + b'\x00' * 8, True),       # NX
    ('input.prt', b'#UGC:2 PART 2159', False),            # Creo, plain .prt
    ('input.prt.5', b'#UGC:2 PART 2159', False),          # Creo version file
    ('input.prt', b'', False),                            # unreadable header keeps its axes
    ('input.sldprt', b'SPLMSSTR', False),
    ('input.sldasm', b'', False),
    ('input.ipt', b'', False), ('input.x_t', b'', False), ('input.jt', b'', False), ('input.sat', b'', False),
])
def test_stands_up_only_catia_and_nx(tmp_path, name, head, expected):
    src = tmp_path / name
    src.write_bytes(head)
    assert worker_core.stands_up(src) is expected


def test_stands_up_on_a_missing_file_is_false(tmp_path):
    assert worker_core.stands_up(tmp_path / 'input.prt') is False


def test_usd_to_glb_gets_the_stand_up_flag(tmp_path):
    calls = []

    class R:
        returncode, stdout, stderr = 0, '{}', ''

    def run(cmd, **kw):
        calls.append(cmd)
        Path(cmd[3]).write_bytes(GLB)
        return R()

    worker_core.run_usd_to_glb(tmp_path / 'a.usdc', tmp_path / 'a.glb', run=run, stand_up=True)
    worker_core.run_usd_to_glb(tmp_path / 'b.usdc', tmp_path / 'b.glb', run=run)
    assert calls[0][-1] == '--stand-up' and '--stand-up' not in calls[1]
