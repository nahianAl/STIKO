# Stiko CAD worker

Converts a native CAD part upload to a millimetre, Y-up GLB. It converts the formats in `CAD_EXTENSIONS` (`.sldprt`, `.sldasm`, `.ipt`, `.catpart`, `.prt` and Creo's `.prt.<n>`, `.x_t`, `.x_b`, `.jt`, `.sat`); the app's `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` decides which of them are switched on. It runs on Modal on a T4 GPU and uses NVIDIA's Omniverse CAD Converter (`usd-convert-cad`). Stiko calls the `start` endpoint with presigned storage URLs; the worker downloads the part, converts it, uploads the GLB to the presigned target and calls Stiko back. A `.sldasm` converts on its own: SolidWorks stores a display copy of every component inside the assembly, so no part files are needed (an assembly saved without it comes out empty and is marked failed). Each GLB node is named after its component (`displayName`), else `Body N`.

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
| 422 | `filename` is not one of `CAD_EXTENSIONS` |
| 503 | spawn failed (transient — Stiko retries) |

## Size limits

An upload over 200 MB (`MAX_INPUT_BYTES`) is refused while downloading, and a converted GLB over 150 MB (`MAX_OUTPUT_BYTES`) is refused before it is uploaded. Both are verdicts on the file: the callback reports `ok: false` with reason `too_large` or `too_large_output`, and the file is marked failed. The output cap exists because the 200 MB audit showed a model that large freezes the viewer when it opens, and GLBs are not counted by the storage usage meters, so nothing else would stop one.

## Deploy and smoke test

You need the Modal CLI and `fastapi` in one Python environment (`pip install modal fastapi==0.146.0`), and `modal token new` once.

```bash
modal deploy cad-worker/app.py
modal run cad-worker/app.py::smoke --samples DIR_OF_SAMPLES --out DIR_FOR_GLB
```

`smoke` walks `DIR_OF_SAMPLES` recursively, converts up to `--per-format` files (default 3) of each format, spread by size, and writes each result as `<original name>.glb`. It prints one line per file with the seconds taken, or the error. It uses no storage and no callback. `modal run` starts an ephemeral app from the same image definition; it does not call the deployed app, so it proves the image and the conversion, not the deployed endpoint.

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

A secret passed on the command line lands in your shell history. Prefer `--from-dotenv PATH` with a `.env` file kept outside the repo, or read the value from a file with `CAD_WORKER_SECRET="$(cat PATH)"`.

Only the `start` endpoint gets this secret. The GPU conversion job runs without any secrets, because it parses untrusted CAD files.

Redeploy after changing the secret so running containers pick it up.

## Licence terms in use

The converter is governed by the NVIDIA Software License Agreement and the Product Specific Terms for NVIDIA AI Products. The terms the worker is built around:

- §1.1.2.1: the software is offered as a service on leased infrastructure (Modal).
- §8.15: Omniverse runs only on NVIDIA platforms, so the conversion function is pinned to `gpu='T4'`. Never run it on a CPU-only host.
- §1.7: the notice text is in `NOTICE`. NVIDIA may ask by email for monthly use reports; the Modal dashboard has the call counts.
- §11.1.3: telemetry. The image sets three environment variables to `1`: `OMNI_TELEMETRY_DISABLE`, `NV_TELEMETRY_DISABLE` and `OMNI_TELEMETRY_DISABLE_ANONYMOUS_DATA`. NVIDIA documents `OMNI_TELEMETRY_DISABLE_ANONYMOUS_DATA` for Carbonite telemetry. We have not verified from inside the container that no telemetry is sent.

Two questions are open with NVIDIA and should be answered in writing before relying on this in production:

1. The `usd-convert-cad` README says "Proprietary CAD formats may require CAD converter licensing". Does SolidWorks input need a separate HOOPS Exchange / Tech Soft 3D licence?
2. Is a paid hosted product explicitly allowed? The forum confirmations came from a non-NVIDIA poster.

NVIDIA's README says proprietary CAD formats can require CAD converter licensing; that question, open with NVIDIA, now covers Inventor, CATIA, NX, Creo, Parasolid and JT as well as SolidWorks.

## Tests

```bash
python -m pytest -q cad-worker/tests
```

Run it in a venv with `cad-worker/requirements-dev.txt` installed (e.g. `/tmp/cadworker-venv`). The tests cover the job logic and the USD to GLB writer; they do not touch Modal.

## Logs

```bash
modal app logs stiko-cad-worker
```

Grep for `cad-worker:`. The worker logs there when a callback is refused or fails, when a transient failure is not reported to Stiko, and when the `start` endpoint could not spawn a job (`cad-worker: spawn failed`, which also answers 503).

## Spend

Set a Modal workspace spending limit of about $30 a month. It is the hard stop. The code cap in Stiko (`SLDPRT_MONTHLY_CAP`, default 300 conversions a month) is soft: it counts claims, can undercount slightly after a reclaim, and does not know what a conversion costs. Despite its name it is shared by every converted format, not just SolidWorks.

## Rollback

Roll back with the app's environment first. Removing a format from the worker while the app still enables it leaves those files permanently "unavailable": the app still sends them, and the worker refuses them (422).

To roll back one format, remove it from `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` on the stiko Vercel project and redeploy. To roll back everything new, set `NEXT_PUBLIC_CAD_CONVERSION_FORMATS=sldprt` and redeploy. To turn all conversion off, set `NEXT_PUBLIC_CAD_CONVERSION_FORMATS=off`. `NEXT_PUBLIC_SLDPRT_CONVERSION` only applies while `NEXT_PUBLIC_CAD_CONVERSION_FORMATS` is unset or blank (or names no known format, which also logs a warning). Never `git revert` the feature: after a revert, parts that were already converted would show as unsupported, because the old viewer decides by file extension. With a format switched off, the new code still opens any part of that format that has a converted GLB and only stops accepting new ones.

The variables are read at build time and inlined into the browser bundle, so a redeploy is required, and it must be a redeploy without the build cache: a cached build can keep the old value. After a rollback, drop a file of the switched-off format in the uploader and confirm that format's export advice appears (for example "Export STEP, then upload."; for SolidWorks, "Save As STEP, then upload."). That proves the switch was inlined in the real build. `scripts/tests/sldprtSwitchOff.test.mjs` locks in the same behaviour for the code.

Only if the worker itself breaks SolidWorks conversion, restore the pre-feature worker too: `git worktree add /tmp/stiko-worker-rollback 4019050 && /tmp/stiko-cadw/bin/modal deploy /tmp/stiko-worker-rollback/cad-worker/app.py && git worktree remove /tmp/stiko-worker-rollback` (a throwaway checkout, so no working tree is left holding the old worker; any Python env with `modal` installed works).

## Reset a part wrongly marked failed

If the worker environment itself broke (a bad image, a GPU initialisation failure), every file converted in that window is marked failed permanently, even though the files are fine. After fixing and redeploying the worker, reset one part with:

```sql
UPDATE files SET conversion_status = NULL, conversion_job_id = NULL WHERE id = '<file id>' AND converted_storage_key IS NULL;
```

Run it through the project's usual `DATABASE_URL` procedure, then reopen the file in Stiko; the viewer starts a fresh conversion.
