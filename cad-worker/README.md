# Stiko CAD worker

Converts a SolidWorks `.sldprt` upload to a millimetre, Y-up GLB. It runs on Modal on a T4 GPU and uses NVIDIA's Omniverse CAD Converter (`usd-convert-cad`). Stiko calls the `start` endpoint with presigned storage URLs; the worker downloads the part, converts it, uploads the GLB to the presigned target and calls Stiko back.

## Deployed endpoint

```
https://hello-63953--stiko-cad-worker-start.us-east.modal.run
```

Modal workspace `hello-63953`, app `stiko-cad-worker`. Dashboard: https://modal.com/apps/hello-63953/main/deployed/stiko-cad-worker

`POST` with header `X-Worker-Secret` and a JSON body `{sourceUrl, targetUrl, callbackUrl, fileId, claimId, token, filename}`.

| Status | Meaning |
|---|---|
| 200 | `{callId}`; the job is running |
| 401 | missing or wrong `X-Worker-Secret` |
| 400 | body is not JSON, a field is missing, or a URL is not allowed |
| 422 | `filename` is not `.sldprt` |

## Deploy and smoke test

You need the Modal CLI and `fastapi` in one Python environment (`pip install modal fastapi==0.146.0`), and `modal token new` once.

```bash
modal deploy cad-worker/app.py
modal run cad-worker/app.py::smoke --samples DIR_OF_SLDPRT --out DIR_FOR_GLB
```

`smoke` converts every `*.sldprt` in `DIR_OF_SLDPRT` through the deployed image and prints one line per file with the seconds taken, or the error. It uses no storage and no callback.

## The secret

The Modal secret is named `stiko-cad-worker`. It has three keys:

- `CAD_WORKER_SECRET`: shared with Stiko's `CAD_WORKER_SECRET` environment variable. Rotate both together.
- `WORKER_STORAGE_HOSTS`: hosts the worker may download from and upload to. A leading dot means any subdomain (`.r2.cloudflarestorage.com`).
- `WORKER_CALLBACK_HOSTS`: the host the worker may call back. An exact host (`app.stiko.design`).

Create or replace it (the value of `CAD_WORKER_SECRET` is never stored in this repo):

```bash
modal secret create stiko-cad-worker --force \
  CAD_WORKER_SECRET=... \
  WORKER_STORAGE_HOSTS=.r2.cloudflarestorage.com \
  WORKER_CALLBACK_HOSTS=app.stiko.design
modal deploy cad-worker/app.py
```

Redeploy after changing the secret so running containers pick it up.

## Licence terms in use

The converter is governed by the NVIDIA Software License Agreement and the Product Specific Terms for NVIDIA AI Products. The terms the worker is built around:

- §1.1.2.1: the software is offered as a service on leased infrastructure (Modal).
- §8.15: Omniverse runs only on NVIDIA platforms, so the conversion function is pinned to `gpu='T4'`. Never run it on a CPU-only host.
- §1.7: the notice text is in `NOTICE`. NVIDIA may ask by email for monthly use reports; the Modal dashboard has the call counts.
- §11.1.3: telemetry is disabled in the image (`OMNI_TELEMETRY_DISABLE=1`, `NV_TELEMETRY_DISABLE=1`).

Two questions are open with NVIDIA and should be answered in writing before relying on this in production:

1. The `usd-convert-cad` README says "Proprietary CAD formats may require CAD converter licensing". Does SolidWorks input need a separate HOOPS Exchange / Tech Soft 3D licence?
2. Is a paid hosted product explicitly allowed? The forum confirmations came from a non-NVIDIA poster.

## Tests

```bash
/tmp/cadworker-venv/bin/python -m pytest -q cad-worker/tests
```

The venv needs `cad-worker/requirements-dev.txt`. The tests cover the job logic and the USD to GLB writer; they do not touch Modal.

## Logs

```bash
modal app logs stiko-cad-worker
```

Grep for `cad-worker:`. The worker logs there when a callback is refused or fails, and when a transient failure is not reported to Stiko.
