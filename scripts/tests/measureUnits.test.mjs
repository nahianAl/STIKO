import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LENGTH_UNITS,
  DEFAULT_LENGTH_UNIT,
  isLengthUnit,
  mmPerLengthUnit,
  toMillimetres,
  fromMillimetres,
  formatLength,
  formatAngle,
} from '../../lib/measure/units.ts';

test('the dropdown offers exactly the five agreed units, in order', () => {
  assert.deepEqual([...LENGTH_UNITS], ['mm', 'cm', 'm', 'in', 'ft']);
  assert.equal(DEFAULT_LENGTH_UNIT, 'mm');
});

test('isLengthUnit accepts the five and rejects everything else', () => {
  for (const unit of LENGTH_UNITS) assert.equal(isLengthUnit(unit), true, unit);
  for (const junk of ['km', 'MM', '', null, undefined, 3, {}]) {
    assert.equal(isLengthUnit(junk), false, String(junk));
  }
});

test('imperial factors are the exact international definitions', () => {
  assert.equal(mmPerLengthUnit('in'), 25.4);
  assert.equal(mmPerLengthUnit('ft'), 304.8);
});

test('every unit round-trips through millimetres', () => {
  for (const unit of LENGTH_UNITS) {
    const mm = toMillimetres(7, unit);
    assert.ok(Math.abs(fromMillimetres(mm, unit) - 7) < 1e-9, unit);
  }
});

test('formatLength uses a precision that suits each unit', () => {
  assert.equal(formatLength(1234.56, 'mm'), '1235 mm');
  assert.equal(formatLength(1234.56, 'cm'), '123.5 cm');
  assert.equal(formatLength(1234.56, 'm'), '1.235 m');
  assert.equal(formatLength(1234.56, 'in'), '48.60 in');
  assert.equal(formatLength(1234.56, 'ft'), '4.05 ft');
});

test('formatAngle reports degrees to one decimal', () => {
  assert.equal(formatAngle(Math.PI / 2), '90.0°');
  assert.equal(formatAngle(Math.PI), '180.0°');
  assert.equal(formatAngle(0), '0.0°');
});
