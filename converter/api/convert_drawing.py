# SPDX-License-Identifier: AGPL-3.0-or-later
"""Vercel Python function: POST /api/convert_drawing

Converts one DWG/DXF to PDF. Deployed as its own Vercel project (Root Directory converter/), so
the only env var it can see is CAD_CONVERTER_SECRET. Called only by Stiko's own Next route
(app/api/files/[id]/convert-drawing) at CAD_CONVERTER_URL, never by a browser.

Request:  JSON {"sourceUrl": presigned GET, "targetUrl": presigned PUT, "filename": str}
          header X-Converter-Secret: must equal env CAD_CONVERTER_SECRET
Response: 200 {"pages": n} | 400 bad request (including URLs that are not http(s)) | 401 bad secret
          | 413 too large | 422 unreadable or empty drawing | 502 storage transfer failed
          | 500 unexpected failure (e.g. the converter binary cannot run)
          Error bodies are fixed strings. Parser and transport detail goes to stderr only, because
          it can carry file content or presigned-URL signatures.

It gets signed URLs rather than storage credentials: it can read exactly one object and
write exactly one, for a few minutes, and nothing else.

The drawing is never parsed in this process. _lib/drawing_pdf.py runs as a child process with
a bare environment (no secrets), CPU and address-space limits, and a wall-clock timeout:
  exit 0 -> the PDF is PUT to targetUrl, 200 {"pages": n}
  exit 2, a timeout, or death by a signal (e.g. a resource limit) -> 422: a verdict on the
         drawing, which would fail the same way next time
  any other exit -> 500
"""
import hmac
import http.client
import json
import os
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))

MAX_SOURCE_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = 1_000_000
TRANSFER_TIMEOUT_S = 20
BUNDLED_DWG2DXF = os.path.join(HERE, '_bin', 'dwg2dxf')
CONVERTER_SCRIPT = os.path.join(HERE, '_lib', 'drawing_pdf.py')
#: Wall clock for the whole child (dwg2dxf's own 30 s included), inside the function's 60 s.
CONVERT_TIMEOUT_S = 45
#: CPU seconds for the child and, separately, for dwg2dxf under it; beyond it the kernel kills it.
CHILD_CPU_S = 50
#: Address space for the child (Vercel Hobby functions get 2 GB of memory).
CHILD_ADDRESS_SPACE_BYTES = 2 * 1024 ** 3


class TooLarge(Exception):
    pass


class DrawingVerdict(Exception):
    """The child says the drawing is unreadable or empty, ran out of time, or was killed."""


class ConverterFault(Exception):
    """The child failed in a way that is not the drawing's fault."""


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
    scratch = tempfile.gettempdir()
    copy = os.path.join(scratch, 'dwg2dxf')
    if not os.access(copy, os.X_OK):
        # Concurrent cold starts share /tmp: build the copy under a unique name, then rename it
        # into place, so nobody ever executes (or ETXTBSY-collides with) a half-written file.
        fd, staged = tempfile.mkstemp(dir=scratch, prefix='dwg2dxf-')
        try:
            with os.fdopen(fd, 'wb') as out, open(BUNDLED_DWG2DXF, 'rb') as src:
                shutil.copyfileobj(src, out)
            os.chmod(staged, os.stat(staged).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            os.replace(staged, copy)
        except BaseException:
            try:
                os.unlink(staged)
            except OSError:
                pass
            raise
    return copy


def _lower_limit(which: int, value: int) -> None:
    _soft, hard = resource.getrlimit(which)
    if hard != resource.RLIM_INFINITY:
        value = min(value, hard)
    resource.setrlimit(which, (value, value))


def limit_resources() -> None:
    """preexec_fn: runs in the child between fork and exec. Inherited by dwg2dxf under it.

    RLIMIT_AS only on Linux (production): macOS refuses to lower it (EINVAL), which would make
    every local run fail.
    """
    _lower_limit(resource.RLIMIT_CPU, CHILD_CPU_S)
    if sys.platform.startswith('linux'):
        _lower_limit(resource.RLIMIT_AS, CHILD_ADDRESS_SPACE_BYTES)


def child_env() -> dict:
    """The child's whole environment: where its imports live, and nothing secret.

    HOME and XDG_CACHE_HOME point at a scratch directory that persists while the instance
    is warm, so ezdxf's font cache is built once, not per request.
    """
    home = os.path.join(tempfile.gettempdir(), 'converter-home')
    os.makedirs(home, exist_ok=True)
    env = {
        'PYTHONPATH': os.pathsep.join(p for p in sys.path if p),
        'PATH': '/usr/bin:/bin',
        'HOME': home,
        'XDG_CACHE_HOME': home,
        'LANG': 'C.UTF-8',
    }
    # Not a secret, and the runtime's python may need it to find libpython.
    if os.environ.get('LD_LIBRARY_PATH'):
        env['LD_LIBRARY_PATH'] = os.environ['LD_LIBRARY_PATH']
    return env


def tail(data: bytes, limit: int = 300) -> str:
    return data.decode('utf-8', errors='replace').strip()[-limit:]


def run_converter(source: str, out: str) -> int:
    """Convert source to the PDF at out in a child process. Returns the page count.

    Raises DrawingVerdict (-> 422) or ConverterFault (-> 500).
    """
    try:
        result = subprocess.run(
            [sys.executable, CONVERTER_SCRIPT, source, out, dwg2dxf_path()],
            timeout=CONVERT_TIMEOUT_S, capture_output=True, env=child_env(),
            preexec_fn=limit_resources,
        )
    except subprocess.TimeoutExpired as err:
        raise DrawingVerdict(f'conversion exceeded {CONVERT_TIMEOUT_S} s') from err
    if result.returncode == 0:
        try:
            pages = int(result.stdout.decode().strip())
        except ValueError as err:
            raise ConverterFault(f'converter exited 0 without a page count: {tail(result.stdout)}') from err
        if pages < 1 or not os.path.exists(out):
            raise ConverterFault(f'converter exited 0 with {pages} pages and no usable PDF')
        return pages
    if result.returncode == 2:
        raise DrawingVerdict(tail(result.stderr))
    if result.returncode < 0:
        try:
            name = signal.Signals(-result.returncode).name
        except ValueError:
            name = str(-result.returncode)
        raise DrawingVerdict(f'converter killed by signal {name}: {tail(result.stderr)}')
    raise ConverterFault(f'converter exited {result.returncode}: {tail(result.stderr)}')


def is_http_url(value: str) -> bool:
    """True for an absolute http(s) URL with a host. urlopen also reads file:// and ftp://."""
    if any(ord(c) <= 0x20 or ord(c) == 0x7F for c in value):  # urlsplit silently drops \r \n \t
        return False
    try:
        parts = urllib.parse.urlsplit(value)
        parts.port  # raises ValueError for a non-numeric or out-of-range port
    except ValueError:
        return False
    return parts.scheme in ('http', 'https') and bool(parts.hostname)


def detail(err: BaseException, *urls: str) -> str:
    """A short log-safe description of err: truncated, and without any presigned URL in it."""
    text = str(err)
    for url in urls:
        text = text.replace(url, '<url>')
    return text[:300]


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
            if length < 0 or length > MAX_REQUEST_BYTES:
                raise ValueError('Content-Length out of range')
            body = json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(body, dict):
                raise TypeError('body must be an object')
            source_url, target_url, filename = body['sourceUrl'], body['targetUrl'], body['filename']
            if not all(isinstance(v, str) for v in (source_url, target_url, filename)):
                raise ValueError('fields must be strings')
        except (ValueError, KeyError, TypeError, RecursionError):  # RecursionError: json.loads(b'[' * 200000)
            return self._reply(400, {'error': 'expected JSON {sourceUrl, targetUrl, filename}'})

        if not (is_http_url(source_url) and is_http_url(target_url)):
            return self._reply(400, {'error': 'sourceUrl and targetUrl must be http(s) URLs'})

        suffix = os.path.splitext(filename)[1].lower()
        if suffix not in ('.dwg', '.dxf'):
            return self._reply(400, {'error': 'not a DWG or DXF file'})

        try:
            with tempfile.TemporaryDirectory() as work:
                source = os.path.join(work, 'source' + suffix)
                out = os.path.join(work, 'out.pdf')
                download(source_url, source)
                pages = run_converter(source, out)
                with open(out, 'rb') as pdf:
                    upload(target_url, pdf.read())
        except TooLarge:
            return self._reply(413, {'error': f'over {MAX_SOURCE_BYTES // (1024 * 1024)} MB'})
        except DrawingVerdict as err:
            # The detail comes from parsing the file, so it can quote the file: log it, never reply it.
            print(f'convert_drawing: drawing error: {detail(err, source_url, target_url)}', file=sys.stderr)
            return self._reply(422, {'error': 'unreadable or empty drawing'})
        except ConverterFault as err:  # e.g. dwg2dxf cannot run; the child never sees the URLs
            print(f'convert_drawing: {detail(err, source_url, target_url)}', file=sys.stderr)
            return self._reply(500, {'error': 'conversion failed unexpectedly'})
        except http.client.InvalidURL as err:  # e.g. control characters; before HTTPException, its parent
            print(f'convert_drawing: invalid URL ({type(err).__name__})', file=sys.stderr)
            return self._reply(400, {'error': 'sourceUrl and targetUrl must be http(s) URLs'})
        except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError) as err:
            # Never log the URL or the exception text: a presigned URL carries its signature.
            # An HTTPError's status code is safe, and tells an expired signature (403) apart.
            code = f' {err.code}' if isinstance(err, urllib.error.HTTPError) else ''
            print(f'convert_drawing: storage transfer failed ({type(err).__name__}{code})', file=sys.stderr)
            return self._reply(502, {'error': 'storage transfer failed'})
        except Exception as err:  # any other server fault, never a crashed request
            print(f'convert_drawing: unexpected {type(err).__name__}: {detail(err, source_url, target_url)}', file=sys.stderr)
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
