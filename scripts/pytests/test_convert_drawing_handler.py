"""End-to-end: the real handler, a fake presigned-URL store, and a real conversion."""
import http.client
import importlib.util
import json
import os
import stat
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'example_2018.dwg')
SECRET = 'test-secret'

spec = importlib.util.spec_from_file_location('convert_drawing', os.path.join(ROOT, 'api', 'convert_drawing.py'))
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


def test_an_unexpected_failure_is_a_500_not_a_crash_and_nothing_is_written(servers, monkeypatch, capsys):
    """E.g. the bundled dwg2dxf is missing or unrunnable: convert() lets the OSError through."""
    store_url, fn_url = servers

    def broken(source_path, dwg2dxf):
        raise OSError('dwg2dxf: exec format error')

    monkeypatch.setattr(convert_drawing, 'convert', broken)
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'})
    assert status == 500 and body['error'] == 'conversion failed unexpectedly'
    assert FakeStore.received == {}
    assert 'unexpected OSError' in capsys.readouterr().err


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
