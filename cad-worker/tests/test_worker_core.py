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
        self.send_response(200)
        self.send_header('Content-Length', str(len(Fake.source)))
        self.end_headers()
        self.wfile.write(Fake.source)

    def do_PUT(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        Fake.puts.append((self.path, self.headers['Content-Type'], body))
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        Fake.callbacks.append(body)
        status = Fake.callback_statuses.pop(0) if Fake.callback_statuses else 200
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
])
def test_wrong_scheme_or_host_is_refused(field, url):
    body = valid()
    body[field] = url
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 400


def test_only_sldprt_is_accepted():
    body = valid()
    body['filename'] = 'a.sldasm'
    with pytest.raises(Refused) as e:
        worker_core.validate_job(body, STORAGE, CALLBACK)
    assert e.value.status == 422


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


def test_a_converter_timeout_is_a_verdict(tmp_path):
    import subprocess
    def run(*a, **k):
        raise subprocess.TimeoutExpired(cmd='usd-convert-cad', timeout=1)
    with pytest.raises(JobFailed, match='timeout'):
        worker_core.run_converter(tmp_path / 'a.sldprt', tmp_path / 'a.usdc', run=run)
