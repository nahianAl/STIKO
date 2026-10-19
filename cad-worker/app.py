"""Stiko CAD worker on Modal: .sldprt -> GLB with NVIDIA usd-convert-cad on a T4.

Deploy:  modal deploy cad-worker/app.py      (needs `pip install modal fastapi` locally)
Smoke:   modal run cad-worker/app.py::smoke --samples DIR --out DIR
See README.md for the secret, the licence terms in use, and the runbook.
"""

import os
import tempfile
import time
from pathlib import Path

import modal

try:
    import fastapi
except ImportError:  # the GPU image has no fastapi; only the web image serves requests
    fastapi = None

HERE = Path(__file__).resolve().parent
secret = modal.Secret.from_name('stiko-cad-worker')

# usd-convert-cad bundles its own OpenUSD; usd_to_glb.py needs Pixar's usd-core. They live in
# separate environments so the two USD builds never load into one interpreter.
gpu_image = (
    modal.Image.debian_slim(python_version='3.12')
    .apt_install('libgl1', 'libglib2.0-0', 'libxext6', 'libsm6', 'libxrender1', 'libgomp1', 'libxi6', 'libxt6')
    .uv_pip_install('usd-convert-cad==0.3.0')
    .run_commands('python -m venv /opt/gltf', '/opt/gltf/bin/pip install -q usd-core==26.8 numpy==2.5.4')
    # NVIDIA AI Product Terms 11.1.3: telemetry off. NVIDIA documents the third variable for Carbonite telemetry.
    .env({'OMNI_TELEMETRY_DISABLE': '1', 'NV_TELEMETRY_DISABLE': '1', 'OMNI_TELEMETRY_DISABLE_ANONYMOUS_DATA': '1'})
    .add_local_file(HERE / 'worker_core.py', '/root/worker_core.py')
    .add_local_file(HERE / 'usd_to_glb.py', '/root/usd_to_glb.py')
)
web_image = (
    modal.Image.debian_slim(python_version='3.12')
    .uv_pip_install('fastapi[standard]==0.146.0')
    .add_local_file(HERE / 'worker_core.py', '/root/worker_core.py')
)

app = modal.App('stiko-cad-worker')


# No secrets here: this container parses untrusted CAD files and process_job never reads the environment.
# max_containers bounds spend (budget is $30/month).
@app.function(image=gpu_image, gpu='T4', timeout=600, retries=0, max_containers=2)
def convert_job(job: dict):
    # NVIDIA AI Product Terms 8.15: Omniverse runs only on NVIDIA platforms, hence gpu='T4'.
    import worker_core

    with tempfile.TemporaryDirectory() as d:
        return worker_core.process_job(job, Path(d))


@app.function(image=web_image, secrets=[secret])
@modal.fastapi_endpoint(method='POST')
async def start(request: 'fastapi.Request'):
    import hmac

    import worker_core
    from fastapi.responses import JSONResponse

    expected = os.environ.get('CAD_WORKER_SECRET', '')
    given = request.headers.get('x-worker-secret', '')
    if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        return JSONResponse({'error': 'unauthorized'}, status_code=401)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return JSONResponse({'error': 'body must be JSON'}, status_code=400)
    try:
        job = worker_core.validate_job(
            body,
            worker_core.parse_hosts(os.environ.get('WORKER_STORAGE_HOSTS', '.r2.cloudflarestorage.com')),
            worker_core.parse_hosts(os.environ.get('WORKER_CALLBACK_HOSTS', '')),
        )
    except worker_core.Refused as e:
        return JSONResponse({'error': e.reason}, status_code=e.status)
    try:
        call = await convert_job.spawn.aio(job)
    except Exception as e:  # noqa: BLE001
        print(f'cad-worker: spawn failed: {e!r}')
        return JSONResponse({'error': 'spawn failed'}, status_code=503)
    return {'callId': call.object_id}


@app.function(image=gpu_image, gpu='T4', timeout=600)
def convert_bytes(name: str, data: bytes) -> dict:
    """Smoke test only: the same conversion as convert_job, on bytes, with no storage or callback."""
    import worker_core

    with tempfile.TemporaryDirectory() as d:
        src, usd, glb = Path(d) / name, Path(d) / 'out.usdc', Path(d) / 'out.glb'
        src.write_bytes(data)
        t = time.time()
        try:
            worker_core.default_convert(src, usd, glb)
        except worker_core.JobFailed as e:
            return {'name': name, 'error': str(e)}
        return {'name': name, 'seconds': round(time.time() - t, 2), 'glb': glb.read_bytes()}


@app.local_entrypoint()
def smoke(samples: str, out: str):
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    files = [p for p in Path(samples).iterdir() if p.suffix.lower() == '.sldprt']
    for f in sorted(files, key=lambda p: p.stat().st_size):
        r = convert_bytes.remote(f.name, f.read_bytes())
        glb = r.pop('glb', None)
        if glb:
            (out_dir / (f.stem + '.glb')).write_bytes(glb)
        print(r, len(glb or b''))
