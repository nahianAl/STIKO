# stiko drawing converter

A single Vercel Python function, `POST /api/convert_drawing`, that turns one DWG or DXF drawing
into a black-and-white PDF: one page per paper-space sheet with content, in tab order, at the
sheet's plot paper size (model space when no sheet draws anything).

- DWG is first converted to DXF by GNU LibreDWG's `dwg2dxf` (a static x86_64 Linux build in
  `api/_bin/`).
- DXF is rendered by ezdxf's drawing add-on through PyMuPDF.

It is deployed as its **own Vercel project**, separate from the stiko app, even though both live
in this repository. On Vercel every function in a project receives all of that project's
environment variables, and this function parses untrusted uploads. Keeping it apart means the only
secret it can see is `CAD_CONVERTER_SECRET`. The stiko app calls it from
`app/api/files/[id]/convert-drawing/route.ts`.

## Licence

- **This folder (`converter/`)** is licensed under the **GNU Affero General Public License v3.0
  or later** (`AGPL-3.0-or-later`). The full text is in [`LICENSE`](LICENSE). It is AGPL because
  it uses PyMuPDF, which is AGPL. The rest of the repository is not affected.
- **`api/_bin/dwg2dxf`** is GNU LibreDWG 0.14, licensed `GPL-3.0-or-later`. The full text is in
  [`api/_bin/COPYING`](api/_bin/COPYING). [`api/_bin/NOTICE`](api/_bin/NOTICE) names the exact
  source tarball, its sha256, the build workflow and the binary's sha256.

## Contract

```
POST /api/convert_drawing
X-Converter-Secret: <CAD_CONVERTER_SECRET>
Content-Type: application/json

{"sourceUrl": "<presigned GET>", "targetUrl": "<presigned PUT>", "filename": "plan.dwg"}
```

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"pages": n}` with n ≥ 1 | The PDF was PUT to `targetUrl` with `Content-Type: application/pdf` |
| 400 | `{"error": "..."}` | Bad body, a URL that is not http(s), a URL whose host is not on the allowlist (see Configuration), or a file that is not `.dwg`/`.dxf` |
| 401 | `{"error": "unauthorized"}` | Wrong secret, or `CAD_CONVERTER_SECRET` unset (then everything is refused) |
| 413 | `{"error": "over 50 MB"}` | The source is larger than 50 MB |
| 422 | `{"error": "unreadable or empty drawing"}` | A verdict on the drawing: unreadable, empty, out of time after a fair share of the budget (see Time budget), or killed by a resource limit |
| 502 | `{"error": "storage transfer failed"}` | Downloading the source or uploading the PDF failed, ran past the time budget, or storage answered with a redirect (not followed) |
| 500 | `{"error": "conversion failed unexpectedly"}` | A server fault, e.g. `dwg2dxf` cannot run, or the conversion timed out after a short share of the budget (see Time budget) |

Error bodies are fixed strings. Details go to the function log only, with presigned URLs scrubbed,
because they can quote file content or carry URL signatures.

The function holds no storage credentials. It reads one object and writes one, through the two
presigned URLs it is handed.

### Time budget

The whole request, download plus conversion plus upload, has one budget of **50 s**
(`TOTAL_BUDGET_S`), so that it answers before stiko's route gives up at 55 s and before the
function's `maxDuration` of 60 s.

- The conversion child gets `max(5, 50 s - time spent so far)`. When it runs out, the reply
  depends on how much it was given. With a fair share (`FAIR_CHILD_TIMEOUT_S`, 30 s or more) it is
  a 422, because the same drawing would be too slow next time. With less (a slow download used up the
  budget, so a good drawing may simply have been starved) it is a 500, so that stiko releases the
  claim and a later open retries instead of failing the drawing for good. The log says which case it was.
- Each storage transfer keeps its 20 s per-call timeout, capped by what is left of the budget
  (never under 2 s), and a download that runs past the budget is a 502.

### Isolation inside the function

The HTTP handler never parses a drawing itself. It runs `api/_lib/drawing_pdf.py` as a child
process (`python drawing_pdf.py <source> <out.pdf> <dwg2dxf>`) with:

- **a bare environment:** `PYTHONPATH`, `PATH=/usr/bin:/bin`, `HOME`/`XDG_CACHE_HOME` pointing
  to a scratch directory, `LANG=C.UTF-8`, `LD_LIBRARY_PATH` when the runtime sets one, the
  thread and arena caps below, and the two limit values below. The secret is never passed.
- **thread and arena caps:** `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1`,
  `MKL_NUM_THREADS=1` and `MALLOC_ARENA_MAX=2`. `RLIMIT_AS` limits address space, and every thread
  stack and malloc arena reserves some; without these, numpy and glibc size both by core count.
- **resource limits, applied by the child to itself:** `RLIMIT_CPU` of 50 s and, on Linux,
  `RLIMIT_AS` of 2 GiB. The parent passes them as `CONVERTER_RLIMIT_CPU_S` and
  `CONVERTER_RLIMIT_AS_BYTES`; `drawing_pdf.py` reads them and sets them as its first act, before
  it imports ezdxf, PyMuPDF or numpy. There is no `preexec_fn`. `dwg2dxf` inherits the limits.
- **its own session:** the child is started with `start_new_session=True`. When it times out, and
  after every run, the handler `SIGKILL`s its whole process group, so nothing the child (or
  `dwg2dxf`) started can outlive the request.
- **a wall-clock timeout** from the time budget above.

`dwg2dxf` runs under the child with only `PATH` and a 30 s timeout.

| Child result | Reply |
|---|---|
| Exit 0, page count on stdout | 200 |
| Exit 2 (bad drawing, or out of memory), timeout with 30 s or more, or killed by a signal | 422 |
| Timeout with under 30 s (a short share of the budget) | 500 |
| Anything else | 500 |

### Configuration

| Variable | Needed | Meaning |
|---|---|---|
| `CAD_CONVERTER_SECRET` | yes (secret) | Shared with the stiko app. Unset refuses everything. |
| `CONVERTER_ALLOWED_HOST_SUFFIXES` | no (not a secret) | Comma-separated hosts the two URLs may point at; any other host is a 400. An entry with a leading dot matches any subdomain (`.r2.cloudflarestorage.com`); one without matches that exact host. Default: `.r2.cloudflarestorage.com`. Redirects are never followed. |

### Security notes

- The function can only read one object and write one, through URLs it is handed, and only on
  an allowlisted storage host, so it cannot be aimed at an internal address such as
  `169.254.169.254`.
- **Residual risk: the shared scratch directory.** `HOME`, the font cache and the copy of
  `dwg2dxf` live in `/tmp`, shared by every request on a warm instance. A malicious drawing that
  exploits `dwg2dxf` (native C code) could tamper with those files and so affect later requests
  on the same instance. The mitigation is the session kill: nothing the exploit left running
  outlives its own request. A per-request `HOME` would close the gap but would rebuild ezdxf's
  font cache on every request (about 0.4 s more), so it is not done.
- **Residual risk: code execution in the child.** The bare environment keeps the secret away from
  ordinary bugs. An attacker who got code running in the child would run as the same user and
  could read the parent's environment (`/proc/<pid>/environ`), including `CAD_CONVERTER_SECRET`.
  That is why the converter is its own Vercel project holding nothing else, and why the host
  allowlist exists: the secret only lets a caller convert drawings between allowlisted storage
  URLs.

## Deploying (its own Vercel project)

1. In Vercel: **Add New → Project**, then import this same GitHub repository.
2. **Root Directory:** `converter`. **Framework Preset:** Other. Leave the build and output
   settings empty.
3. **Environment Variables:** `CAD_CONVERTER_SECRET` only. Use a long random value, for example
   from `openssl rand -hex 32`. The stiko app must have the same value. (Optionally
   `CONVERTER_ALLOWED_HOST_SUFFIXES`, see Configuration.)
4. **Ignored Build Step:** already set in `vercel.json` (`git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .`, run
   inside the Root Directory), so a push that does not touch `converter/` does not build. It
   compares the pushed head with the last deployed commit (`VERCEL_GIT_PREVIOUS_SHA`), so a push of
   several commits builds when any of them touched `converter/`, not only the last. Without that
   variable (the first deploy) it falls back to `HEAD^`; if git cannot resolve the commit, the
   command fails and the build runs, which is the safe direction. The first deploy of the project
   always builds.
5. Deploy. The function URL is `https://<production domain>/api/convert_drawing`. The stiko app
   needs that full URL as `CAD_CONVERTER_URL`.
6. **Deploy gate: check the 2 GiB cap on real drawings.** Before pointing stiko at the project,
   convert the Autodesk sample DWGs (the DWG 2007 and 2010 sample sheets it was spiked on, the
   civil sample among them) through the deployed function. The `RLIMIT_AS` of 2 GiB and the thread and
   arena caps have never run on Vercel's Linux runtime. If a sample comes back 422 with
   `out of memory while converting` or a `SIGKILL` in the function log, raise
   `CHILD_ADDRESS_SPACE_BYTES` in `api/convert_drawing.py`; if the function cannot start the child
   at all, the replies are 500 and the log has the traceback.

Use the project's **production domain**. Deployment-specific URLs are behind Vercel's deployment
protection, but the production domain is public. Every request is still refused without the
secret.

`vercel.json` gives the function `maxDuration: 60`, bundles `api/_lib` and `api/_bin`, and sets the
Ignored Build Step. `requirements.txt` is fully pinned, with transitive dependencies included.

**Python version:** `.python-version` contains `3.12`, which Vercel reads, so the runtime does not
drift. Every pin in `requirements.txt` has a cp312 `manylinux` x86_64 wheel (PyMuPDF's is
`abi3`, pyparsing and typing_extensions are pure Python), checked with `pip download
--python-version 3.12 --platform manylinux_2_28_x86_64 --only-binary=:all:`. Bump the file and
re-check the wheels together.

## Tests

The tests live in `scripts/pytests/`, outside this folder, and are not part of `npm test`. From
the repository root:

```bash
python3 -m venv /tmp/dwgenv
/tmp/dwgenv/bin/pip install -r scripts/pytests/requirements-dev.txt
brew install libredwg          # the bundled dwg2dxf is a Linux binary
DWG2DXF=$(which dwg2dxf) /tmp/dwgenv/bin/python -m pytest -q -p no:cacheprovider \
  -c scripts/pytests/pytest.ini scripts/pytests
```

`.github/workflows/verify-dwg2dxf.yml` checks the bundled binary on Amazon Linux 2023.
`.github/workflows/build-dwg2dxf.yml` rebuilds it.

## Runbook: retrying drawings that failed

stiko never retries a drawing marked `'failed'` on its own. After fixing whatever made good
drawings fail (a converter bug, a limit that was too tight), you can clear their status. The next
person to open each one then converts it again.

Run this **deliberately, by hand, in the Neon console** (SQL Editor) against the production
database. Nothing runs it automatically.

```sql
UPDATE files SET conversion_status = NULL, conversion_job_id = NULL WHERE conversion_status = 'failed' AND (filename ILIKE '%.dwg' OR filename ILIKE '%.dxf');
```
