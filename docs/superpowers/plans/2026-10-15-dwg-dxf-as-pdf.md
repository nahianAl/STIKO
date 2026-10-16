# DWG and DXF as PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewers can open DWG and DXF files in Stiko. Each one is converted server-side to a black-and-white PDF and shown in the existing PDF viewer.

**Architecture:**
- **Converter:** a Vercel Python function (`api/convert_drawing.py`) turns one DWG/DXF into a PDF. It uses LibreDWG `dwg2dxf`, then ezdxf with PyMuPDF.
- **What it touches:** it is handed a presigned GET URL for the drawing and a presigned PUT URL for the PDF, so it holds no storage credentials.
- **Trigger:** an authenticated Next route (`POST /api/files/[id]/convert-drawing`) claims the job and calls the function with a shared secret. It then records the PDF as the file's `converted_storage_key`.
- **Viewer:** `ViewerContainer` shows a converted drawing in `PDFKonvaViewer`. When no PDF exists yet, it triggers the conversion and polls.

**Tech Stack:**
- Python 3.12 on Vercel: ezdxf 1.4.4, PyMuPDF 1.28.2, and a static LibreDWG 0.14 `dwg2dxf`
- Next.js 14 App Router, TypeScript
- Neon Postgres, Cloudflare R2 (S3 API)
- `node --test` and pytest

**Spec:** `docs/superpowers/specs/2026-10-15-dwg-dxf-as-pdf-design.md`

**One deliberate change from the spec:** the spec had the Python function reach R2 with boto3 and the `R2_*` credentials. Instead, the Next route passes a presigned GET URL for the source and a presigned PUT URL for the target. The function gets least privilege (one object in, one object out, for minutes), and boto3 (~80 MB) stays out of the bundle.

## Global Constraints

- **Budget:** $0 running cost. No new paid service.
- **Rendering:** black lines on white: `ColorPolicy.BLACK`, `BackgroundPolicy.WHITE`.
- **Pages:** one per paper-space layout with content, in tab order, at the layout's plot paper size (A3 landscape 420 × 297 mm when undefined). Margins are 10 mm. Model space is used only when no sheet draws anything.
- **Hatch cap:** `min_hatch_line_distance=0.5` and `hatching_timeout=10`. Uncapped, one hatch produced about 3.5M lines and took 9 minutes.
- **Limits:**
  - source drawing ≤ 50 MB
  - `dwg2dxf` timeout 30 s
  - function `maxDuration` 60 s
  - the Next route's call to it times out at 55 s
- **Converted PDF key:** `<directory>/<stem>.drawing.pdf`, always derived server-side, never from the client.
- **Claim:** `conversion_job_id = 'drawing:<ISO timestamp>'`; a `'processing'` claim older than 3 minutes is stale and may be reclaimed. `'failed'` is never retried automatically.
- **Auth:**
  - The Python endpoint authenticates only by the `X-Converter-Secret` header against env `CAD_CONVERTER_SECRET`, compared in constant time. An unset secret refuses everything.
  - Every Next route here calls `auth()` and `getFileAccess()` itself: `/api/files` is a PUBLIC middleware prefix.
- **Never `git add -A` or `git add .`.** Three long-lived untracked handoff directories get swept in. Add explicit paths.
- **After every task**, run `npx tsc --noEmit` as well as the tests.
- **Imports:** a `lib/` module reached by `node --test` uses relative `.ts`-extensioned imports, never `@/`.
- **Brand:** the product name is written `stiko`, lowercase, in visible text.
- **Licensing:** the repo is PUBLIC. Any GPL-3.0 artifact committed (the `dwg2dxf` binary, the LibreDWG test DWG) must sit beside a NOTICE naming its licence, version and exact source.
- **Branch:** `feature/dwg-dxf-as-pdf`, created from `main`.
- **Safety:** production is the only environment, and local dev talks to the PRODUCTION database and R2. Never upload or write through a locally running app.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/user/Desktop/STIKO-main
git checkout main && git checkout -b feature/dwg-dxf-as-pdf
```

Expected: `Switched to a new branch 'feature/dwg-dxf-as-pdf'`

---

### Task 1: The converter core (Python, pure)

**Files:**
- Create: `api/_lib/drawing_pdf.py`
- Create: `requirements.txt` (repo root; Vercel installs it for the Python function)
- Create: `scripts/pytests/requirements-dev.txt`
- Create: `scripts/pytests/pytest.ini`
- Create: `scripts/pytests/conftest.py`
- Create: `scripts/pytests/README.md`
- Create: `scripts/pytests/test_drawing_pdf.py`
- Create: `scripts/pytests/fixtures/example_2018.dwg` (binary, from LibreDWG's test data)
- Create: `scripts/pytests/fixtures/NOTICE`

**Interfaces:**
- Produces:
  - `convert(source_path: str, dwg2dxf: str) -> tuple[bytes, int]` returns (PDF bytes, page count) and raises `DrawingError`
  - `class DrawingError(Exception)`
  - `layouts_to_render(doc)` and `page_size_mm(layout)`

Tests live under `scripts/pytests/`, not `api/`, so they are never bundled into the function.

- [ ] **Step 1: Python environment for tests (outside the repo)**

```bash
SCRATCH=$(mktemp -d)/dwgenv && python3 -m venv "$SCRATCH" && echo "$SCRATCH"
which dwg2dxf || brew install libredwg   # LibreDWG 0.14; already installed on this Mac
```

Use `"$SCRATCH"/bin/pip` and `"$SCRATCH"/bin/python` below. Never create a venv inside the repo.

- [ ] **Step 2: Dependency files**

`requirements.txt` (repo root):

```
ezdxf==1.4.4
pymupdf==1.28.2
pillow==12.3.0
```

(`ezdxf.addons.drawing` imports Pillow when it loads. Found during Task 1.)

`scripts/pytests/requirements-dev.txt`:

```
-r ../../requirements.txt
pytest==8.4.2
```

`scripts/pytests/pytest.ini`:

```ini
[pytest]
filterwarnings =
    ignore::DeprecationWarning
```

`scripts/pytests/conftest.py`:

```python
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'api', '_lib'))
```

`scripts/pytests/README.md`:

````markdown
# Python tests (the DWG/DXF converter)

Not part of `npm test`. They need Python 3.12+ and LibreDWG's `dwg2dxf`.

```bash
python3 -m venv /tmp/dwgenv
/tmp/dwgenv/bin/pip install -r scripts/pytests/requirements-dev.txt
brew install libredwg          # or set DWG2DXF to a dwg2dxf binary
DWG2DXF=$(which dwg2dxf) /tmp/dwgenv/bin/python -m pytest -q -p no:cacheprovider \
  -c scripts/pytests/pytest.ini scripts/pytests
```

`DWG2DXF` overrides the bundled `api/_bin/dwg2dxf`, which is a Linux binary and does not run on
macOS.
````

Install:

```bash
"$SCRATCH"/bin/pip install -q -r scripts/pytests/requirements-dev.txt
```

- [ ] **Step 3: The DWG fixture and its notice**

```bash
mkdir -p scripts/pytests/fixtures
curl -fsSL https://raw.githubusercontent.com/LibreDWG/libredwg/0.14/test/test-data/example_2018.dwg \
  -o scripts/pytests/fixtures/example_2018.dwg || \
curl -fsSL https://raw.githubusercontent.com/LibreDWG/libredwg/master/test/test-data/example_2018.dwg \
  -o scripts/pytests/fixtures/example_2018.dwg
head -c 6 scripts/pytests/fixtures/example_2018.dwg; echo
```

Expected output starts `AC1032`. Note which URL succeeded, for the NOTICE.

`scripts/pytests/fixtures/NOTICE`:

```
example_2018.dwg — from GNU LibreDWG's test data (test/test-data/example_2018.dwg),
https://github.com/LibreDWG/libredwg, fetched from the ref noted below. Licensed GPL-3.0-or-later
as part of LibreDWG. Used only as a test input; it is not part of the deployed application.
Ref: <0.14 or master — whichever the curl above succeeded with>
```

Replace the `Ref:` line's placeholder with the real ref before committing.

- [ ] **Step 4: Write the failing tests**

`scripts/pytests/test_drawing_pdf.py`:

```python
"""Converter core tests. How to run: scripts/pytests/README.md."""
import os
import shutil

import ezdxf
import pymupdf
import pytest

from drawing_pdf import DrawingError, convert, layouts_to_render, page_size_mm

HERE = os.path.dirname(__file__)
DWG2DXF = os.environ.get('DWG2DXF') or shutil.which('dwg2dxf') or os.path.join(HERE, '..', '..', 'api', '_bin', 'dwg2dxf')
DWG_FIXTURE = os.path.join(HERE, 'fixtures', 'example_2018.dwg')


def two_sheet_dxf(path):
    doc = ezdxf.new(setup=True)
    doc.modelspace().add_line((0, 0), (100, 100), dxfattribs={'color': 2})  # yellow on screen
    for name in ('A-101', 'A-102'):
        sheet = doc.layouts.new(name)
        sheet.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units='mm')
        sheet.add_line((20, 20), (400, 20), dxfattribs={'color': 1})  # red on screen
    doc.saveas(path)
    return path


def test_each_sheet_with_content_becomes_a_page(tmp_path):
    pdf, pages = convert(two_sheet_dxf(str(tmp_path / 'sheets.dxf')), DWG2DXF)
    assert pages == 2
    assert pymupdf.open(stream=pdf, filetype='pdf').page_count == 2


def test_empty_layout_tabs_are_skipped_and_model_space_is_the_fallback(tmp_path):
    doc = ezdxf.new(setup=True)
    doc.modelspace().add_circle((0, 0), 50)
    doc.saveas(tmp_path / 'model.dxf')
    reread = ezdxf.readfile(tmp_path / 'model.dxf')
    assert [lay.name for lay in layouts_to_render(reread)] == ['Model']
    _, pages = convert(str(tmp_path / 'model.dxf'), DWG2DXF)
    assert pages == 1


def test_page_size_follows_the_layout_paper(tmp_path):
    doc = ezdxf.readfile(two_sheet_dxf(str(tmp_path / 'sheets.dxf')))
    width, height = page_size_mm(doc.layouts.get('A-101'))
    assert (round(width), round(height)) == (420, 297)
    pdf, _ = convert(str(tmp_path / 'sheets.dxf'), DWG2DXF)
    rect = pymupdf.open(stream=pdf, filetype='pdf')[0].rect
    assert (round(rect.width / 72 * 25.4), round(rect.height / 72 * 25.4)) == (420, 297)


def test_lines_are_black_on_white(tmp_path):
    pdf, _ = convert(two_sheet_dxf(str(tmp_path / 'sheets.dxf')), DWG2DXF)
    pix = pymupdf.open(stream=pdf, filetype='pdf')[0].get_pixmap(dpi=150)
    samples = pix.samples
    pixels = [tuple(samples[i:i + 3]) for i in range(0, len(samples), pix.n)]
    drawn = [p for p in pixels if max(p) < 240]
    assert drawn, 'expected the red-on-screen line to be drawn'
    # Nothing coloured: every pixel is a grey, white or black.
    assert all(max(p) - min(p) < 30 for p in pixels)


def test_a_real_dwg_converts_through_dwg2dxf():
    pdf, pages = convert(DWG_FIXTURE, DWG2DXF)
    assert pages >= 1
    assert pdf.startswith(b'%PDF')


def test_garbage_is_a_drawing_error(tmp_path):
    bad = tmp_path / 'bad.dwg'
    bad.write_bytes(b'not a drawing at all')
    with pytest.raises(DrawingError):
        convert(str(bad), DWG2DXF)


def test_a_sheet_that_draws_nothing_falls_back_to_model_space(tmp_path):
    # A sheet whose only content is a viewport looking at empty model space, far from the
    # drawing, renders nothing; the page must come from model space instead.
    doc = ezdxf.new(setup=True)
    doc.modelspace().add_line((0, 0), (100, 50))
    sheet = doc.layouts.new('Empty view')
    sheet.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units='mm')
    sheet.add_viewport(center=(210, 148), size=(300, 200), view_center_point=(1e7, 1e7), view_height=10)
    doc.saveas(tmp_path / 'emptyview.dxf')
    _, pages = convert(str(tmp_path / 'emptyview.dxf'), DWG2DXF)
    assert pages == 1


def test_an_empty_drawing_is_a_drawing_error(tmp_path):
    ezdxf.new().saveas(tmp_path / 'empty.dxf')
    with pytest.raises(DrawingError):
        convert(str(tmp_path / 'empty.dxf'), DWG2DXF)
```

- [ ] **Step 5: Run them to see them fail**

Run:
```bash
DWG2DXF=$(which dwg2dxf) "$SCRATCH"/bin/python -m pytest -q -p no:cacheprovider -c scripts/pytests/pytest.ini scripts/pytests/test_drawing_pdf.py
```
Expected: collection error, `ModuleNotFoundError: No module named 'drawing_pdf'`.

- [ ] **Step 6: Implement `api/_lib/drawing_pdf.py`**

```python
"""DWG/DXF -> PDF for Stiko's viewer. Pure: bytes or paths in, PDF bytes out; no network.

One PDF page per paper-space layout that has content, in tab order, at the layout's plot
paper size; model space only when no layout has content. Black lines on white, like a
plotted sheet.
"""
from __future__ import annotations

import os
import subprocess
import tempfile

import pymupdf
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext, config, layout
from ezdxf.addons.drawing import pymupdf as pymupdf_backend
from ezdxf.layouts import Layout

#: A3 landscape, used when a layout defines no paper size and for model space.
DEFAULT_PAGE_MM = (420.0, 297.0)
MARGIN_MM = 10.0
DWG2DXF_TIMEOUT_S = 30

#: Hatch patterns can expand to millions of line segments: one Autodesk sample sheet produced
#: ~3.5M and took 9 minutes to draw. Skipping pattern lines closer than 0.5 drawing units, and
#: giving up on a pattern after 10 s, brought that sheet to ~2 s with no visible loss.
RENDER_CONFIG = config.Configuration(
    background_policy=config.BackgroundPolicy.WHITE,
    color_policy=config.ColorPolicy.BLACK,
    min_hatch_line_distance=0.5,
    hatching_timeout=10,
)


class DrawingError(Exception):
    """The drawing could not be read, or held nothing to show. The message is for logs."""


def dwg_to_dxf(dwg_path: str, out_dir: str, dwg2dxf: str) -> str:
    """Convert a DWG file to DXF with LibreDWG's dwg2dxf. Returns the DXF path."""
    dxf_path = os.path.join(out_dir, 'drawing.dxf')
    try:
        result = subprocess.run(
            [dwg2dxf, '-y', '-o', dxf_path, dwg_path],
            capture_output=True, text=True, timeout=DWG2DXF_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as err:
        raise DrawingError(f'dwg2dxf timed out after {DWG2DXF_TIMEOUT_S}s') from err
    # dwg2dxf exits non-zero on recoverable warnings too; the output file is the real signal.
    if not os.path.exists(dxf_path) or os.path.getsize(dxf_path) == 0:
        raise DrawingError(f'dwg2dxf produced no DXF: {result.stderr[-300:]}')
    return dxf_path


def has_content(lay: Layout) -> bool:
    """A paper-space layout counts when it holds anything besides its own overall viewport.

    Every paper-space layout owns one VIEWPORT with id 1 that is the sheet itself; an empty
    "Layout2" tab holds only that. Any other entity, including a real viewport onto model
    space (id > 1), means the sheet shows something.
    """
    for entity in lay:
        if entity.dxftype() != 'VIEWPORT' or entity.dxf.get('id', 0) > 1:
            return True
    return False


def layouts_to_render(doc) -> list[Layout]:
    """Paper-space layouts with content, in tab order; else model space alone."""
    sheets = [lay for lay in doc.layouts if not lay.is_modelspace and has_content(lay)]
    return sheets or [doc.modelspace()]


def page_size_mm(lay: Layout) -> tuple[float, float]:
    """The layout's plot paper size in mm, rotated as plotted; A3 landscape when undefined."""
    if lay.is_modelspace:
        return DEFAULT_PAGE_MM
    dxf = lay.dxf_layout.dxf
    width = float(dxf.get('paper_width', 0) or 0)
    height = float(dxf.get('paper_height', 0) or 0)
    if width <= 0 or height <= 0:
        return DEFAULT_PAGE_MM
    # plot_rotation 1 and 3 are 90 and 270 degrees: the sheet is plotted turned.
    if dxf.get('plot_rotation', 0) in (1, 3):
        width, height = height, width
    return (width, height)


def render_layout(doc, lay: Layout) -> bytes | None:
    """One layout as a single-page PDF, or None when it draws nothing.

    A sheet can hold only a viewport onto model space that renders empty, e.g. when a
    viewport's view settings did not survive DWG -> DXF. Autodesk's civil sample does this.
    ezdxf reports it as "empty bounding box"; treat that as "nothing on this sheet".
    """
    backend = pymupdf_backend.PyMuPdfBackend()
    Frontend(RenderContext(doc), backend, config=RENDER_CONFIG).draw_layout(lay)
    width, height = page_size_mm(lay)
    page = layout.Page(width, height, layout.Units.mm, margins=layout.Margins.all(MARGIN_MM))
    try:
        return backend.get_pdf_bytes(page)
    except ValueError as err:
        if 'empty bounding box' in str(err):
            return None
        raise


def render_pdf(doc) -> tuple[bytes, int]:
    """Render the drawing into one PDF. Returns (pdf bytes, page count).

    Sheets that draw nothing are skipped; if no sheet draws anything, model space is used.
    """
    rendered = [data for lay in layouts_to_render(doc) if (data := render_layout(doc, lay))]
    if not rendered and not layouts_to_render(doc)[0].is_modelspace:
        model = render_layout(doc, doc.modelspace())
        rendered = [model] if model else []
    if not rendered:
        raise DrawingError('the drawing has nothing to show')
    merged = pymupdf.open()
    for data in rendered:
        with pymupdf.open(stream=data, filetype='pdf') as single:
            merged.insert_pdf(single)
    out = merged.tobytes()
    merged.close()
    return out, len(rendered)


def convert(source_path: str, dwg2dxf: str) -> tuple[bytes, int]:
    """DWG or DXF file on disk -> (PDF bytes, page count). Raises DrawingError."""
    with tempfile.TemporaryDirectory() as work:
        path = source_path
        if source_path.lower().endswith('.dwg'):
            path = dwg_to_dxf(source_path, work, dwg2dxf)
        try:
            doc, _auditor = recover.readfile(path)
        except Exception as err:  # ezdxf raises several unrelated types for a bad file
            raise DrawingError(f'not a readable DXF: {err}') from err
        return render_pdf(doc)
```

- [ ] **Step 7: Run the tests to see them pass**

Same command as Step 5.
Expected: `8 passed`, with no other output lines besides the summary.

- [ ] **Step 8: Commit**

```bash
git add api/_lib/drawing_pdf.py requirements.txt scripts/pytests/requirements-dev.txt scripts/pytests/pytest.ini scripts/pytests/conftest.py scripts/pytests/README.md scripts/pytests/test_drawing_pdf.py scripts/pytests/fixtures/example_2018.dwg scripts/pytests/fixtures/NOTICE
git commit -m "feat(drawings): DWG/DXF to black-and-white PDF converter core"
```

---

### Task 2: The Python endpoint

**Files:**
- Create: `api/convert_drawing.py`
- Create: `scripts/pytests/test_convert_drawing_handler.py`

**Interfaces:**
- Consumes: `convert`, `DrawingError` (Task 1).
- Produces: `POST /api/convert_drawing`.
  - Request: JSON `{sourceUrl, targetUrl, filename}` plus header `X-Converter-Secret`.
  - Responses:
    - `200 {"pages": n}` on success
    - `400` bad body or not a DWG/DXF
    - `401` wrong or missing secret
    - `413` source over 50 MB
    - `422 {"error"}` unreadable or empty drawing
    - `502` storage transfer failed
  - The PDF is PUT with `Content-Type: application/pdf`.

- [ ] **Step 1: Write the failing tests**

`scripts/pytests/test_convert_drawing_handler.py`:

```python
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
```

- [ ] **Step 2: Run them to see them fail**

Run:
```bash
DWG2DXF=$(which dwg2dxf) "$SCRATCH"/bin/python -m pytest -q -p no:cacheprovider -c scripts/pytests/pytest.ini scripts/pytests/test_convert_drawing_handler.py
```
Expected: error, `FileNotFoundError` for `api/convert_drawing.py`.

- [ ] **Step 3: Implement `api/convert_drawing.py`**

Vercel's Python runtime serves a module-level `class handler(BaseHTTPRequestHandler)`. Files and directories under `api/` whose names start with `_` are not served as functions, which is why the helpers live in `api/_lib` and the binary in `api/_bin`.

```python
"""Vercel Python function: POST /api/convert_drawing

Converts one DWG/DXF to PDF. Called only by Stiko's own Next route
(app/api/files/[id]/convert-drawing), never by a browser.

Request:  JSON {"sourceUrl": presigned GET, "targetUrl": presigned PUT, "filename": str}
          header X-Converter-Secret: must equal env CAD_CONVERTER_SECRET
Response: 200 {"pages": n} | 400 bad request | 401 bad secret | 413 too large
          | 422 {"error": ...} unreadable or empty drawing | 502 storage transfer failed

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
```

- [ ] **Step 4: Run all Python tests to see them pass**

Run:
```bash
DWG2DXF=$(which dwg2dxf) "$SCRATCH"/bin/python -m pytest -q -p no:cacheprovider -c scripts/pytests/pytest.ini scripts/pytests
```
Expected: `14 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/convert_drawing.py scripts/pytests/test_convert_drawing_handler.py
git commit -m "feat(drawings): secret-guarded Vercel function that converts one drawing"
```

---

### Task 3: A static Linux `dwg2dxf`, bundled with the function

**Files:**
- Create: `.github/workflows/build-dwg2dxf.yml`
- Create (binary): `api/_bin/dwg2dxf`
- Create: `api/_bin/NOTICE`
- Modify: `vercel.json`

**Interfaces:**
- Produces: `api/_bin/dwg2dxf`, a statically linked x86_64 Linux executable that `api/convert_drawing.py` finds by default. It is bundled by `vercel.json`'s `includeFiles`.

**Authorization:** the user approved running a GitHub Actions build on their repo (2026-10-15). It is triggered by pushing a throwaway branch `ci/build-dwg2dxf`, never `main` (which auto-deploys). Delete that remote branch afterwards.

- [ ] **Step 1: The workflow**

`.github/workflows/build-dwg2dxf.yml`:

```yaml
# Builds LibreDWG's dwg2dxf as a fully static x86_64 Linux binary for the Vercel Python
# function in api/convert_drawing.py (Vercel runs Amazon Linux; static avoids glibc skew).
# To rebuild: push this file to branch ci/build-dwg2dxf, then download the artifact.
name: Build dwg2dxf
on:
  workflow_dispatch:
  push:
    branches: ['ci/build-dwg2dxf']
jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - name: Fetch and verify LibreDWG 0.14
        run: |
          curl -fsSL https://ftpmirror.gnu.org/libredwg/libredwg-0.14.tar.gz -o libredwg.tar.gz
          echo "cb6ee0b078c6d9e0f09d66f1feac33ba6342df88ae544e9f9335fab475218351  libredwg.tar.gz" | sha256sum -c
          tar xzf libredwg.tar.gz
      - name: Build static
        working-directory: libredwg-0.14
        run: |
          ./configure --disable-shared --enable-static --disable-bindings --disable-python
          make -j"$(nproc)" LDFLAGS="-all-static"
          strip programs/dwg2dxf
          file programs/dwg2dxf
          (ldd programs/dwg2dxf 2>&1 || true) | tee ldd.txt
          grep -q "not a dynamic executable" ldd.txt
          ./programs/dwg2dxf --version
      - name: Smoke test on a real DWG
        run: |
          curl -fsSL https://raw.githubusercontent.com/LibreDWG/libredwg/master/test/test-data/example_2018.dwg -o t.dwg
          ./libredwg-0.14/programs/dwg2dxf -y -o t.dxf t.dwg
          test -s t.dxf && head -c 200 t.dxf
      - uses: actions/upload-artifact@v4
        with:
          name: dwg2dxf
          path: libredwg-0.14/programs/dwg2dxf
```

- [ ] **Step 2: Run it**

```bash
git add .github/workflows/build-dwg2dxf.yml
git commit -m "ci: build a static dwg2dxf for the drawing converter"
git push origin HEAD:refs/heads/ci/build-dwg2dxf
sleep 15 && gh run list --branch ci/build-dwg2dxf --limit 1
gh run watch "$(gh run list --branch ci/build-dwg2dxf --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected: the run succeeds, and the "Build static" log shows `statically linked` and `not a dynamic executable`.

If the build fails, read the log (`gh run view --log-failed`). Change only build flags. For example, if `-all-static` is rejected, try `make LDFLAGS="-static"` or add `--disable-write`. Commit and push again to the same branch. Record every attempt in the report. If three attempts fail, stop and report BLOCKED with the log tail.

- [ ] **Step 3: Download, commit, clean up**

```bash
mkdir -p api/_bin
gh run download "$(gh run list --branch ci/build-dwg2dxf --limit 1 --json databaseId -q '.[0].databaseId')" -n dwg2dxf -D api/_bin
chmod +x api/_bin/dwg2dxf
file api/_bin/dwg2dxf       # expect: ELF 64-bit LSB executable, x86-64, statically linked
ls -la api/_bin/dwg2dxf
git push origin --delete ci/build-dwg2dxf
```

`api/_bin/NOTICE`:

```
dwg2dxf — GNU LibreDWG 0.14, built statically for x86_64 Linux by
.github/workflows/build-dwg2dxf.yml.
Licence: GPL-3.0-or-later. Corresponding source:
  https://ftpmirror.gnu.org/libredwg/libredwg-0.14.tar.gz
  sha256 cb6ee0b078c6d9e0f09d66f1feac33ba6342df88ae544e9f9335fab475218351
Built unmodified with: ./configure --disable-shared --enable-static --disable-bindings
--disable-python && make LDFLAGS="-all-static"  (amend if Task 3 Step 2 changed the flags)
It runs only inside stiko's server-side conversion function (api/convert_drawing.py).
```

If the flags changed in Step 2, update the "Built unmodified with" line to the flags that worked. Do the same for the workflow comment.

- [ ] **Step 4: Bundle it with the function**

Replace `vercel.json` with this. Keep the existing `crons` entry exactly as it is.

```json
{
  "crons": [
    {
      "path": "/api/cron/purge-trash",
      "schedule": "0 4 * * *"
    }
  ],
  "functions": {
    "api/convert_drawing.py": {
      "maxDuration": 60,
      "memory": 1769,
      "includeFiles": "api/{_lib,_bin}/**",
      "excludeFiles": "{node_modules,.next,scripts,docs,public,app,components,lib,design_handoff_brief_section,design_handoff_dashboard_redesign,design_handoff_portal_view,stiko_handoff,logo}/**"
    }
  }
}
```

`git update-index --chmod=+x` makes the executable bit part of the commit. `dwg2dxf_path()` in Task 2 also copies and chmods it at runtime if a bundle drops the bit.

- [ ] **Step 5: Commit**

```bash
git add api/_bin/dwg2dxf api/_bin/NOTICE vercel.json .github/workflows/build-dwg2dxf.yml
git update-index --chmod=+x api/_bin/dwg2dxf
git commit -m "feat(drawings): bundle a static LibreDWG dwg2dxf with the converter function"
```

---

### Task 4: Pure helpers (Node)

**Files:**
- Create: `lib/drawingConversion.ts`
- Modify: `lib/storageKeys.ts` (append `drawingPdfKey`)
- Test: `scripts/tests/drawingConversion.test.mjs` (new)
- Test: `scripts/tests/storageKeys.test.mjs` (append)

**Interfaces:**
- Produces, in `lib/drawingConversion.ts`:
  - `isDrawingFilename(filename: string): boolean` (`.dwg`/`.dxf`, case-insensitive)
  - `type ViewerKind = 'pdf' | 'drawing' | 'other'`
  - `viewerKindFor(filename: string, convertedStorageKey: string | null): ViewerKind`
  - `DRAWING_CLAIM_PREFIX = 'drawing:'` and `DRAWING_CLAIM_STALE_MS = 180_000`
  - `drawingClaimId(now: Date): string`
  - `type ConversionStatus = 'pending' | 'processing' | 'completed' | 'failed' | null`
  - `mayClaim(status: ConversionStatus, jobId: string | null, now: Date): boolean`
  - `type PollStep = 'done' | 'failed' | 'wait'`
  - `DRAWING_POLL_INTERVAL_MS = 2000` and `DRAWING_POLL_LIMIT_MS = 90_000`
  - `nextPollStep(status: ConversionStatus, convertedStorageKey: string | null, elapsedMs: number): PollStep`
- Produces, in `lib/storageKeys.ts`: `drawingPdfKey(originalStorageKey: string): string`

- [ ] **Step 1: Write the failing tests**

`scripts/tests/drawingConversion.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDrawingFilename,
  viewerKindFor,
  drawingClaimId,
  mayClaim,
  nextPollStep,
  DRAWING_CLAIM_STALE_MS,
  DRAWING_POLL_LIMIT_MS,
} from '../../lib/drawingConversion.ts';

test('DWG and DXF are drawings, in any case; nothing else is', () => {
  for (const n of ['a.dwg', 'A.DWG', 'plan.dxf', 'x/y/Plan.DxF']) assert.equal(isDrawingFilename(n), true, n);
  for (const n of ['a.pdf', 'a.dwf', 'dwg', 'a.dwg.zip', '.dwg']) assert.equal(isDrawingFilename(n), false, n);
});

test('a drawing with a PDF is shown as a PDF; without one it is a pending drawing', () => {
  assert.equal(viewerKindFor('plan.dwg', 'uploads/p/x.drawing.pdf'), 'pdf');
  assert.equal(viewerKindFor('plan.dxf', null), 'drawing');
  assert.equal(viewerKindFor('sheet.pdf', null), 'pdf');
  assert.equal(viewerKindFor('model.glb', 'uploads/p/x.optimized.glb'), 'other');
  assert.equal(viewerKindFor('photo.png', null), 'other');
});

test('a claim id records when it was made', () => {
  assert.equal(drawingClaimId(new Date('2026-10-15T12:00:00.000Z')), 'drawing:2026-10-15T12:00:00.000Z');
});

test('only an unclaimed file, or a stale drawing claim, may be claimed', () => {
  const now = new Date('2026-10-15T12:10:00.000Z');
  const fresh = drawingClaimId(new Date(now.getTime() - 60_000));
  const stale = drawingClaimId(new Date(now.getTime() - DRAWING_CLAIM_STALE_MS - 1));
  assert.equal(mayClaim(null, null, now), true);
  assert.equal(mayClaim('processing', fresh, now), false);
  assert.equal(mayClaim('processing', stale, now), true);
  // A 'processing' row with no readable drawing claim (e.g. a legacy CloudConvert job) is
  // treated as stale rather than stuck forever.
  assert.equal(mayClaim('processing', null, now), true);
  assert.equal(mayClaim('processing', 'cloudconvert-job-123', now), true);
  assert.equal(mayClaim('completed', fresh, now), false);
  assert.equal(mayClaim('failed', stale, now), false);
  assert.equal(mayClaim('pending', null, now), false);
});

test('polling stops on a finished PDF, on failure, or at the time limit', () => {
  assert.equal(nextPollStep('completed', 'k.drawing.pdf', 1000), 'done');
  assert.equal(nextPollStep('failed', null, 1000), 'failed');
  assert.equal(nextPollStep('processing', null, 1000), 'wait');
  assert.equal(nextPollStep(null, null, 1000), 'wait');
  assert.equal(nextPollStep('processing', null, DRAWING_POLL_LIMIT_MS), 'failed');
  // 'completed' without a key is not a usable PDF.
  assert.equal(nextPollStep('completed', null, 1000), 'wait');
});
```

Append to `scripts/tests/storageKeys.test.mjs`, and add `drawingPdfKey` to its import list:

```js
test('a drawing PDF sits beside its original with a .drawing.pdf suffix', () => {
  assert.equal(drawingPdfKey('uploads/p/po/v/abc-123.dwg'), 'uploads/p/po/v/abc-123.drawing.pdf');
  assert.equal(drawingPdfKey('uploads/p/po/v/abc-123.DXF'), 'uploads/p/po/v/abc-123.drawing.pdf');
  assert.equal(drawingPdfKey('uploads/p.1/po/v/abc-123'), 'uploads/p.1/po/v/abc-123.drawing.pdf');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test scripts/tests/drawingConversion.test.mjs scripts/tests/storageKeys.test.mjs`
Expected: FAIL. The module is not found, and `drawingPdfKey` is not exported.

- [ ] **Step 3: Implement**

`lib/drawingConversion.ts`:

```ts
import { extensionOf } from './fileFormats.ts';

/**
 * DWG and DXF are shown as PDFs: a server-side function converts each drawing once, and the
 * PDF becomes the file's converted_storage_key. These helpers are the rules around that, kept
 * pure so they can be tested and shared by the route, the viewer and the portal page.
 */

const DRAWING_EXTENSIONS: ReadonlySet<string> = new Set(['dwg', 'dxf']);

export function isDrawingFilename(filename: string): boolean {
  return DRAWING_EXTENSIONS.has(extensionOf(filename));
}

export type ViewerKind = 'pdf' | 'drawing' | 'other';

/**
 * 'pdf' for a real PDF and for a drawing whose PDF exists; 'drawing' for a drawing still
 * waiting for one; 'other' for everything else. Decided by the ORIGINAL filename.
 */
export function viewerKindFor(filename: string, convertedStorageKey: string | null): ViewerKind {
  if (extensionOf(filename) === 'pdf') return 'pdf';
  if (isDrawingFilename(filename)) return convertedStorageKey ? 'pdf' : 'drawing';
  return 'other';
}

/**
 * files.conversion_job_id holds the claim while a drawing converts. The column predates this
 * feature (CloudConvert never set it); a drawing claim is 'drawing:<ISO time>'.
 */
export const DRAWING_CLAIM_PREFIX = 'drawing:';

/** A conversion runs at most ~60 s; a claim this old belongs to a run that died. */
export const DRAWING_CLAIM_STALE_MS = 180_000;

export function drawingClaimId(now: Date): string {
  return `${DRAWING_CLAIM_PREFIX}${now.toISOString()}`;
}

export type ConversionStatus = 'pending' | 'processing' | 'completed' | 'failed' | null;

/**
 * Whether a new conversion may start. Never for a finished or failed file: 'failed' is not
 * retried automatically (a new upload gets a new file id). A 'processing' row may be reclaimed
 * once its claim is stale, or when it carries no readable drawing claim at all.
 */
export function mayClaim(status: ConversionStatus, jobId: string | null, now: Date): boolean {
  if (status === null) return true;
  if (status !== 'processing') return false;
  if (!jobId || !jobId.startsWith(DRAWING_CLAIM_PREFIX)) return true;
  const claimedAt = Date.parse(jobId.slice(DRAWING_CLAIM_PREFIX.length));
  if (Number.isNaN(claimedAt)) return true;
  return now.getTime() - claimedAt > DRAWING_CLAIM_STALE_MS;
}

export const DRAWING_POLL_INTERVAL_MS = 2000;
export const DRAWING_POLL_LIMIT_MS = 90_000;

export type PollStep = 'done' | 'failed' | 'wait';

/** What the viewer does after one status check while a drawing converts. */
export function nextPollStep(
  status: ConversionStatus,
  convertedStorageKey: string | null,
  elapsedMs: number
): PollStep {
  if (status === 'completed' && convertedStorageKey) return 'done';
  if (status === 'failed') return 'failed';
  if (elapsedMs >= DRAWING_POLL_LIMIT_MS) return 'failed';
  return 'wait';
}
```

Append to `lib/storageKeys.ts`:

```ts
const DRAWING_PDF_SUFFIX = '.drawing.pdf';

/**
 * Where a DWG/DXF's converted PDF lives: beside the original, same stem. Always derived from
 * the original's key on the server, never accepted from a caller (see the variant-key note
 * at the top of this file).
 */
export function drawingPdfKey(originalStorageKey: string): string {
  const slash = originalStorageKey.lastIndexOf('/');
  const directory = originalStorageKey.slice(0, slash + 1);
  const base = originalStorageKey.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${directory}${stem}${DRAWING_PDF_SUFFIX}`;
}
```

- [ ] **Step 4: Run to see them pass**

Run: `node --test scripts/tests/drawingConversion.test.mjs scripts/tests/storageKeys.test.mjs && npx tsc --noEmit`
Expected: all PASS; tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/drawingConversion.ts lib/storageKeys.ts scripts/tests/drawingConversion.test.mjs scripts/tests/storageKeys.test.mjs
git commit -m "feat(drawings): claim, polling and viewer-kind rules for drawing conversion"
```

---

### Task 5: Routes: claim and convert, secure the status check, open the function path

**Files:**
- Create: `app/api/files/[id]/convert-drawing/route.ts`
- Modify: `app/api/files/[id]/conversion-status/route.ts`
- Modify: `lib/routeAccess.ts` (`PUBLIC_PATHS`)
- Modify: `lib/schema.sql` (comment beside `conversion_job_id`)
- Test: `scripts/tests/routeAccess.test.mjs` (append)

**Interfaces:**
- Consumes:
  - `isDrawingFilename`, `drawingClaimId`, `mayClaim`, `ConversionStatus` (Task 4)
  - `drawingPdfKey` (Task 4)
  - `getFileAccess` (`lib/access.ts`)
  - `getViewerPresignedUrl` and `getUploadPresignedUrl(key, contentType, expiresIn)` (`lib/s3.ts`)
  - the Python endpoint (Task 2)
- Produces:
  - `POST /api/files/[id]/convert-drawing`: `200 { conversionStatus, convertedStorageKey }` | `400` | `401` | `404`
  - `GET /api/files/[id]/conversion-status`: same shape, now access-checked

- [ ] **Step 1: Write the failing routeAccess test**

Append to `scripts/tests/routeAccess.test.mjs`:

```js
test('the drawing converter function is reachable without a session; it checks a secret itself', () => {
  assert.equal(routeDecision('/api/convert_drawing', false), 'pass');
});
```

Run: `node --test scripts/tests/routeAccess.test.mjs`
Expected: FAIL. It returns `'login'`.

- [ ] **Step 2: Open the path**

In `lib/routeAccess.ts`, add this entry to `PUBLIC_PATHS`, directly after `'/api/conversions/webhook',`:

```ts
  // The Vercel Python function that converts DWG/DXF to PDF (api/convert_drawing.py). Only
  // stiko's own server calls it, server-to-server, with no session cookie, so the middleware
  // must let it through. It authenticates every request itself against CAD_CONVERTER_SECRET
  // and refuses everything when that is unset. It reads and writes only the two presigned URLs
  // it is handed.
  '/api/convert_drawing',
```

Run: `node --test scripts/tests/routeAccess.test.mjs`
Expected: PASS.

- [ ] **Step 3: Secure the status route**

Replace `app/api/files/[id]/conversion-status/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';

// /api/files is a public middleware prefix, so this route checks the session and the
// caller's access to the file itself. It used to answer anyone who knew a file id.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await sql`
    SELECT conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey"
    FROM files WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
```

- [ ] **Step 4: The convert route**

Create `app/api/files/[id]/convert-drawing/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { getUploadPresignedUrl, getViewerPresignedUrl } from '@/lib/s3';
import { drawingPdfKey } from '@/lib/storageKeys';
import {
  drawingClaimId,
  isDrawingFilename,
  mayClaim,
  type ConversionStatus,
} from '@/lib/drawingConversion';

// Waits for the Python converter, which has its own 60 s budget.
export const maxDuration = 60;
const CONVERTER_TIMEOUT_MS = 55_000;
/** Long enough for the converter's download, conversion and upload together. */
const TARGET_URL_TTL_S = 300;

type Row = {
  filename: string;
  storageKey: string;
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
};

/**
 * Convert one DWG/DXF to PDF, at most once at a time per file.
 *
 * Called fire-and-forget by the uploader right after an upload, and by the viewer when it
 * opens a drawing that has no PDF yet. /api/files is a public middleware prefix, so this
 * checks the session and the caller's access to the file itself.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = (await sql`
    SELECT filename, storage_key AS "storageKey", conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey", conversion_job_id AS "conversionJobId"
    FROM files WHERE id = ${params.id}
  `) as Row[];
  const file = rows[0];
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!isDrawingFilename(file.filename)) {
    return NextResponse.json({ error: 'Not a DWG or DXF file' }, { status: 400 });
  }

  const current = () =>
    NextResponse.json({
      conversionStatus: file.conversionStatus,
      convertedStorageKey: file.convertedStorageKey,
    });
  if (file.convertedStorageKey) return current();

  const now = new Date();
  if (!mayClaim(file.conversionStatus, file.conversionJobId, now)) return current();

  // Compare-and-set on the values just read: if another request claimed first, no row
  // updates and this one stands down instead of starting a second conversion.
  const claimId = drawingClaimId(now);
  const claimed = await sql`
    UPDATE files
    SET conversion_status = 'processing', conversion_job_id = ${claimId}
    WHERE id = ${params.id}
      AND converted_storage_key IS NULL
      AND conversion_status IS NOT DISTINCT FROM ${file.conversionStatus}
      AND conversion_job_id IS NOT DISTINCT FROM ${file.conversionJobId}
    RETURNING id
  `;
  if (claimed.length === 0) {
    return NextResponse.json({ conversionStatus: 'processing', convertedStorageKey: null });
  }

  const targetKey = drawingPdfKey(file.storageKey);
  let failure: string | null = null;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Converter-Secret': process.env.CAD_CONVERTER_SECRET ?? '',
    };
    // Vercel deployment protection blocks a server-to-server call to a protected preview URL
    // unless this bypass secret is sent; it is set automatically when the feature is enabled.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    const res = await fetch(new URL('/api/convert_drawing', request.url), {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(CONVERTER_TIMEOUT_MS),
      body: JSON.stringify({
        sourceUrl: await getViewerPresignedUrl(file.storageKey),
        targetUrl: await getUploadPresignedUrl(targetKey, 'application/pdf', TARGET_URL_TTL_S),
        filename: file.filename,
      }),
    });
    if (!res.ok) failure = `converter answered ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  if (failure) {
    console.error(`Drawing conversion failed for file ${params.id}: ${failure}`);
    await sql`
      UPDATE files SET conversion_status = 'failed'
      WHERE id = ${params.id} AND conversion_job_id = ${claimId}
    `;
    return NextResponse.json({ conversionStatus: 'failed', convertedStorageKey: null });
  }

  await sql`
    UPDATE files SET conversion_status = 'completed', converted_storage_key = ${targetKey}
    WHERE id = ${params.id} AND conversion_job_id = ${claimId}
  `;

  // Every place that assigns converted_storage_key must clear this file's calibrations (see
  // lib/schema.sql, file_calibrations). Its own statement, tolerant of its own failure, for
  // the reason given beside the same DELETE in app/api/conversions/webhook/route.ts.
  try {
    await sql`DELETE FROM file_calibrations WHERE file_id = ${params.id}`;
  } catch (calibrationErr) {
    console.error(
      `Failed to delete stale file_calibrations for file ${params.id} after drawing conversion:`,
      calibrationErr instanceof Error ? calibrationErr.message : String(calibrationErr)
    );
  }

  return NextResponse.json({ conversionStatus: 'completed', convertedStorageKey: targetKey });
}
```

- [ ] **Step 5: Document the column's new meaning**

In `lib/schema.sql`, directly above the line `  conversion_job_id TEXT DEFAULT NULL,`, add:

```sql
  -- conversion_job_id: for a DWG/DXF, the claim of a running drawing->PDF conversion,
  -- 'drawing:<ISO time>' (lib/drawingConversion.ts). CloudConvert never set it.
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add "app/api/files/[id]/convert-drawing/route.ts" "app/api/files/[id]/conversion-status/route.ts" lib/routeAccess.ts lib/schema.sql scripts/tests/routeAccess.test.mjs
git commit -m "feat(drawings): claim-and-convert route; access-check the conversion status"
```

---

### Task 6: Viewer, portal and upload trigger

**Files:**
- Create: `components/viewers/DrawingPreparer.tsx`
- Modify: `components/viewers/ViewerContainer.tsx`
- Modify: `app/portal/[id]/page.tsx` (`isPDFFile` and the `<ViewerContainer>` props)
- Modify: `lib/useUpload.ts` (after `/api/files/complete` succeeds)

**Interfaces:**
- Consumes:
  - `viewerKindFor`, `isDrawingFilename`, `nextPollStep`, `DRAWING_POLL_INTERVAL_MS`, `ConversionStatus` (Task 4)
  - the routes from Task 5
- Produces:
  - `ViewerContainer` prop `onDrawingConverted?: (fileId: string, convertedStorageKey: string) => void`
  - component `DrawingPreparer({ fileId, onConverted, onReady })`

- [ ] **Step 1: `components/viewers/DrawingPreparer.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  DRAWING_POLL_INTERVAL_MS,
  nextPollStep,
  type ConversionStatus,
} from '@/lib/drawingConversion';

interface Props {
  fileId: string;
  /** Called once with the PDF's key; the parent swaps the file over to the PDF viewer. */
  onConverted: (convertedStorageKey: string) => void;
  /** Must be called when this ends in failure, to release the page's loading indicator. */
  onReady?: () => void;
}

interface StatusBody {
  conversionStatus: ConversionStatus;
  convertedStorageKey: string | null;
}

/**
 * Shown for a DWG/DXF that has no PDF yet. Asks the server to convert it (a no-op if a
 * conversion is already running) and polls until the PDF exists, the conversion fails, or
 * DRAWING_POLL_LIMIT_MS passes.
 */
export default function DrawingPreparer({ fileId, onConverted, onReady }: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const settle = (body: StatusBody | null): boolean => {
      const step = nextPollStep(
        body?.conversionStatus ?? null,
        body?.convertedStorageKey ?? null,
        Date.now() - started
      );
      if (step === 'done' && body?.convertedStorageKey) {
        onConverted(body.convertedStorageKey);
        return true;
      }
      if (step === 'failed') {
        setFailed(true);
        onReady?.();
        return true;
      }
      return false;
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/files/${fileId}/conversion-status`);
        if (!cancelled && settle(res.ok ? ((await res.json()) as StatusBody) : null)) return;
      } catch {
        if (!cancelled && settle(null)) return;
      }
      if (!cancelled) timer = setTimeout(poll, DRAWING_POLL_INTERVAL_MS);
    };

    // The POST may take the whole conversion (up to a minute) to answer, so polling starts
    // alongside it rather than after it. Its own answer is used too, when it arrives first.
    fetch(`/api/files/${fileId}/convert-drawing`, { method: 'POST' })
      .then((res) => (res.ok ? (res.json() as Promise<StatusBody>) : null))
      .then((body) => {
        if (!cancelled && body && settle(body)) {
          cancelled = true;
          if (timer) clearTimeout(timer);
        }
      })
      .catch(() => {});
    timer = setTimeout(poll, DRAWING_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onConverted/onReady are callbacks from the parent; restarting on their identity would
    // re-trigger the conversion on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        {failed ? (
          <>
            <p className="text-sm font-medium text-gray-700">
              This drawing couldn&apos;t be converted for viewing.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Download the original to open it in your CAD software.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">Preparing drawing…</p>
        )}
      </div>
    </div>
  );
}
```

`settle` returns true once the outcome is final. A `cancelled` flag set by the POST's own answer stops the poll loop too, so `onConverted` fires at most once per mount.

- [ ] **Step 2: `ViewerContainer.tsx`**

1. Imports. Add `const DrawingPreparer = dynamic(() => import('./DrawingPreparer'), { ssr: false });` next to the existing `PDFKonvaViewer` dynamic import, and `import { viewerKindFor } from '@/lib/drawingConversion';` with the other `@/lib` imports.
2. Prop. Add to `ViewerContainerProps`, after `onPageChange?`:
   ```tsx
   /** DWG/DXF only: the drawing's PDF now exists; the parent records it on the file. */
   onDrawingConverted?: (fileId: string, convertedStorageKey: string) => void;
   ```
   Add `onDrawingConverted` to the destructured props list.
3. Kind. Directly after `const viewerKey = file.convertedStorageKey ?? file.storageKey;` add:
   ```tsx
   // A DWG/DXF is shown through its converted PDF; until that exists it is 'drawing'.
   const kind = viewerKindFor(file.filename, file.convertedStorageKey);
   ```
4. URL fetch. In the "Fetch presigned URL" effect, add `if (kind === 'drawing') return;` after `setError(false);` (a pending drawing has nothing to fetch). Change its deps to `[viewerKey, kind]`.
5. Viewable. Change the `isViewable` expression's PDF term from `PDF_EXTENSIONS.includes(ext)` to `kind !== 'other'`. The order is unchanged; `kind !== 'other'` covers PDFs and both drawing states.
6. Pending drawing. Directly before the `if (error) {` block, insert:
   ```tsx
   if (kind === 'drawing') {
     return (
       <DrawingPreparer
         key={file.id}
         fileId={file.id}
         onConverted={(convertedKey) => onDrawingConverted?.(file.id, convertedKey)}
         onReady={onReady}
       />
     );
   }
   ```
7. PDF branch. Change `if (PDF_EXTENSIONS.includes(ext)) {` to `if (kind === 'pdf') {`. Leave `PDF_EXTENSIONS` in place only if something else still uses it; otherwise delete the constant (lint will say).

- [ ] **Step 3: Portal page (`app/portal/[id]/page.tsx`)**

1. Add `import { viewerKindFor } from '@/lib/drawingConversion';` beside the existing `@/lib/fileFormats` import.
2. Replace the `isPDFFile` memo body with:
   ```tsx
   const isPDFFile = useMemo(() => {
     if (!selectedFile) return false;
     // A DWG/DXF with a converted PDF is shown, marked up and measured exactly as a PDF.
     return viewerKindFor(selectedFile.filename, selectedFile.convertedStorageKey) === 'pdf';
   }, [selectedFile]);
   ```
3. Add a handler near the other `setFiles` updaters (e.g. above the `<ViewerContainer` JSX's enclosing return):
   ```tsx
   const handleDrawingConverted = useCallback((fileId: string, convertedStorageKey: string) => {
     setFiles((prev) =>
       prev.map((f) =>
         f.id === fileId ? { ...f, convertedStorageKey, conversionStatus: 'completed' } : f
       )
     );
   }, []);
   ```
4. Pass `onDrawingConverted={handleDrawingConverted}` to `<ViewerContainer`.

- [ ] **Step 4: Trigger after upload (`lib/useUpload.ts`)**

Add `import { isDrawingFilename } from '@/lib/drawingConversion';` with the other imports. Directly after `if (!completeRes.ok) throw new Error('Could not register the file');`, insert:

```ts
        // DWG/DXF: start the PDF conversion now so it is usually ready before anyone opens
        // the file. Nothing waits on it; the viewer triggers it again if this is lost.
        if (isDrawingFilename(entry.file.name)) {
          fetch(`/api/files/${fileId}/convert-drawing`, { method: 'POST', keepalive: true }).catch(
            () => {}
          );
        }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add components/viewers/DrawingPreparer.tsx components/viewers/ViewerContainer.tsx "app/portal/[id]/page.tsx" lib/useUpload.ts
git commit -m "feat(drawings): show DWG/DXF through their PDF; convert on upload and on first view"
```

---

### Task 7: Local verification

**Files:** none changed unless a defect is found. A defect gets its own failing test where possible and its own commit.

- [ ] **Step 1: Every check**

```bash
npx tsc --noEmit && npm test && npm run lint
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev R2_ENDPOINT_URL='https://example.invalid' \
R2_BUCKET_NAME=dev npx next build
DWG2DXF=$(which dwg2dxf) "$SCRATCH"/bin/python -m pytest -q -p no:cacheprovider -c scripts/pytests/pytest.ini scripts/pytests
```

Expected: all clean, `14 passed`, and the build exits 0.

- [ ] **Step 2: Viewer states in the browser (no writes)**

Follow `stiko-local-visual-verification`. Local dev uses the PRODUCTION database and R2, so do not upload. Use a throwaway harness route `app/portal/drawing-harness/page.tsx` that renders `ViewerContainer` with a synthetic `file` whose `filename` is `plan.dwg`. Stub `fetch` in the `navigate_page` initScript:
- `POST …/convert-drawing` → `{conversionStatus:'processing',convertedStorageKey:null}`
- `GET …/conversion-status`: answer the first two polls with `'processing'`, then `{conversionStatus:'completed',convertedStorageKey:'k.drawing.pdf'}`
- `/api/files/url` → `{url:'/uploads/drawing-harness/plan.pdf'}`

Serve a PDF made by `api/_lib/drawing_pdf.py` from an Autodesk sample at `public/uploads/drawing-harness/plan.pdf`. The harness keeps `file` in state and applies `onDrawingConverted`.

Confirm:
1. "Preparing drawing…" shows.
2. After the third poll, the PDF viewer shows the drawing.
3. With a stub that answers `'failed'`, the failure message shows and the indicator releases.

Delete the harness, `public/uploads/drawing-harness` and stale `.next/types` afterwards. Confirm `git status` is clean apart from the pre-existing untracked directories.

---

### Task 8: Preview deployment (needs the user)

- [ ] **Step 1: Ask the user to set two things in Vercel** (Project → Settings → Environment Variables):
  1. `CAD_CONVERTER_SECRET`, for **Preview** and **Production**: a long random value. To generate one in Terminal: `openssl rand -hex 32`.
  2. If Deployment Protection is on for previews: enable "Protection Bypass for Automation". Vercel then provides `VERCEL_AUTOMATION_BYPASS_SECRET` to deployments automatically.
- [ ] **Step 2: Push the branch** (`git push -u origin feature/dwg-dxf-as-pdf`). Vercel builds a preview. Confirm in the build log that `api/convert_drawing.py` was built as a Python function and that its bundle is under the size limit.
- [ ] **Step 3: On the preview URL, in a throwaway package:**
  1. Upload one Autodesk sample DWG and one DXF.
  2. Open each and confirm it shows as a PDF.
  3. Open a DWG uploaded before today and confirm it converts on first view.
  4. Delete the throwaway package. Previews share the production database and R2.

## Release (for the user, after review)

1. Confirm `CAD_CONVERTER_SECRET` is set for Production.
2. Merge and push: `git checkout main && git merge --no-ff feature/dwg-dxf-as-pdf && git push`.
3. On production, open an existing DWG to confirm on-view conversion.

**Rollback:** `git revert -m 1 <merge commit> && git push`. Converted `.drawing.pdf` objects can stay; nothing else reads them.
