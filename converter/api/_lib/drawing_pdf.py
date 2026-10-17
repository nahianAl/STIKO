# SPDX-License-Identifier: AGPL-3.0-or-later
"""DWG/DXF -> PDF for Stiko's viewer. Pure: bytes or paths in, PDF bytes out; no network.

One PDF page per paper-space layout that has content, in tab order, at the layout's plot
paper size; model space only when no layout has content. Black lines on white, like a
plotted sheet.

Also a CLI, which is how the HTTP handler (../convert_drawing.py) uses it, in a child process
with a bare environment and resource limits, so parsing an untrusted drawing never happens in
the process that holds the converter secret:

    python drawing_pdf.py <source.dwg|.dxf> <out.pdf> <dwg2dxf>

Exit 0: the PDF was written and its page count printed to stdout. Exit 2: the drawing is
unreadable or empty (a verdict); the reason is on stderr. Any other exit: a server fault.
"""
from __future__ import annotations

import os
import subprocess
import sys
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
    """Convert a DWG file to DXF with LibreDWG's dwg2dxf. Returns the DXF path.

    Raises DrawingError on a timeout, when dwg2dxf is killed by a signal (a crash, or a resource
    limit), or when no DXF comes out. A missing or unrunnable binary raises OSError instead, left
    uncaught on purpose: that is a server fault, not a bad drawing. dwg2dxf needs no environment
    beyond a PATH, so it gets nothing else.
    """
    dxf_path = os.path.join(out_dir, 'drawing.dxf')
    try:
        result = subprocess.run(
            [dwg2dxf, '-y', '-o', dxf_path, dwg_path],
            capture_output=True, text=True, errors='replace', timeout=DWG2DXF_TIMEOUT_S,
            env={'PATH': '/usr/bin:/bin'},
        )
    except subprocess.TimeoutExpired as err:
        raise DrawingError(f'dwg2dxf timed out after {DWG2DXF_TIMEOUT_S}s') from err
    # A crash can leave a truncated DXF behind, so a signal is never success.
    if result.returncode < 0:
        raise DrawingError(f'dwg2dxf killed by signal {-result.returncode}: {result.stderr[-300:]}')
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
    """Paper-space layouts with content, in tab order; else model space alone.

    Iterating doc.layouts is dictionary (creation) order, not the order of the tabs in CAD,
    so the names come from names_in_taborder().
    """
    in_tab_order = (doc.layouts.get(name) for name in doc.layouts.names_in_taborder())
    sheets = [lay for lay in in_tab_order if not lay.is_modelspace and has_content(lay)]
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

    Sheets that draw nothing, or that raise while rendering, are skipped so one bad sheet
    cannot sink the rest. If no sheet renders, model space is tried. Raises DrawingError when
    nothing renders at all, naming the last error if a sheet failed.
    """
    errors: list[str] = []

    def render_or_skip(lay: Layout) -> bytes | None:
        try:
            return render_layout(doc, lay)
        except Exception as err:  # ezdxf and PyMuPDF raise many unrelated types on odd sheets
            errors.append(f'{lay.name}: {type(err).__name__}: {err}')
            print(f'skipped sheet {lay.name}: {type(err).__name__}: {str(err)[:200]}', file=sys.stderr)
            return None

    sheets = layouts_to_render(doc)
    rendered = [data for lay in sheets if (data := render_or_skip(lay))]
    if not rendered and not sheets[0].is_modelspace:
        model = render_or_skip(doc.modelspace())
        rendered = [model] if model else []
    if not rendered:
        raise DrawingError(f'could not render the drawing; last error: {errors[-1]}' if errors
                           else 'the drawing has nothing to show')
    try:
        merged = pymupdf.open()
        for data in rendered:
            with pymupdf.open(stream=data, filetype='pdf') as single:
                merged.insert_pdf(single)
        out = merged.tobytes(garbage=3, deflate=True)
        merged.close()
    except Exception as err:
        raise DrawingError(f'could not assemble the PDF: {err}') from err
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


def main(argv: list[str]) -> int:
    """The CLI described in the module docstring. Returns the exit status."""
    if len(argv) != 4:
        print('usage: drawing_pdf.py <source.dwg|.dxf> <out.pdf> <dwg2dxf>', file=sys.stderr)
        return 64
    source, out, dwg2dxf = argv[1:]
    try:
        pdf, pages = convert(source, dwg2dxf)
    except DrawingError as err:
        print(str(err)[:1000], file=sys.stderr)
        return 2
    except MemoryError:
        # Hit RLIMIT_AS: this drawing needs more memory than a conversion may have, and will
        # next time too. A verdict, like a timeout.
        print('out of memory while converting', file=sys.stderr)
        return 2
    with open(out, 'wb') as f:
        f.write(pdf)
    print(pages)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
