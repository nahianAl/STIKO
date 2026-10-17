# Python tests (the DWG/DXF converter in `converter/`)

Not part of `npm test`. They need Python 3.12+ and LibreDWG's `dwg2dxf`. Keep the venv outside
the repo.

```bash
python3 -m venv /tmp/dwgenv
/tmp/dwgenv/bin/pip install -r scripts/pytests/requirements-dev.txt
brew install libredwg          # or set DWG2DXF to a dwg2dxf binary
DWG2DXF=$(which dwg2dxf) /tmp/dwgenv/bin/python -m pytest -q -p no:cacheprovider \
  -c scripts/pytests/pytest.ini scripts/pytests
```

`DWG2DXF` overrides the bundled `converter/api/_bin/dwg2dxf`, which is a Linux binary and does
not run on macOS.
