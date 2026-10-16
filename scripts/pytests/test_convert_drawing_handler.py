"""End-to-end: the real handler, a fake presigned-URL store, and a real conversion."""
import importlib.util
import json
import os
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

    def do_GET(self):
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
    assert FakeStore.received == {}


def test_an_oversized_source_is_413(servers, monkeypatch):
    store_url, fn_url = servers
    monkeypatch.setattr(convert_drawing, 'MAX_SOURCE_BYTES', 10)
    FakeStore.source = b'x' * 100
    status, _ = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dxf'})
    assert status == 413


def test_an_unexpected_failure_is_a_500_not_a_crash_and_nothing_is_written(servers, monkeypatch):
    """E.g. the bundled dwg2dxf is missing or unrunnable: convert() lets the OSError through."""
    store_url, fn_url = servers

    def broken(source_path, dwg2dxf):
        raise OSError('dwg2dxf: exec format error')

    monkeypatch.setattr(convert_drawing, 'convert', broken)
    FakeStore.source = open(FIXTURE, 'rb').read()
    status, body = call(fn_url, {'sourceUrl': f'{store_url}/source', 'targetUrl': f'{store_url}/target', 'filename': 'a.dwg'})
    assert status == 500 and body['error'] == 'conversion failed unexpectedly'
    assert FakeStore.received == {}
