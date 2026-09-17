/**
 * Display units for measurements, and the arithmetic between them.
 *
 * Millimetres are the canonical stored unit throughout the measure feature — that is what
 * `file_calibrations.mm_per_unit` holds, and what every function here converts to and from.
 * Millimetres because the STEP pipeline already assumes them (see lib/model/stepWireframe.ts)
 * and because no unit offered here needs a fractional base.
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

export const DEFAULT_LENGTH_UNIT: LengthUnit = 'mm';

/** Exact international definitions: an inch is 25.4 mm by definition, not by measurement. */
const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

/**
 * Decimal places per unit, chosen so one step of the last digit is roughly a millimetre.
 * Reporting a 1.2 m dimension as "1.2 m" throws away the precision the measurement had.
 */
const DECIMALS: Record<LengthUnit, number> = { mm: 0, cm: 1, m: 3, in: 2, ft: 2 };

export function isLengthUnit(value: unknown): value is LengthUnit {
  return typeof value === 'string' && (LENGTH_UNITS as readonly string[]).includes(value);
}

export function mmPerLengthUnit(unit: LengthUnit): number {
  return MM_PER_UNIT[unit];
}

export function toMillimetres(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit];
}

export function fromMillimetres(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit];
}

export function formatLength(mm: number, unit: LengthUnit): string {
  return `${fromMillimetres(mm, unit).toFixed(DECIMALS[unit])} ${unit}`;
}

/** Angles are always degrees, on every surface, whatever the length unit is. */
export function formatAngle(radians: number): string {
  return `${((radians * 180) / Math.PI).toFixed(1)}°`;
}
