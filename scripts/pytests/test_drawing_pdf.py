# SPDX-License-Identifier: AGPL-3.0-or-later
"""Converter core tests. How to run: scripts/pytests/README.md."""
import json
import os
import resource
import shutil
import subprocess
import sys

import ezdxf
import pymupdf
import pytest

import drawing_pdf
from drawing_pdf import DrawingError, convert, layouts_to_render, page_size_mm

HERE = os.path.dirname(__file__)
DWG2DXF = os.environ.get('DWG2DXF') or shutil.which('dwg2dxf') or os.path.join(HERE, '..', '..', 'converter', 'api', '_bin', 'dwg2dxf')
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
    # A4 portrait, deliberately not the A3-landscape default, so a regression to the default fails.
    doc = ezdxf.new(setup=True)
    sheet = doc.layouts.new('A4 portrait')
    sheet.page_setup(size=(210, 297), margins=(10, 10, 10, 10), units='mm')
    sheet.add_line((20, 20), (190, 277))
    doc.saveas(tmp_path / 'a4.dxf')
    reread = ezdxf.readfile(tmp_path / 'a4.dxf')
    width, height = page_size_mm(reread.layouts.get('A4 portrait'))
    assert (round(width), round(height)) == (210, 297)
    pdf, _ = convert(str(tmp_path / 'a4.dxf'), DWG2DXF)
    rect = pymupdf.open(stream=pdf, filetype='pdf')[0].rect
    assert (round(rect.width / 72 * 25.4), round(rect.height / 72 * 25.4)) == (210, 297)


def test_a_rotated_plot_swaps_the_page_dimensions(tmp_path):
    # 297 x 210 paper plotted rotated 90 degrees is a 210 x 297 page.
    doc = ezdxf.new(setup=True)
    sheet = doc.layouts.new('Rotated')
    sheet.page_setup(size=(297, 210), margins=(10, 10, 10, 10), units='mm')
    sheet.dxf_layout.dxf.plot_rotation = 1
    sheet.add_line((20, 20), (190, 277))
    doc.saveas(tmp_path / 'rotated.dxf')
    reread = ezdxf.readfile(tmp_path / 'rotated.dxf')
    width, height = page_size_mm(reread.layouts.get('Rotated'))
    assert (round(width), round(height)) == (210, 297)
    pdf, _ = convert(str(tmp_path / 'rotated.dxf'), DWG2DXF)
    rect = pymupdf.open(stream=pdf, filetype='pdf')[0].rect
    assert (round(rect.width / 72 * 25.4), round(rect.height / 72 * 25.4)) == (210, 297)


def test_sheets_come_back_in_tab_order_not_creation_order(tmp_path):
    doc = ezdxf.new(setup=True)
    for name in ('A', 'B'):  # created A then B ...
        sheet = doc.layouts.new(name)
        sheet.page_setup(size=(420, 297), margins=(10, 10, 10, 10), units='mm')
        sheet.add_line((20, 20), (400, 20))
    doc.layouts.get('A').dxf_layout.dxf.taborder = 5
    doc.layouts.get('B').dxf_layout.dxf.taborder = 1  # ... but B's tab is to the left of A's
    doc.saveas(tmp_path / 'taborder.dxf')
    reread = ezdxf.readfile(tmp_path / 'taborder.dxf')
    assert [lay.name for lay in layouts_to_render(reread)] == ['B', 'A']


def test_lines_are_black_on_white(tmp_path):
    pdf, _ = convert(two_sheet_dxf(str(tmp_path / 'sheets.dxf')), DWG2DXF)
    pix = pymupdf.open(stream=pdf, filetype='pdf')[0].get_pixmap(dpi=150)
    samples = pix.samples
    pixels = [tuple(samples[i:i + 3]) for i in range(0, len(samples), pix.n)]
    assert min(pixels[0]) >= 250, 'the page background (top-left pixel) should be white'
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
    pdf, pages = convert(str(tmp_path / 'emptyview.dxf'), DWG2DXF)
    assert pages == 1
    assert pymupdf.open(stream=pdf, filetype='pdf')[0].get_drawings(), 'the page should hold the model-space line'


def test_an_empty_drawing_is_a_drawing_error(tmp_path):
    ezdxf.new().saveas(tmp_path / 'empty.dxf')
    with pytest.raises(DrawingError):
        convert(str(tmp_path / 'empty.dxf'), DWG2DXF)


def test_a_garbage_dxf_is_a_drawing_error(tmp_path):
    bad = tmp_path / 'bad.dxf'
    bad.write_bytes(b'not a dxf')
    with pytest.raises(DrawingError):
        convert(str(bad), DWG2DXF)


def test_a_sheet_that_fails_to_render_is_skipped(tmp_path, monkeypatch):
    path = two_sheet_dxf(str(tmp_path / 'sheets.dxf'))
    real = drawing_pdf.render_layout

    def fail_first_sheet(doc, lay):
        if lay.name == 'A-101':
            raise RuntimeError('boom')
        return real(doc, lay)

    monkeypatch.setattr(drawing_pdf, 'render_layout', fail_first_sheet)
    pdf, pages = convert(path, DWG2DXF)
    assert pages == 1
    assert pymupdf.open(stream=pdf, filetype='pdf').page_count == 1


def test_a_skipped_sheet_is_logged_to_stderr(tmp_path, monkeypatch, capsys):
    path = two_sheet_dxf(str(tmp_path / 'sheets.dxf'))
    real = drawing_pdf.render_layout

    def fail_first_sheet(doc, lay):
        if lay.name == 'A-101':
            raise RuntimeError('boom')
        return real(doc, lay)

    monkeypatch.setattr(drawing_pdf, 'render_layout', fail_first_sheet)
    convert(path, DWG2DXF)
    err = capsys.readouterr().err
    assert 'skipped sheet A-101: RuntimeError: boom' in err
    assert 'A-102' not in err


def test_every_sheet_failing_is_a_drawing_error(tmp_path, monkeypatch):
    path = two_sheet_dxf(str(tmp_path / 'sheets.dxf'))

    def always_fail(doc, lay):
        raise RuntimeError('boom')

    monkeypatch.setattr(drawing_pdf, 'render_layout', always_fail)
    with pytest.raises(DrawingError, match='boom'):
        convert(path, DWG2DXF)


# --- dwg2dxf runs with a bare environment, and a signal is never success. ---


def test_dwg2dxf_gets_only_a_path_in_its_environment(tmp_path, monkeypatch):
    seen = {}
    real_run = subprocess.run

    def spy(args, **kwargs):
        seen.update(kwargs)
        return real_run(args, **kwargs)

    monkeypatch.setenv('CAD_CONVERTER_SECRET', 'sekret')
    monkeypatch.setattr(drawing_pdf.subprocess, 'run', spy)
    drawing_pdf.dwg_to_dxf(DWG_FIXTURE, str(tmp_path), DWG2DXF)
    assert seen['env'] == {'PATH': '/usr/bin:/bin'}


def test_dwg2dxf_killed_by_a_signal_is_a_drawing_error_even_if_a_dxf_was_written(tmp_path):
    # A crash part-way through can leave a truncated DXF behind: the exit status decides.
    good_dxf = two_sheet_dxf(str(tmp_path / 'good.dxf'))
    fake = tmp_path / 'dwg2dxf'
    fake.write_text(f'#!/bin/sh\ncp "{good_dxf}" "$3"\nkill -9 $$\n')  # args: -y -o <dxf> <dwg>
    fake.chmod(0o755)
    out = tmp_path / 'out'
    out.mkdir()
    with pytest.raises(DrawingError, match='signal'):
        drawing_pdf.dwg_to_dxf(DWG_FIXTURE, str(out), str(fake))
    assert (out / 'drawing.dxf').exists()  # the DXF was there; it was still refused


# --- The CLI the HTTP handler runs in a child process. ---

SCRIPT = drawing_pdf.__file__


def run_cli(*args):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, timeout=120)


def test_the_cli_writes_the_pdf_and_prints_the_page_count(tmp_path):
    source = two_sheet_dxf(str(tmp_path / 'sheets.dxf'))
    out = tmp_path / 'out.pdf'
    result = run_cli(source, str(out), DWG2DXF)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == '2'
    assert pymupdf.open(str(out)).page_count == 2


def test_the_cli_exits_2_with_the_message_on_a_bad_drawing(tmp_path):
    bad = tmp_path / 'bad.dxf'
    bad.write_bytes(b'not a dxf')
    out = tmp_path / 'out.pdf'
    result = run_cli(str(bad), str(out), DWG2DXF)
    assert result.returncode == 2
    assert 'not a readable DXF' in result.stderr
    assert result.stdout == '' and not out.exists()


def test_the_cli_exits_neither_0_nor_2_on_a_server_fault(tmp_path):
    out = tmp_path / 'out.pdf'
    result = run_cli(DWG_FIXTURE, str(out), str(tmp_path / 'no-such-dwg2dxf'))
    assert result.returncode not in (0, 2)
    assert 'FileNotFoundError' in result.stderr


def test_the_cli_refuses_the_wrong_number_of_arguments():
    result = run_cli('only-one')
    assert result.returncode not in (0, 2)


# --- The child limits itself, before it imports anything heavy. ---

#: Runs drawing_pdf.py as __main__ (wrong argument count, so it exits 64 right after the limits are
#: set) with resource.setrlimit spied on, and reports each call and what was already imported.
LIMITS_PROBE = """
import json, resource, runpy, sys
calls = []
real = resource.setrlimit

def spy(which, limits):
    calls.append({'which': which, 'limits': list(limits),
                  'ezdxf_imported': 'ezdxf' in sys.modules, 'pymupdf_imported': 'pymupdf' in sys.modules,
                  'numpy_imported': 'numpy' in sys.modules})
    real(which, limits)

resource.setrlimit = spy
script = sys.argv[1]
sys.argv = ['drawing_pdf.py']
try:
    runpy.run_path(script, run_name='__main__')
except SystemExit as exit:
    code = exit.code
print(json.dumps({'calls': calls, 'exit': code, 'cpu': list(resource.getrlimit(resource.RLIMIT_CPU)),
                  'as': list(resource.getrlimit(resource.RLIMIT_AS))}))
"""


def run_limits_probe(extra_env):
    env = {k: v for k, v in os.environ.items() if not k.startswith('CONVERTER_RLIMIT_')}
    env.update(extra_env)
    result = subprocess.run([sys.executable, '-c', LIMITS_PROBE, SCRIPT], capture_output=True, text=True, env=env, timeout=120)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_the_cli_applies_the_limits_from_its_environment_before_importing_ezdxf_or_pymupdf():
    one_gib = 1024 ** 3
    seen = run_limits_probe({'CONVERTER_RLIMIT_CPU_S': '30', 'CONVERTER_RLIMIT_AS_BYTES': str(one_gib)})
    assert seen['exit'] == 64  # it ran as __main__, all the way to the argument check
    by_limit = {call['which']: call['limits'] for call in seen['calls']}
    assert by_limit[resource.RLIMIT_CPU] == [30, 30]
    assert seen['cpu'][0] == 30
    if sys.platform.startswith('linux'):  # macOS refuses to lower RLIMIT_AS; production is Linux
        assert by_limit[resource.RLIMIT_AS] == [one_gib, one_gib]
        assert seen['as'][0] == one_gib
    else:
        assert resource.RLIMIT_AS not in by_limit
    for call in seen['calls']:
        assert not (call['ezdxf_imported'] or call['pymupdf_imported'] or call['numpy_imported']), call


def test_the_cli_sets_no_limits_when_the_parent_gave_none():
    # Running it by hand is for development; the handler always sets both variables.
    seen = run_limits_probe({})
    assert seen['exit'] == 64 and seen['calls'] == []


def test_importing_the_module_never_changes_the_limits_of_the_importing_process():
    # Only the __main__ path limits itself; a test (or any importer) must not throttle its own process.
    result = subprocess.run(
        [sys.executable, '-c',
         'import resource, sys; sys.path.insert(0, sys.argv[1]); before = resource.getrlimit(resource.RLIMIT_CPU);'
         'import drawing_pdf; assert resource.getrlimit(resource.RLIMIT_CPU) == before',
         os.path.dirname(SCRIPT)],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, 'CONVERTER_RLIMIT_CPU_S': '1', 'CONVERTER_RLIMIT_AS_BYTES': '1000'},
    )
    assert result.returncode == 0, result.stderr
