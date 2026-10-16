"""Vercel Python function: POST /api/convert_drawing

Converts one DWG/DXF to PDF. Called only by Stiko's own Next route
(app/api/files/[id]/convert-drawing), never by a browser.

Request:  JSON {"sourceUrl": presigned GET, "targetUrl": presigned PUT, "filename": str}
          header X-Converter-Secret: must equal env CAD_CONVERTER_SECRET
Response: 200 {"pages": n} | 400 bad request | 401 bad secret | 413 too large
          | 422 {"error": ...} unreadable or empty drawing | 502 storage transfer failed
          | 500 unexpected failure (e.g. the converter binary cannot run)

It gets signed URLs rather than storage credentials: it can read exactly one object and
write exactly one, for a few minutes, and nothing else.
"""
import hmac
import json
import os
import shutil
import stat
import sys
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '_lib'))

from drawing_pdf import DrawingError, convert  # noqa: E402

MAX_SOURCE_BYTES = 50 * 1024 * 1024
TRANSFER_TIMEOUT_S = 20
BUNDLED_DWG2DXF = os.path.join(HERE, '_bin', 'dwg2dxf')


class TooLarge(Exception):
    pass


def dwg2dxf_path() -> str:
    """The bundled binary, made executable. Overridable with env DWG2DXF for local tests.

    A deployment bundle does not always keep the executable bit, and the bundle directory is
    read-only, so a non-executable copy is duplicated into /tmp and chmodded there.
    """
    override = os.environ.get('DWG2DXF')
    if override:
        return override
    if os.access(BUNDLED_DWG2DXF, os.X_OK):
        return BUNDLED_DWG2DXF
    copy = os.path.join(tempfile.gettempdir(), 'dwg2dxf')
    if not os.access(copy, os.X_OK):
        shutil.copyfile(BUNDLED_DWG2DXF, copy)
        os.chmod(copy, os.stat(copy).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return copy


def download(url: str, path: str) -> None:
    """Stream url to path, refusing anything over MAX_SOURCE_BYTES."""
    with urllib.request.urlopen(url, timeout=TRANSFER_TIMEOUT_S) as response, open(path, 'wb') as out:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_SOURCE_BYTES:
                raise TooLarge()
            out.write(chunk)


def upload(url: str, data: bytes) -> None:
    # Content-Type must match the type the PUT URL was signed for.
    request = urllib.request.Request(
        url, data=data, method='PUT', headers={'Content-Type': 'application/pdf'}
    )
    with urllib.request.urlopen(request, timeout=TRANSFER_TIMEOUT_S):
        pass


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        secret = os.environ.get('CAD_CONVERTER_SECRET', '')
        given = self.headers.get('X-Converter-Secret', '')
        if not secret or not hmac.compare_digest(secret.encode(), given.encode()):
            return self._reply(401, {'error': 'unauthorized'})

        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(length) or b'{}')
            source_url, target_url, filename = body['sourceUrl'], body['targetUrl'], body['filename']
            if not all(isinstance(v, str) for v in (source_url, target_url, filename)):
                raise ValueError('fields must be strings')
        except (ValueError, KeyError, TypeError):
            return self._reply(400, {'error': 'expected JSON {sourceUrl, targetUrl, filename}'})

        suffix = os.path.splitext(filename)[1].lower()
        if suffix not in ('.dwg', '.dxf'):
            return self._reply(400, {'error': 'not a DWG or DXF file'})

        try:
            with tempfile.TemporaryDirectory() as work:
                source = os.path.join(work, 'source' + suffix)
                download(source_url, source)
                pdf, pages = convert(source, dwg2dxf_path())
                upload(target_url, pdf)
        except TooLarge:
            return self._reply(413, {'error': f'over {MAX_SOURCE_BYTES // (1024 * 1024)} MB'})
        except DrawingError as err:
            return self._reply(422, {'error': str(err)})
        except (urllib.error.URLError, TimeoutError) as err:
            return self._reply(502, {'error': f'storage transfer failed: {err}'})
        except Exception as err:  # a server fault (e.g. dwg2dxf cannot run), never a crashed request
            print(f'convert_drawing: unexpected {type(err).__name__}: {err}', file=sys.stderr)
            return self._reply(500, {'error': 'conversion failed unexpectedly'})
        return self._reply(200, {'pages': pages})

    def _reply(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # keep test output quiet; Vercel logs the status anyway
        pass
