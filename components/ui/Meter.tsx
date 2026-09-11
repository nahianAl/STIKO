import React from 'react';

export interface MeterSegment {
  /** 0–1 of the whole track. Segments are drawn in order, left to right. */
  fraction: number;
  /** A colour from tailwind.config.ts. Do not invent hex values. */
  color: string;
  key: string;
}

/**
 * A horizontal usage bar, one or more segments on a shared track.
 *
 * Presentational only — it knows nothing about plans, bytes or limits, so the
 * stacked storage bar and the plain project bar are the same component rather
 * than two near-duplicates that drift apart.
 */
export function Meter({
  segments,
  height = 6,
  label,
}: {
  segments: MeterSegment[];
  height?: number;
  label?: string;
}) {
  const filled = segments.reduce(
    (sum, s) => sum + Math.max(0, Math.min(s.fraction, 1)),
    0
  );

  return (
    <div
      className="w-full overflow-hidden rounded-full bg-stiko-idle"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <div className="flex h-full w-full">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="h-full transition-[width] duration-200"
            style={{
              // Face value while the segments fit. Only once they collectively
              // overflow the track are they scaled down in proportion, so two
              // segments can never sum past 100% and push one off the end.
              width: `${(Math.max(0, Math.min(segment.fraction, 1)) / Math.max(1, filled)) * 100}%`,
              background: segment.color,
            }}
          />
        ))}
      </div>
    </div>
  );
}
