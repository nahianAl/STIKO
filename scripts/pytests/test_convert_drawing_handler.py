# SPDX-License-Identifier: AGPL-3.0-or-later
"""End-to-end: the real handler, a fake presigned-URL store, and a real conversion."""
import http.client
import importlib.util
import json
import os
import signal
import stat
import subprocess
import sys
import threading
import time
import types
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'example_2018.dwg')
SECRET = 'test-secret'

spec = importlib.util.spec_from_file_location('convert_drawing', os.path.join(ROOT, 'converter', 'api', 'convert_drawing.py'))
convert_drawing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(convert_drawing)


class FakeStore(BaseHTTPRequestHandler):
    """Serves GET /source and records PUT /target, like presigned R2 URLs."""
    source = b''
    received = {}
    gets = 0
    paths = []

    def do_GET(self):
        FakeStore.gets += 1
        FakeStore.paths.append(self.path)
        if self.path == '/redirect':  # a storage host that bounces the client elsewhere
            self.send_response(302)
            self.send_header('Location', '/source')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Length', str(len(FakeStore.source)))
        self.end_headers()
        self.wfile.write(FakeStore.source)

    def do_PUT(self):
        FakeStore.received = {
            'type': self.headers.get('Content-Type'),
            'body': self.rfile.read(int(self.headers['Content-Length'])),
        }
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


def serve(handler_cls):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler_cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f'http://127.0.0.1:{server.server_port}'


@pytest.fixture
def servers(monkeypatch):
    monkeypatch.setenv('CAD_CONVERTER_SECRET', SECRET)
    # The fake store is on 127.0.0.1, which the default allowlist (R2 only) would refuse.
    monkeypatch.setenv('CONVERTER_ALLOWED_HOST_SUFFIXES', '127.0.0.1')
    store, store_url = serve(FakeStore)
    fn, fn_url = serve(convert_drawing.handler)
    FakeStore.received = {}
    FakeStore.gets = 0
    FakeStore.paths = []
    yield store_url, fn_url
    store.shutdown()
    fn.shutdown()


def call(fn_url, body, secret=SECRET):
    request = urllib.request.Request(
        fn_url, data=json.dumps(body).encode(), method='POST',
        headers={'Content-Type': 'application/json', 'X-Converter-Secret': secret},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())


def test_a_dwg_is_converted_and_the_pdf_put_to_the_target(servers):
    store_url, fn_url = servers
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'plan.DWG'})
    assert status == 200 and body['pages'] >= 1
    assert FakeStore.received['type'] == 'application/pdf'
    assert FakeStore.received['body'].startswith(b'%PDF')


def test_a_wrong_secret_is_refused_before_anything_is_fetched(servers):
    store_url, fn_url = servers
    status, _ = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'}, secret='nope')
    assert status == 401
    assert FakeStore.gets == 0
    assert FakeStore.received == {}


def test_a_missing_secret_on_the_server_refuses_everything(servers, monkeypatch):
    store_url, fn_url = servers
    monkeypatch.setenv('CAD_CONVERTER_SECRET', '')
    status, _ = call(fn_url, {'sourceUrl': 'x', 'targetUrl': 'y', 'filename': 'a.dwg'}, secret='')
    assert status == 401


def test_bad_bodies_and_other_formats_are_400(servers):
    _, fn_url = servers
    assert call(fn_url, {'sourceUrl': 'x'})[0] == 400
    assert call(fn_url, {'sourceUrl': 'x', 'targetUrl': 'y', 'filename': 'a.pdf'})[0] == 400


def test_an_unreadable_drawing_is_422_and_nothing_is_written(servers):
    store_url, fn_url = servers
    FakeStore.source = b'definitely not a dwg'
    status, body = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'})
    assert status == 422 and body['error']
    assert 'definitely' not in body['error']  # parser detail may carry file content: never echoed
    assert FakeStore.received == {}


def test_the_422_detail_goes_to_stderr_not_the_reply(servers, capsys):
    store_url, fn_url = servers
    FakeStore.source = b'definitely not a dwg'
    status, body = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'})
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert 'convert_drawing: drawing error:' in capsys.readouterr().err


def test_an_oversized_source_is_413(servers, monkeypatch):
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing, 'MAX_SOURCE_BYTES', 10)
    FakeStore.source = b'x' * 100
    status, _ = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dxf'})
    assert status == 413


def test_an_unrunnable_dwg2dxf_is_a_500_not_a_crash_and_nothing_is_written(servers, monkeypatch, capsys):
    """The child lets the OSError through (a server fault, not a bad drawing): it exits 1, not 2."""
    store_url, fn_url = servers
    monkeypatch.setenv('DWG2DXF', '/nonexistent/dwg2dxf')
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'})
    assert status == 500 and body['error'] == 'conversion failed unexpectedly'
    assert FakeStore.received == {}
    logged = capsys.readouterr().err
    assert 'convert_drawing: converter exited 1' in logged and 'FileNotFoundError' in logged


def good_body(store_url, **overrides):
    body = {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'}
    body.update(overrides)
    return body


def test_only_http_and_https_urls_are_accepted_and_nothing_is_fetched(servers):
    store_url, fn_url = servers
    FakeStore.source = open(FIXTURE, 'rb').read()
    # urlopen would happily read a local file and the reply would echo what it parsed of it.
    status, body = call(fn_url, good_body(store_url, sourceUrl='file:///etc/hosts'))
    assert status == 400 and body == {'error': 'sourceUrl and targetUrl must be http(s) URLs'}
    status, body = call(fn_url, good_body(store_url, targetUrl='ftp://x/y'))
    assert status == 400 and body == {'error': 'sourceUrl and targetUrl must be http(s) URLs'}
    assert FakeStore.gets == 0
    assert FakeStore.received == {}


@pytest.mark.parametrize('url', ['', '/just/a/path', 'http://', 'http:///nohost', 'https://:443/x', 'http://host:notaport/x', 'javascript:alert(1)'])
def test_urls_without_a_scheme_or_host_are_400(servers, url):
    store_url, fn_url = servers
    assert call(fn_url, good_body(store_url, sourceUrl=url))[0] == 400
    assert call(fn_url, good_body(store_url, targetUrl=url))[0] == 400
    assert FakeStore.gets == 0


def test_a_url_with_control_characters_is_400_not_500(servers):
    store_url, fn_url = servers
    status, _ = call(fn_url, good_body(store_url, sourceUrl='http://127.0.0.1/a\r\nX-Evil: 1'))
    assert status == 400


def test_non_string_fields_are_400(servers):
    store_url, fn_url = servers
    assert call(fn_url, good_body(store_url, filename=5))[0] == 400
    assert call(fn_url, good_body(store_url, sourceUrl=['http://x/y']))[0] == 400
    assert FakeStore.gets == 0


def post_raw(fn_url, data=b'', content_length=None):
    """POST raw bytes (or just a Content-Length claim) with the right secret."""
    host, port = fn_url.removeprefix('http://').split(':')
    conn = http.client.HTTPConnection(host, int(port), timeout=60)
    conn.putrequest('POST', '/')
    conn.putheader('X-Converter-Secret', SECRET)
    conn.putheader('Content-Length', str(len(data) if content_length is None else content_length))
    conn.endheaders(data)
    response = conn.getresponse()
    try:
        return response.status, json.loads(response.read())
    finally:
        conn.close()


def test_a_non_object_json_body_is_400(servers):
    _, fn_url = servers
    for raw in (b'[1,2]', b'"text"', b'5', b'null'):
        assert post_raw(fn_url, raw)[0] == 400


def test_a_deeply_nested_body_is_400_not_a_crash(servers):
    _, fn_url = servers
    status, _ = post_raw(fn_url, b'[' * 200000)  # json.loads raises RecursionError
    assert status == 400


def test_an_absurd_or_negative_content_length_is_400_without_reading(servers):
    _, fn_url = servers
    assert post_raw(fn_url, b'', content_length=1_000_001)[0] == 400
    assert post_raw(fn_url, b'', content_length=-1)[0] == 400


def test_a_storage_connection_failure_is_502_and_does_not_echo_the_url(servers):
    store_url, fn_url = servers
    # Port 1 refuses connections. The presigned URL carries a signature, so it must not come back.
    status, body = call(fn_url, good_body(store_url, sourceUrl='http://127.0.0.1:1/source?X-Amz-Signature=sekret'))
    assert status == 502
    assert 'sekret' not in json.dumps(body) and '127.0.0.1' not in json.dumps(body)


@pytest.mark.parametrize('error', [
    http.client.RemoteDisconnected('Remote end closed connection without response'),
    http.client.IncompleteRead(b'abc'),
    http.client.BadStatusLine(''),
    ConnectionResetError('reset'),
    BrokenPipeError('pipe'),
    TimeoutError('timed out'),
])
def test_transfer_failures_of_every_kind_are_502_and_logged_without_the_url(servers, monkeypatch, capsys, error):
    store_url, fn_url = servers

    def broken(url, path, deadline):
        raise error

    monkeypatch.setattr(convert_drawing, 'download', broken)
    status, body = call(fn_url, good_body(store_url, sourceUrl=f'{store_url}/source?X-Amz-Signature=sekret'))
    assert status == 502 and body == {'error': 'storage transfer failed'}
    logged = capsys.readouterr().err
    assert type(error).__name__ in logged and 'sekret' not in logged


def test_a_url_the_http_client_rejects_later_is_400_and_logged_without_the_url(servers, monkeypatch, capsys):
    store_url, fn_url = servers

    def broken(url, path, deadline):
        raise http.client.InvalidURL(f"URL can't contain control characters. {url!r}")

    monkeypatch.setattr(convert_drawing, 'download', broken)
    status, body = call(fn_url, good_body(store_url, sourceUrl=f'{store_url}/source?X-Amz-Signature=sekret'))
    assert status == 400 and 'sekret' not in json.dumps(body)
    assert 'sekret' not in capsys.readouterr().err


def test_an_unexpected_failure_message_is_logged_without_the_presigned_url(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    signed = f'{store_url}/source?X-Amz-Signature=sekret'

    def broken(url, path, deadline):
        raise RuntimeError(f'cannot open {url}')

    monkeypatch.setattr(convert_drawing, 'download', broken)
    status, _ = call(fn_url, good_body(store_url, sourceUrl=signed))
    logged = capsys.readouterr().err
    assert status == 500 and 'unexpected RuntimeError: cannot open <url>' in logged and 'sekret' not in logged


def test_the_bundled_binary_is_copied_atomically_and_made_executable(tmp_path, monkeypatch):
    bundled = tmp_path / 'bundle' / 'dwg2dxf'
    bundled.parent.mkdir()
    bundled.write_bytes(b'#!/bin/sh\n')
    bundled.chmod(0o644)  # a deployment bundle that lost the executable bit
    scratch = tmp_path / 'tmp'
    scratch.mkdir()
    monkeypatch.delenv('DWG2DXF', raising=False)
    monkeypatch.setattr(convert_drawing, 'BUNDLED_DWG2DXF', str(bundled))
    monkeypatch.setattr(convert_drawing.tempfile, 'gettempdir', lambda: str(scratch))

    path = convert_drawing.dwg2dxf_path()

    assert path == str(scratch / 'dwg2dxf')
    assert os.access(path, os.X_OK) and (scratch / 'dwg2dxf').read_bytes() == b'#!/bin/sh\n'
    assert os.stat(path).st_mode & stat.S_IXUSR
    assert [p.name for p in scratch.iterdir()] == ['dwg2dxf']  # no stray temp file left behind
    assert convert_drawing.dwg2dxf_path() == path  # the second call reuses it


# --- The conversion runs in a child process: its exits, timeouts and environment. ---

CHILD_PID = 987_654  # never signalled for real: fake_child replaces os.killpg


def fake_child(monkeypatch, returncode, stdout=b'', stderr=b''):
    """Stands in for subprocess.Popen: the child 'ran' and exited with returncode.

    Records how it was started, the timeouts it was waited on with, and which process groups
    the handler killed (os.killpg is replaced, so no real group is ever signalled).
    """
    made = {'args': None, 'kwargs': None, 'timeouts': [], 'kills': []}

    class FakeProcess:
        pid = CHILD_PID

        def __init__(self, args, **kwargs):
            made['args'], made['kwargs'] = args, kwargs
            self.returncode = returncode

        def communicate(self, timeout=None):
            made['timeouts'].append(timeout)
            return stdout, stderr

    monkeypatch.setattr(convert_drawing.subprocess, 'Popen', FakeProcess)
    monkeypatch.setattr(convert_drawing.os, 'killpg', lambda pid, sig: made['kills'].append((pid, sig)))
    return made


def fake_clock(monkeypatch, elapsed_during_download):
    """The handler's clock stands still, then jumps forward once the download is done."""
    clock = {'now': 1000.0}
    monkeypatch.setattr(convert_drawing, 'time', types.SimpleNamespace(monotonic=lambda: clock['now']))
    real_download = convert_drawing.download

    def slow_download(url, path, deadline):
        real_download(url, path, deadline)
        clock['now'] += elapsed_during_download

    monkeypatch.setattr(convert_drawing, 'download', slow_download)
    return clock


def test_a_conversion_over_the_time_limit_is_a_422_verdict(servers, monkeypatch, capsys):
    # A drawing that is always too slow will be too slow next time as well: a verdict, not a retry.
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing, 'MIN_CHILD_TIMEOUT_S', 0.05)
    fake_clock(monkeypatch, 60)  # the budget is spent, so the child gets only the minimum
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, good_body(store_url))
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert FakeStore.received == {}
    assert 'conversion exceeded 0.05 s' in capsys.readouterr().err


def test_a_child_exiting_2_is_a_422_verdict(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    fake_child(monkeypatch, 2, stderr=b'not a readable DXF: x')
    FakeStore.source = b'anything'
    status, body = call(fn_url, good_body(store_url))
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert FakeStore.received == {}
    assert 'convert_drawing: drawing error: not a readable DXF: x' in capsys.readouterr().err


def test_a_child_killed_by_a_signal_is_a_422_verdict(servers, monkeypatch, capsys):
    # E.g. RLIMIT_CPU (SIGXCPU/SIGKILL) or a crash in native parsing code (SIGSEGV).
    store_url, fn_url = servers
    fake_child(monkeypatch, -9)
    FakeStore.source = b'anything'
    status, body = call(fn_url, good_body(store_url))
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert FakeStore.received == {}
    assert 'killed by signal SIGKILL' in capsys.readouterr().err


@pytest.mark.parametrize('returncode', [1, 3, 120])
def test_any_other_child_exit_is_a_500(servers, monkeypatch, capsys, returncode):
    store_url, fn_url = servers
    fake_child(monkeypatch, returncode, stderr=b'Traceback ... OSError')
    FakeStore.source = b'anything'
    status, body = call(fn_url, good_body(store_url))
    assert status == 500 and body == {'error': 'conversion failed unexpectedly'}
    assert FakeStore.received == {}
    assert f'convert_drawing: converter exited {returncode}' in capsys.readouterr().err


def test_a_child_exiting_0_without_a_page_count_is_a_500(servers, monkeypatch):
    store_url, fn_url = servers
    fake_child(monkeypatch, 0, stdout=b'oops')
    FakeStore.source = b'anything'
    status, _ = call(fn_url, good_body(store_url))
    assert status == 500
    assert FakeStore.received == {}


ENV_PROBE = """
import json, os, sys
with open(sys.argv[2], 'w') as out:
    json.dump({'env': dict(os.environ), 'argv': sys.argv[1:]}, out)
print(1)
"""


def test_the_child_gets_no_secrets_only_the_allowlisted_environment(servers, monkeypatch, tmp_path):
    # The parent's environment holds the converter secret (and, in a misconfigured project,
    # could hold much more). The child that parses the untrusted drawing must see none of it.
    store_url, fn_url = servers
    monkeypatch.setenv('DATABASE_URL', 'postgresql://owner:hunter2@db.example/neondb')
    monkeypatch.setenv('R2_SECRET_ACCESS_KEY', 'r2-sekret')
    probe = tmp_path / 'probe.py'
    probe.write_text(ENV_PROBE)
    monkeypatch.setattr(convert_drawing, 'CONVERTER_SCRIPT', str(probe))
    FakeStore.source = open(FIXTURE, 'rb').read()

    status, body = call(fn_url, good_body(store_url))

    assert status == 200 and body == {'pages': 1}
    seen = json.loads(FakeStore.received['body'])  # the probe 'PDF' is what the child saw
    env = {k: v for k, v in seen['env'].items() if not k.startswith('__CF')}  # macOS adds __CF_USER_TEXT_ENCODING
    assert set(env) <= {
        'PYTHONPATH', 'PATH', 'HOME', 'XDG_CACHE_HOME', 'LANG', 'LD_LIBRARY_PATH',
        'OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'MALLOC_ARENA_MAX',
        'CONVERTER_RLIMIT_CPU_S', 'CONVERTER_RLIMIT_AS_BYTES',
    }
    for secret in ('DATABASE_URL', 'R2_SECRET_ACCESS_KEY', 'CAD_CONVERTER_SECRET'):
        assert secret not in seen['env']
    assert 'hunter2' not in json.dumps(seen) and SECRET not in json.dumps(seen)
    assert env['PATH'] == '/usr/bin:/bin' and env['LANG'] == 'C.UTF-8'
    # RLIMIT_AS counts every thread stack and malloc arena: keep BLAS/OpenMP pools and arenas small.
    assert (env['OPENBLAS_NUM_THREADS'], env['OMP_NUM_THREADS'], env['MKL_NUM_THREADS']) == ('1', '1', '1')
    assert env['MALLOC_ARENA_MAX'] == '2'
    # The limits travel as plain numbers; the child applies them to itself before importing anything.
    assert env['CONVERTER_RLIMIT_CPU_S'] == str(convert_drawing.CHILD_CPU_S)
    assert env['CONVERTER_RLIMIT_AS_BYTES'] == str(convert_drawing.CHILD_ADDRESS_SPACE_BYTES)
    assert seen['argv'][2] == convert_drawing.dwg2dxf_path()


def test_the_child_starts_in_its_own_session_without_preexec_fn(servers, monkeypatch):
    store_url, fn_url = servers
    made = fake_child(monkeypatch, 2, stderr=b'x')
    FakeStore.source = b'anything'
    call(fn_url, good_body(store_url))
    kwargs = made['kwargs']
    assert made['args'][0] == sys.executable and made['args'][1] == convert_drawing.CONVERTER_SCRIPT
    assert kwargs['start_new_session'] is True
    assert 'preexec_fn' not in kwargs
    assert 'CAD_CONVERTER_SECRET' not in kwargs['env']
    assert kwargs['env']['CONVERTER_RLIMIT_CPU_S'] == '50'
    assert kwargs['env']['CONVERTER_RLIMIT_AS_BYTES'] == str(2 * 1024 ** 3)


# --- One time budget for download + convert + upload, shorter than the route's 55 s. ---


def test_the_whole_request_has_a_50_s_budget():
    assert convert_drawing.TOTAL_BUDGET_S == 50 and convert_drawing.MIN_CHILD_TIMEOUT_S == 5


@pytest.mark.parametrize('elapsed, expected', [(0, 50), (10, 40), (44, 6), (45.5, 5), (49, 5), (60, 5)])
def test_the_child_gets_what_is_left_of_the_budget_but_never_under_5_s(servers, monkeypatch, elapsed, expected):
    store_url, fn_url = servers
    made = fake_child(monkeypatch, 2, stderr=b'x')
    fake_clock(monkeypatch, elapsed)
    FakeStore.source = b'anything'
    status, _ = call(fn_url, good_body(store_url))
    assert status == 422
    assert made['timeouts'][0] == pytest.approx(expected)


def test_a_transfer_timeout_is_capped_by_the_remaining_budget(monkeypatch):
    monkeypatch.setattr(convert_drawing, 'time', types.SimpleNamespace(monotonic=lambda: 1000.0))
    assert convert_drawing.transfer_timeout(1000.0 + 50) == convert_drawing.TRANSFER_TIMEOUT_S == 20
    assert convert_drawing.transfer_timeout(1000.0 + 7) == 7
    # Spent budget never yields a zero or negative socket timeout (which urlopen rejects or treats as non-blocking).
    assert convert_drawing.transfer_timeout(1000.0 - 3) == convert_drawing.MIN_TRANSFER_TIMEOUT_S


class FakeResponse:
    def __init__(self, chunks, on_read=lambda: None):
        self.chunks, self.on_read = list(chunks), on_read

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, size=-1):
        self.on_read()
        return self.chunks.pop(0) if self.chunks else b''


def test_download_and_upload_pass_the_budgeted_timeout_to_the_http_call(monkeypatch, tmp_path):
    monkeypatch.setattr(convert_drawing, 'time', types.SimpleNamespace(monotonic=lambda: 1000.0))
    timeouts = []

    class FakeOpener:
        def open(self, request, timeout=None):
            timeouts.append(timeout)
            return FakeResponse([b'abc'])

    monkeypatch.setattr(convert_drawing, '_OPENER', FakeOpener())
    convert_drawing.download('http://x/y', str(tmp_path / 'f'), 1000.0 + 7)
    convert_drawing.upload('http://x/y', b'pdf', 1000.0 + 90)
    assert timeouts == [7, 20]


def test_a_download_that_runs_past_the_budget_is_a_timeout(monkeypatch, tmp_path):
    clock = {'now': 1000.0}
    monkeypatch.setattr(convert_drawing, 'time', types.SimpleNamespace(monotonic=lambda: clock['now']))

    class FakeOpener:
        def open(self, request, timeout=None):  # a slow drip: every chunk takes 30 s
            return FakeResponse([b'a', b'b', b'c'], on_read=lambda: clock.update(now=clock['now'] + 30))

    monkeypatch.setattr(convert_drawing, '_OPENER', FakeOpener())
    with pytest.raises(TimeoutError):
        convert_drawing.download('http://x/y', str(tmp_path / 'f'), 1000.0 + 50)


def test_a_download_that_runs_past_the_budget_is_a_502(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    clock = {'now': 1000.0}
    monkeypatch.setattr(convert_drawing, 'time', types.SimpleNamespace(monotonic=lambda: clock['now']))

    class FakeOpener:
        def open(self, request, timeout=None):
            return FakeResponse([b'a', b'b'], on_read=lambda: clock.update(now=clock['now'] + 60))

    monkeypatch.setattr(convert_drawing, '_OPENER', FakeOpener())
    status, body = call(fn_url, good_body(store_url))
    assert status == 502 and body == {'error': 'storage transfer failed'}
    assert 'TimeoutError' in capsys.readouterr().err


# --- Nothing the child started may outlive the request. ---


def is_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie still answers signal 0; one that nobody has reaped yet is dead for our purposes.
    state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith('Z')


def wait_until_dead(pid, seconds=5):
    deadline = time.monotonic() + seconds
    while is_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    return not is_alive(pid)


#: A stand-in converter that leaves a grandchild running in its process group, then does `ending`.
LEFTOVER_PROBE = """
import os, subprocess, sys, time
grandchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'],
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with open({pidfile!r}, 'w') as f:
    f.write(f'{{os.getpid()}} {{grandchild.pid}}')
{ending}
"""
EXIT_OK = "open(sys.argv[2], 'wb').write(b'%PDF-1.4 probe')\nprint(1)"
HANG = 'time.sleep(120)'


def run_leftover_probe(servers, monkeypatch, tmp_path, ending):
    store_url, fn_url = servers
    pidfile = tmp_path / 'pids'
    probe = tmp_path / 'probe.py'
    probe.write_text(LEFTOVER_PROBE.format(pidfile=str(pidfile), ending=ending))
    monkeypatch.setattr(convert_drawing, 'CONVERTER_SCRIPT', str(probe))
    FakeStore.source = b'anything'
    status, _ = call(fn_url, good_body(store_url))
    probe_pid, grandchild_pid = map(int, pidfile.read_text().split())
    return status, probe_pid, grandchild_pid


def test_a_process_left_behind_by_a_successful_conversion_is_killed(servers, monkeypatch, tmp_path):
    status, probe_pid, grandchild_pid = run_leftover_probe(servers, monkeypatch, tmp_path, EXIT_OK)
    assert status == 200
    assert wait_until_dead(grandchild_pid), 'the grandchild outlived the request'


def test_a_timed_out_conversion_is_killed_with_everything_it_started(servers, monkeypatch, tmp_path):
    monkeypatch.setattr(convert_drawing, 'MIN_CHILD_TIMEOUT_S', 2)
    fake_clock(monkeypatch, 60)
    status, probe_pid, grandchild_pid = run_leftover_probe(servers, monkeypatch, tmp_path, HANG)
    assert status == 422
    assert wait_until_dead(probe_pid) and wait_until_dead(grandchild_pid)


def test_the_session_is_killed_after_every_run_and_a_vanished_group_is_fine(servers, monkeypatch):
    store_url, fn_url = servers
    made = fake_child(monkeypatch, 2, stderr=b'x')

    def vanished(pid, sig):
        made['kills'].append((pid, sig))
        raise ProcessLookupError()

    monkeypatch.setattr(convert_drawing.os, 'killpg', vanished)
    FakeStore.source = b'anything'
    status, _ = call(fn_url, good_body(store_url))
    assert status == 422  # ProcessLookupError (nothing left to kill) is not an error
    assert made['kills'] == [(CHILD_PID, signal.SIGKILL)]


def test_a_refused_signal_is_not_an_error_either(servers, monkeypatch):
    store_url, fn_url = servers
    made = fake_child(monkeypatch, 2, stderr=b'x')

    def refused(pid, sig):
        raise PermissionError()  # macOS says this for a group whose leader is an unreaped zombie

    monkeypatch.setattr(convert_drawing.os, 'killpg', refused)
    FakeStore.source = b'anything'
    assert call(fn_url, good_body(store_url))[0] == 422


# --- Only the storage host may be fetched from or written to. ---


@pytest.mark.parametrize('url, allowed', [
    ('https://bucket.0123abcd.r2.cloudflarestorage.com/key?X-Amz-Signature=x', True),
    ('https://BUCKET.0123abcd.R2.CloudflareStorage.com/key', True),
    ('https://r2.cloudflarestorage.com/key', False),            # a suffix needs a label before it
    ('https://evilr2.cloudflarestorage.com/key', False),
    ('https://r2.cloudflarestorage.com.evil.com/key', False),
    ('https://evil.com/.r2.cloudflarestorage.com', False),
    ('https://evil.com/key?h=x.r2.cloudflarestorage.com', False),
    ('http://169.254.169.254/latest/meta-data/', False),
    ('http://localhost:3000/x', False),
    ('http://[::1]/x', False),
    ('https://x.r2.cloudflarestorage.com@evil.com/key', False),  # userinfo: the host is evil.com
    ('https://evil.com@x.r2.cloudflarestorage.com/key', False),  # refused even so: parsers disagree about userinfo
    ('https://evil.com\\@x.r2.cloudflarestorage.com/key', False),
])
def test_the_default_allowlist_is_r2_only(monkeypatch, url, allowed):
    monkeypatch.delenv('CONVERTER_ALLOWED_HOST_SUFFIXES', raising=False)
    assert convert_drawing.host_allowed(url) is allowed


def test_the_allowlist_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv('CONVERTER_ALLOWED_HOST_SUFFIXES', ' .files.example.com , store.example.org ')
    assert convert_drawing.host_allowed('https://a.files.example.com/k')          # leading dot: any subdomain
    assert not convert_drawing.host_allowed('https://files.example.com/k')
    assert convert_drawing.host_allowed('https://store.example.org/k')            # no dot: that exact host
    assert not convert_drawing.host_allowed('https://x.store.example.org/k')
    assert not convert_drawing.host_allowed('https://bucket.0123abcd.r2.cloudflarestorage.com/k')  # replaced, not extended


def test_an_empty_allowlist_setting_falls_back_to_the_default_not_to_allow_all(monkeypatch):
    monkeypatch.setenv('CONVERTER_ALLOWED_HOST_SUFFIXES', ' , ')
    assert not convert_drawing.host_allowed('http://169.254.169.254/x')
    assert convert_drawing.host_allowed('https://b.a.r2.cloudflarestorage.com/k')


def test_a_url_on_a_host_outside_the_allowlist_is_400_and_nothing_is_fetched(servers, monkeypatch):
    store_url, fn_url = servers
    FakeStore.source = open(FIXTURE, 'rb').read()
    monkeypatch.delenv('CONVERTER_ALLOWED_HOST_SUFFIXES')  # the default: R2 only
    for field in ('sourceUrl', 'targetUrl'):
        status, body = call(fn_url, good_body(store_url, **{field: 'http://169.254.169.254/x'}))
        assert status == 400 and body == {'error': 'sourceUrl and targetUrl must be on an allowed storage host'}
    # The fake store itself is on 127.0.0.1, which the default refuses.
    assert call(fn_url, good_body(store_url))[0] == 400
    assert FakeStore.gets == 0 and FakeStore.received == {}


def test_a_redirect_from_the_storage_host_is_not_followed(servers):
    # An allowed host must not be able to bounce the converter to one that is not.
    store_url, fn_url = servers
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, good_body(store_url, sourceUrl=f'{store_url}/redirect'))
    assert status == 502 and body == {'error': 'storage transfer failed'}
    assert FakeStore.paths == ['/redirect']
    assert FakeStore.received == {}


def test_a_storage_http_error_logs_its_status_code_but_not_the_url(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    signed = f'{store_url}/source?X-Amz-Signature=sekret'

    def forbidden(url, path, deadline):
        raise urllib.error.HTTPError(url, 403, 'Forbidden', {}, None)

    monkeypatch.setattr(convert_drawing, 'download', forbidden)
    status, body = call(fn_url, good_body(store_url, sourceUrl=signed))
    assert status == 502 and body == {'error': 'storage transfer failed'}
    logged = capsys.readouterr().err
    assert 'HTTPError' in logged and '403' in logged and 'sekret' not in logged
