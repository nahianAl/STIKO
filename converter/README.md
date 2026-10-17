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
| 400 | `{"error": "..."}` | Bad body, a URL that is not http(s), or a file that is not `.dwg`/`.dxf` |
| 401 | `{"error": "unauthorized"}` | Wrong secret, or `CAD_CONVERTER_SECRET` unset (then everything is refused) |
| 413 | `{"error": "over 50 MB"}` | The source is larger than 50 MB |
| 422 | `{"error": "unreadable or empty drawing"}` | A verdict on the drawing: unreadable, empty, over the 45 s limit, or killed by a resource limit |
| 502 | `{"error": "storage transfer failed"}` | Downloading the source or uploading the PDF failed |
| 500 | `{"error": "conversion failed unexpectedly"}` | A server fault, e.g. `dwg2dxf` cannot run |

Error bodies are fixed strings. Details go to the function log only, with presigned URLs scrubbed,
because they can quote file content or carry URL signatures.

The function holds no storage credentials. It reads one object and writes one, through the two
presigned URLs it is handed.

### Isolation inside the function

The HTTP handler never parses a drawing itself. It runs `api/_lib/drawing_pdf.py` as a child
process (`python drawing_pdf.py <source> <out.pdf> <dwg2dxf>`) with:

- **a bare environment:** `PYTHONPATH`, `PATH=/usr/bin:/bin`, `HOME`/`XDG_CACHE_HOME` pointing
  to a scratch directory, and `LANG=C.UTF-8`, plus `LD_LIBRARY_PATH` when the runtime sets one.
  The secret is never passed.
- **resource limits:** `RLIMIT_CPU` of 50 s and, on Linux, `RLIMIT_AS` of 2 GiB.
- **a 45 s wall-clock timeout.**

`dwg2dxf` runs under the child with only `PATH` and a 30 s timeout.

| Child result | Reply |
|---|---|
| Exit 0, page count on stdout | 200 |
| Exit 2 (bad drawing, or out of memory), timeout, or killed by a signal | 422 |
| Anything else | 500 |

## Deploying (its own Vercel project)

1. In Vercel: **Add New → Project**, then import this same GitHub repository.
2. **Root Directory:** `converter`. **Framework Preset:** Other. Leave the build and output
   settings empty.
3. **Environment Variables:** `CAD_CONVERTER_SECRET` only. Use a long random value, for example
   from `openssl rand -hex 32`. The stiko app must have the same value.
4. Deploy. The function URL is `https://<production domain>/api/convert_drawing`. The stiko app
   needs that full URL as `CAD_CONVERTER_URL`.

Use the project's **production domain**. Deployment-specific URLs are behind Vercel's deployment
protection, but the production domain is public. Every request is still refused without the
secret.

`vercel.json` gives the function `maxDuration: 60` and bundles `api/_lib` and `api/_bin`.
`requirements.txt` is fully pinned, with transitive dependencies included.

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
