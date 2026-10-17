"""End-to-end: the real handler, a fake presigned-URL store, and a real conversion."""
import http.client
import importlib.util
import json
import os
import stat
import subprocess
import sys
import threading
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

    def do_GET(self):
        FakeStore.gets += 1
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
    store, store_url = serve(FakeStore)
    fn, fn_url = serve(convert_drawing.handler)
    FakeStore.received = {}
    FakeStore.gets = 0
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

    def broken(url, path):
        raise error

    monkeypatch.setattr(convert_drawing, 'download', broken)
    status, body = call(fn_url, good_body(store_url, sourceUrl=f'{store_url}/source?X-Amz-Signature=sekret'))
    assert status == 502 and body == {'error': 'storage transfer failed'}
    logged = capsys.readouterr().err
    assert type(error).__name__ in logged and 'sekret' not in logged


def test_a_url_the_http_client_rejects_later_is_400_and_logged_without_the_url(servers, monkeypatch, capsys):
    store_url, fn_url = servers

    def broken(url, path):
        raise http.client.InvalidURL(f"URL can't contain control characters. {url!r}")

    monkeypatch.setattr(convert_drawing, 'download', broken)
    status, body = call(fn_url, good_body(store_url, sourceUrl=f'{store_url}/source?X-Amz-Signature=sekret'))
    assert status == 400 and 'sekret' not in json.dumps(body)
    assert 'sekret' not in capsys.readouterr().err


def test_an_unexpected_failure_message_is_logged_without_the_presigned_url(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    signed = f'{store_url}/source?X-Amz-Signature=sekret'

    def broken(url, path):
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


def fake_child(returncode, stdout=b'', stderr=b''):
    """Stands in for subprocess.run: the child 'ran' and exited with returncode."""
    def run(args, **kwargs):
        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr=stderr)
    return run


def test_a_conversion_over_the_time_limit_is_a_422_verdict(servers, monkeypatch, capsys):
    # A drawing that is always too slow will be too slow next time as well: a verdict, not a retry.
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing, 'CONVERT_TIMEOUT_S', 0.05)
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, good_body(store_url))
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert FakeStore.received == {}
    assert 'conversion exceeded 0.05 s' in capsys.readouterr().err


def test_a_child_exiting_2_is_a_422_verdict(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing.subprocess, 'run', fake_child(2, stderr=b'not a readable DXF: x'))
    FakeStore.source = b'anything'
    status, body = call(fn_url, good_body(store_url))
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert FakeStore.received == {}
    assert 'convert_drawing: drawing error: not a readable DXF: x' in capsys.readouterr().err


def test_a_child_killed_by_a_signal_is_a_422_verdict(servers, monkeypatch, capsys):
    # E.g. RLIMIT_CPU (SIGXCPU/SIGKILL) or a crash in native parsing code (SIGSEGV).
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing.subprocess, 'run', fake_child(-9))
    FakeStore.source = b'anything'
    status, body = call(fn_url, good_body(store_url))
    assert status == 422 and body == {'error': 'unreadable or empty drawing'}
    assert FakeStore.received == {}
    assert 'killed by signal SIGKILL' in capsys.readouterr().err


@pytest.mark.parametrize('returncode', [1, 3, 120])
def test_any_other_child_exit_is_a_500(servers, monkeypatch, capsys, returncode):
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing.subprocess, 'run', fake_child(returncode, stderr=b'Traceback ... OSError'))
    FakeStore.source = b'anything'
    status, body = call(fn_url, good_body(store_url))
    assert status == 500 and body == {'error': 'conversion failed unexpectedly'}
    assert FakeStore.received == {}
    assert f'convert_drawing: converter exited {returncode}' in capsys.readouterr().err


def test_a_child_exiting_0_without_a_page_count_is_a_500(servers, monkeypatch):
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing.subprocess, 'run', fake_child(0, stdout=b'oops'))
    FakeStore.source = b'anything'
    status, _ = call(fn_url, good_body(store_url))
    assert status == 500
    assert FakeStore.received == {}


ENV_PROBE = """
import json, os, resource, sys
with open(sys.argv[2], 'w') as out:
    json.dump({
        'env': dict(os.environ),
        'cpu': resource.getrlimit(resource.RLIMIT_CPU),
        'as': resource.getrlimit(resource.RLIMIT_AS),
        'argv': sys.argv[1:],
    }, out)
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
    assert set(env) <= {'PYTHONPATH', 'PATH', 'HOME', 'XDG_CACHE_HOME', 'LANG', 'LD_LIBRARY_PATH'}
    for secret in ('DATABASE_URL', 'R2_SECRET_ACCESS_KEY', 'CAD_CONVERTER_SECRET'):
        assert secret not in seen['env']
    assert 'hunter2' not in json.dumps(seen) and SECRET not in json.dumps(seen)
    assert env['PATH'] == '/usr/bin:/bin' and env['LANG'] == 'C.UTF-8'
    assert seen['cpu'][0] == convert_drawing.CHILD_CPU_S  # the rlimits were applied in the child
    if sys.platform.startswith('linux'):  # macOS refuses to lower RLIMIT_AS; production is Linux
        assert seen['as'][0] == convert_drawing.CHILD_ADDRESS_SPACE_BYTES
    assert seen['argv'][2] == convert_drawing.dwg2dxf_path()


def test_the_child_is_run_with_a_timeout_and_resource_limits(servers, monkeypatch):
    store_url, fn_url = servers
    seen = {}
    real_run = subprocess.run

    def spy(args, **kwargs):
        seen.update(kwargs, args=args)
        return real_run(args, **kwargs)

    monkeypatch.setattr(convert_drawing.subprocess, 'run', spy)
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, _ = call(fn_url, good_body(store_url))
    assert status == 200
    assert seen['args'][0] == sys.executable and seen['args'][1] == convert_drawing.CONVERTER_SCRIPT
    assert seen['timeout'] == convert_drawing.CONVERT_TIMEOUT_S == 45
    assert seen['preexec_fn'] is convert_drawing.limit_resources
    assert 'CAD_CONVERTER_SECRET' not in seen['env']


def test_a_storage_http_error_logs_its_status_code_but_not_the_url(servers, monkeypatch, capsys):
    store_url, fn_url = servers
    signed = f'{store_url}/source?X-Amz-Signature=sekret'

    def forbidden(url, path):
        raise urllib.error.HTTPError(url, 403, 'Forbidden', {}, None)

    monkeypatch.setattr(convert_drawing, 'download', forbidden)
    status, body = call(fn_url, good_body(store_url, sourceUrl=signed))
    assert status == 502 and body == {'error': 'storage transfer failed'}
    logged = capsys.readouterr().err
    assert 'HTTPError' in logged and '403' in logged and 'sekret' not in logged
