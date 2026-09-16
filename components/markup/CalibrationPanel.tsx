'use client';

import { useState } from 'react';
import { LENGTH_UNITS, type LengthUnit } from '@/lib/measure/units';
import { BAR } from './toolbarStyles';

/**
 * "This distance is [ 2400 ] [ mm ]" — shown once the calibration gesture has both its points.
 *
 * Its own unit selector rather than reusing the toolbar's: the number someone reads off a
 * drawing is in whatever unit the drawing is dimensioned in, which has nothing to do with the
 * unit they want to READ measurements in afterwards.
 */
export default function CalibrationPanel({
  unit, error, onCommit, onCancel,
}: {
  unit: LengthUnit;
  /** A failed save, shown in place rather than swallowed — the panel is the only thing on screen. */
  error: string | null;
  onCommit: (realDistance: number, unit: LengthUnit) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [entryUnit, setEntryUnit] = useState<LengthUnit>(unit);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="absolute left-1/2 top-[76px] z-40 -translate-x-1/2">
      <div className={`${BAR} gap-[8px] px-[12px]`}>
        <span className="text-[12px] text-stiko-secondary">This distance is</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onCommit(parsed, entryUnit);
            if (e.key === 'Escape') onCancel();
          }}
          inputMode="decimal"
          aria-label="Real distance"
          className="h-[30px] w-[88px] rounded-[9px] border border-stiko-divider px-[8px] text-[13px]"
        />
        <select
          value={entryUnit}
          onChange={(e) => setEntryUnit(e.target.value as LengthUnit)}
          aria-label="Unit of the real distance"
          className="h-[30px] rounded-[9px] border border-stiko-divider px-[6px] text-[12px]"
        >
          {LENGTH_UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <button
          disabled={!valid}
          onClick={() => onCommit(parsed, entryUnit)}
          className="h-[30px] rounded-[9px] bg-stiko-primary px-[12px] text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Set
        </button>
        <button onClick={onCancel} className="h-[30px] px-[8px] text-[12px] text-stiko-secondary">
          Cancel
        </button>
        {error && <span className="text-[11px] text-red-500">{error}</span>}
      </div>
    </div>
  );
}
