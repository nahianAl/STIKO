"""Job logic for the Stiko CAD worker, kept free of Modal so it can be tested on a laptop.

Standard library only. A job: download the .sldprt from a presigned GET URL, convert it
(usd-convert-cad, then usd_to_glb.py), PUT the GLB to a presigned URL, POST the result to Stiko's
callback. The worker never holds Stiko credentials: it gets URLs and echoes the token it was given.

Two kinds of failure, kept apart on purpose (see the spec's failure table):
- JobFailed: a verdict on the FILE (too large, unreadable, empty, too slow). Reported with ok=false,
  and Stiko marks the file 'failed' for good.
- anything else: transient (network, storage, a crash). Nothing is reported; the claim goes stale
  after 15 minutes and Stiko retries, at most three attempts in all.
"""

import http.client
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

MAX_INPUT_BYTES = 200 * 1024 * 1024
CONVERT_TIMEOUT_S = 420
GLB_TIMEOUT_S = 120
GLTF_PYTHON = '/opt/gltf/bin/python'
HERE = Path(__file__).resolve().parent
JOB_FIELDS = ('sourceUrl', 'targetUrl', 'callbackUrl', 'fileId', 'claimId', 'token', 'filename')


class Refused(Exception):
    """The start request itself is unacceptable. status is the HTTP status to answer with."""

    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason


class JobFailed(Exception):
    """A verdict on the file. The message is the reason Stiko logs."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def parse_hosts(value):
    return [h.strip().lower() for h in (value or '').split(',') if h.strip()]


def _host_allowed(host, entries):
    host = (host or '').lower()
    return any(host.endswith(e) if e.startswith('.') else host == e for e in entries)


def _check_url(field, url, entries, allow_local_http):
    try:
        parts = urlsplit(url)
        port = parts.port  # raises ValueError on a malformed port
    except ValueError:
        raise Refused(400, f'{field} is not a valid URL') from None
    if not parts.netloc.isascii():  # checked on the raw netloc: .hostname lowercases, folding U+212A to k
        raise Refused(400, f'{field} has a non-ASCII host')
    if parts.username is not None or parts.password is not None or port is not None:
        raise Refused(400, f'{field} may not carry credentials or a port')
    local = parts.hostname in ('127.0.0.1', 'localhost')
    if parts.scheme == 'https' and _host_allowed(parts.hostname, entries):
        return
    if allow_local_http and parts.scheme == 'http' and local:
        return
    raise Refused(400, f'{field} is not an allowed https URL')


def validate_job(body, storage_hosts, callback_hosts, allow_local_http=False):
    if not isinstance(body, dict):
        raise Refused(400, 'body must be a JSON object')
    for field in JOB_FIELDS:
        if not isinstance(body.get(field), str) or not body[field]:
            raise Refused(400, f'{field} is required')
    _check_url('sourceUrl', body['sourceUrl'], storage_hosts, allow_local_http)
    _check_url('targetUrl', body['targetUrl'], storage_hosts, allow_local_http)
    _check_url('callbackUrl', body['callbackUrl'], callback_hosts, allow_local_http)
    if not body['filename'].lower().endswith('.sldprt'):
        raise Refused(422, 'only .sldprt files are converted')
    return {field: body[field] for field in JOB_FIELDS}


def download(url, dest, timeout=60):
    """Stream to dest. Over MAX_INPUT_BYTES is a verdict; any other problem is transient."""
    try:
        res = _opener.open(url, timeout=timeout)
    except urllib.error.HTTPError as e:
        e.close()
        raise RuntimeError(f'source answered {e.code}') from None
    with res:
        if res.status != 200:
            raise RuntimeError(f'source answered {res.status}')
        declared = res.headers.get('Content-Length')
        if declared and int(declared) > MAX_INPUT_BYTES:
            raise JobFailed('too_large')
        total = 0
        with open(dest, 'wb') as out:
            while True:
                chunk = res.read(1 << 20)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_INPUT_BYTES:
                    raise JobFailed('too_large')
                out.write(chunk)
    # http.client returns EOF silently when the server cuts the connection early: that is a network
    # failure, not a verdict on the file, so it must not become an 'unreadable' verdict.
    if declared and total != int(declared):
        raise RuntimeError('source truncated')
    return total


def run_converter(src, usd, run=subprocess.run):
    cmd = ['usd-convert-cad', '-i', str(src), '-o', str(usd), '--up-axis', 'y', '--material-type', 'preview-surface']
    try:
        p = run(cmd, capture_output=True, text=True, timeout=CONVERT_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise JobFailed('timeout') from None
    if p.returncode < 0:  # killed by a signal (OOM, SIGSEGV): not a verdict on the file
        raise RuntimeError(f'usd-convert-cad killed by signal {-p.returncode}')
    if p.returncode != 0 or not Path(usd).exists():
        raise JobFailed('unreadable: ' + (p.stderr or p.stdout or '').strip()[-300:])


def run_usd_to_glb(usd, glb, run=subprocess.run, python=GLTF_PYTHON):
    cmd = [python, str(HERE / 'usd_to_glb.py'), str(usd), str(glb)]
    try:
        p = run(cmd, capture_output=True, text=True, timeout=GLB_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise JobFailed('timeout') from None
    if p.returncode == 3:
        raise JobFailed((p.stderr or '').strip()[-300:] or 'no visible mesh')
    if p.returncode != 0:
        raise RuntimeError('usd_to_glb crashed: ' + (p.stderr or '').strip()[-300:])
    glb = Path(glb)
    if not glb.exists() or glb.stat().st_size < 12 or glb.read_bytes()[:4] != b'glTF':
        raise JobFailed('bad_glb')


def default_convert(src, usd, glb):
    run_converter(src, usd)
    run_usd_to_glb(usd, glb)


def put_file(url, path, content_type='model/gltf-binary', timeout=120):
    data = Path(path).read_bytes()
    req = urllib.request.Request(url, data=data, method='PUT', headers={'Content-Type': content_type})
    try:
        res = _opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        e.close()
        raise RuntimeError(f'target answered {e.code}') from None
    with res:
        if res.status != 200:
            raise RuntimeError(f'target answered {res.status}')


def post_callback(url, payload, attempts=3, sleep=time.sleep, timeout=20):
    """POST the result. Retries network errors, malformed responses and 5xx; a 4xx is final.
    Returns the last status, or None if no attempt got an HTTP status back."""
    data = json.dumps(payload).encode()
    status = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/json'})
            with _opener.open(req, timeout=timeout) as res:
                return res.status
        except urllib.error.HTTPError as e:
            status = e.code
            e.close()
            if e.code < 500:
                print(f'cad-worker: callback refused with {e.code}', file=sys.stderr)
                return status
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            print(f'cad-worker: callback failed: {e!r}', file=sys.stderr)
        if attempt < attempts - 1:
            sleep(2 ** attempt)
    return status


def process_job(job, workdir, *, convert=default_convert, sleep=time.sleep):
    """Run one job end to end and report it. Returns the payload it attempted to send (the callback
    may still have failed), or None when nothing was sent because the failure was transient."""
    workdir = Path(workdir)
    base = {'fileId': job['fileId'], 'claimId': job['claimId'], 'token': job['token']}
    src, usd, glb = workdir / 'input.sldprt', workdir / 'out.usdc', workdir / 'out.glb'
    try:
        download(job['sourceUrl'], src)
        convert(src, usd, glb)
        put_file(job['targetUrl'], glb)
        payload = {**base, 'ok': True, 'glbBytes': glb.stat().st_size}
    except JobFailed as e:
        payload = {**base, 'ok': False, 'reason': str(e)[:500]}
    except Exception as e:  # noqa: BLE001 - transient by definition; the claim goes stale and Stiko retries
        print(f'cad-worker: transient failure for {job["fileId"]}, not reported: {e!r}', file=sys.stderr)
        return None
    post_callback(job['callbackUrl'], payload, sleep=sleep)
    return payload
