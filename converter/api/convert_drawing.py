# SPDX-License-Identifier: AGPL-3.0-or-later
"""Vercel Python function: POST /api/convert_drawing

Converts one DWG/DXF to PDF. Deployed as its own Vercel project (Root Directory converter/), so
the only secret it can see is CAD_CONVERTER_SECRET. Called only by Stiko's own Next route
(app/api/files/[id]/convert-drawing) at CAD_CONVERTER_URL, never by a browser.

Request:  JSON {"sourceUrl": presigned GET, "targetUrl": presigned PUT, "filename": str}
          header X-Converter-Secret: must equal env CAD_CONVERTER_SECRET
Response: 200 {"pages": n} | 400 bad request (including URLs that are not http(s) or not on an
          allowed host) | 401 bad secret
          | 413 too large | 422 unreadable or empty drawing | 502 storage transfer failed
          | 500 unexpected failure (e.g. the converter binary cannot run)
          Error bodies are fixed strings. Parser and transport detail goes to stderr only, because
          it can carry file content or presigned-URL signatures.

It gets signed URLs rather than storage credentials: it can read exactly one object and
write exactly one, for a few minutes, and nothing else.

Both URLs must be on an allowed storage host (env CONVERTER_ALLOWED_HOST_SUFFIXES, default
.r2.cloudflarestorage.com), and redirects are not followed, so a caller cannot aim the function at
an internal address.

The whole request (download + convert + upload) has one time budget, TOTAL_BUDGET_S, shorter than
Stiko's 55 s wait and the function's 60 s maxDuration. The child gets whatever is left of it.

The drawing is never parsed in this process. _lib/drawing_pdf.py runs as a child process, in its
own session, with a bare environment (no secrets), CPU and address-space limits that it applies to
itself on start-up, and a wall-clock timeout. Its whole process group is killed afterwards, so
nothing it (or dwg2dxf) started outlives the request:
  exit 0 -> the PDF is PUT to targetUrl, 200 {"pages": n}
  exit 2, a timeout, or death by a signal (e.g. a resource limit) -> 422: a verdict on the
         drawing, which would fail the same way next time
  any other exit -> 500
"""
import hmac
import http.client
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))

MAX_SOURCE_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = 1_000_000
#: One network call to storage (connecting, or waiting for the next bytes), at most.
TRANSFER_TIMEOUT_S = 20
#: A transfer is never given less, even with the budget spent: urlopen rejects a negative timeout
#: and treats 0 as non-blocking.
MIN_TRANSFER_TIMEOUT_S = 2
#: Download + convert + upload must finish inside this. Stiko's route gives up at 55 s and the
#: function's maxDuration is 60 s, so 50 leaves room to answer before either.
TOTAL_BUDGET_S = 50
#: The child always gets at least this, however little of the budget is left.
MIN_CHILD_TIMEOUT_S = 5
#: After the child's group is killed, how long to wait for its pipes to close.
REAP_TIMEOUT_S = 5
#: Hosts the two URLs may point at (env CONVERTER_ALLOWED_HOST_SUFFIXES overrides, comma-separated).
#: An entry with a leading dot matches any subdomain; one without matches that exact host.
DEFAULT_ALLOWED_HOST_SUFFIXES = '.r2.cloudflarestorage.com'
BUNDLED_DWG2DXF = os.path.join(HERE, '_bin', 'dwg2dxf')
CONVERTER_SCRIPT = os.path.join(HERE, '_lib', 'drawing_pdf.py')
#: CPU seconds for the child and, separately, for dwg2dxf under it; beyond it the kernel kills it.
CHILD_CPU_S = 50
#: Address space for the child (Vercel Hobby functions get 2 GB of memory). Linux only.
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


def child_env() -> dict:
    """The child's whole environment: where its imports live, and nothing secret.

    HOME and XDG_CACHE_HOME point at a scratch directory that persists while the instance
    is warm, so ezdxf's font cache is built once, not per request.

    RLIMIT_AS counts address space, not memory in use: every thread stack and every malloc arena
    reserves some. numpy's BLAS/OpenMP pools default to one thread per core and glibc to eight
    arenas per core, which on a many-core host could exhaust the cap before any drawing is read.
    The CONVERTER_RLIMIT_* values are the limits the child applies to itself (see
    _lib/drawing_pdf.py _apply_limits); it does so before importing anything heavy.
    """
    home = os.path.join(tempfile.gettempdir(), 'converter-home')
    os.makedirs(home, exist_ok=True)
    env = {
        'PYTHONPATH': os.pathsep.join(p for p in sys.path if p),
        'PATH': '/usr/bin:/bin',
        'HOME': home,
        'XDG_CACHE_HOME': home,
        'LANG': 'C.UTF-8',
        'OPENBLAS_NUM_THREADS': '1',
        'OMP_NUM_THREADS': '1',
        'MKL_NUM_THREADS': '1',
        'MALLOC_ARENA_MAX': '2',
        'CONVERTER_RLIMIT_CPU_S': str(CHILD_CPU_S),
        'CONVERTER_RLIMIT_AS_BYTES': str(CHILD_ADDRESS_SPACE_BYTES),
    }
    # Not a secret, and the runtime's python may need it to find libpython.
    if os.environ.get('LD_LIBRARY_PATH'):
        env['LD_LIBRARY_PATH'] = os.environ['LD_LIBRARY_PATH']
    return env


def tail(data: bytes, limit: int = 300) -> str:
    return data.decode('utf-8', errors='replace').strip()[-limit:]


def child_timeout(deadline: float) -> float:
    """What is left of the request's budget, but never less than MIN_CHILD_TIMEOUT_S."""
    return max(MIN_CHILD_TIMEOUT_S, deadline - time.monotonic())


def transfer_timeout(deadline: float) -> float:
    """One storage call's timeout: TRANSFER_TIMEOUT_S, capped by what is left of the budget."""
    return max(MIN_TRANSFER_TIMEOUT_S, min(TRANSFER_TIMEOUT_S, deadline - time.monotonic()))


def kill_session(proc: subprocess.Popen) -> None:
    """SIGKILL the child's whole process group (it leads its own session), if any of it is left."""
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        # Nothing left to kill. macOS answers PermissionError for a group whose leader is an unreaped zombie.
        pass


def run_converter(source: str, out: str, deadline: float) -> int:
    """Convert source to the PDF at out in a child process. Returns the page count.

    The child runs in its own session so that, when it finishes or times out, everything it
    started can be killed with it. Raises DrawingVerdict (-> 422) or ConverterFault (-> 500).
    """
    timeout = child_timeout(deadline)
    proc = subprocess.Popen(
        [sys.executable, CONVERTER_SCRIPT, source, out, dwg2dxf_path()],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=child_env(), start_new_session=True,
    )
    try:
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as err:
            kill_session(proc)
            try:
                proc.communicate(timeout=REAP_TIMEOUT_S)  # collect the dead child; its pipes are closed
            except subprocess.TimeoutExpired:
                pass
            raise DrawingVerdict(f'conversion exceeded {timeout:.3g} s') from err
    finally:
        kill_session(proc)  # also after a clean exit: a grandchild may still be running
    if proc.returncode == 0:
        try:
            pages = int(stdout.decode().strip())
        except ValueError as err:
            raise ConverterFault(f'converter exited 0 without a page count: {tail(stdout)}') from err
        if pages < 1 or not os.path.exists(out):
            raise ConverterFault(f'converter exited 0 with {pages} pages and no usable PDF')
        return pages
    if proc.returncode == 2:
        raise DrawingVerdict(tail(stderr))
    if proc.returncode < 0:
        try:
            name = signal.Signals(-proc.returncode).name
        except ValueError:
            name = str(-proc.returncode)
        raise DrawingVerdict(f'converter killed by signal {name}: {tail(stderr)}')
    raise ConverterFault(f'converter exited {proc.returncode}: {tail(stderr)}')


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


def allowed_host_suffixes() -> list[str]:
    """CONVERTER_ALLOWED_HOST_SUFFIXES (comma-separated), or the R2 default if unset or empty."""
    raw = os.environ.get('CONVERTER_ALLOWED_HOST_SUFFIXES', '')
    return [e for e in (part.strip().lower() for part in raw.split(',')) if e] or [DEFAULT_ALLOWED_HOST_SUFFIXES]


def host_allowed(url: str) -> bool:
    """True when url's host is on the allowlist. Call it on a URL is_http_url accepted.

    A URL with userinfo or a backslash is refused outright: parsers disagree about which host
    those mean, and a presigned storage URL never has either.
    """
    if '\\' in url:
        return False
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname
    if not host or '@' in parts.netloc:
        return False
    return any(host.endswith(entry) if entry.startswith('.') else host == entry
               for entry in allowed_host_suffixes())


def detail(err: BaseException, *urls: str) -> str:
    """A short log-safe description of err: truncated, and without any presigned URL in it."""
    text = str(err)
    for url in urls:
        text = text.replace(url, '<url>')
    return text[:300]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A 3xx from storage is an error (-> 502), never a hop to a host the allowlist did not vet."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def download(url: str, path: str, deadline: float) -> None:
    """Stream url to path, refusing anything over MAX_SOURCE_BYTES or past the deadline."""
    with _OPENER.open(url, timeout=transfer_timeout(deadline)) as response, open(path, 'wb') as out:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_SOURCE_BYTES:
                raise TooLarge()
            if time.monotonic() > deadline:  # a slow drip never trips the per-call timeout
                raise TimeoutError('download ran past the time budget')
            out.write(chunk)


def upload(url: str, data: bytes, deadline: float) -> None:
    # Content-Type must match the type the PUT URL was signed for.
    request = urllib.request.Request(
        url, data=data, method='PUT', headers={'Content-Type': 'application/pdf'}
    )
    with _OPENER.open(request, timeout=transfer_timeout(deadline)):
        pass


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        deadline = time.monotonic() + TOTAL_BUDGET_S
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
        if not (host_allowed(source_url) and host_allowed(target_url)):
            return self._reply(400, {'error': 'sourceUrl and targetUrl must be on an allowed storage host'})

        suffix = os.path.splitext(filename)[1].lower()
        if suffix not in ('.dwg', '.dxf'):
            return self._reply(400, {'error': 'not a DWG or DXF file'})

        try:
            with tempfile.TemporaryDirectory() as work:
                source = os.path.join(work, 'source' + suffix)
                out = os.path.join(work, 'out.pdf')
                download(source_url, source, deadline)
                pages = run_converter(source, out, deadline)
                with open(out, 'rb') as pdf:
                    upload(target_url, pdf.read(), deadline)
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
