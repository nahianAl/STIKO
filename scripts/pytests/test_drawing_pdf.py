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
