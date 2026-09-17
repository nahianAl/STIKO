import { extensionOf } from '../fileFormats.ts';
import { toMillimetres, type LengthUnit } from './units.ts';

/**
 * How many real millimetres one INTRINSIC unit of a file spans, and where that number came from.
 *
 * "Intrinsic unit" differs per surface and each definition is a trap if got wrong:
 *   image — one NATURAL pixel of the source image (not displayed px, not snapshot px, both of
 *           which change with zoom and viewport)
 *   pdf   — one PDF point (1/72"), NOT one rendered pixel; the viewer renders at
 *           PDF_RENDER_SCALE (see lib/measure/space.ts)
 *   3D    — one world unit of the LOADED GLB
 */

/** The page key for a file that has no pages. Matches file_calibrations.page_number's default. */
export const UNPAGED = 0;

export type ScaleSource = 'calibrated' | 'assumed' | 'unknown';

export interface Scale {
  /** Null only when source is 'unknown'. */
  mmPerUnit: number | null;
  source: ScaleSource;
}

/**
 * What one world unit means for a 3D format that has a unit convention, in millimetres.
 *
 * Read from the ORIGINAL upload's filename, never from the file the viewer actually loaded. A
 * STEP upload is viewed as a converted GLB, but stepToGlb emits OCCT's millimetres — so a .step
 * file is 1 mm per unit even though the bytes on screen are a .glb. Keying off the loaded file
 * would apply the glTF metre convention and read every STEP model 1000x too large.
 *
 * Null means "no convention exists": measuring is blocked until someone calibrates. That covers
 * OBJ/STL/PLY/3DS/DAE, and also every 2D format — an image or a PDF is calibrated or nothing.
 */
export function assumedMmPerUnit(filename: string): number | null {
  switch (extensionOf(filename)) {
    case 'step':
    case 'stp':
      return 1;
    case 'glb':
    case 'gltf':
      return 1000;
    default:
      return null;
  }
}

/**
 * The scale implied by "this measured span is that far in the real world".
 *
 * Throws rather than returning a sentinel: a non-positive or non-finite scale would be stored,
 * pass the CHECK constraint's own guard only by accident, and silently corrupt every subsequent
 * reading on the file.
 */
export function mmPerUnitFrom(
  intrinsicDistance: number,
  realDistance: number,
  unit: LengthUnit,
): number {
  if (!Number.isFinite(intrinsicDistance) || intrinsicDistance <= 0) {
    throw new RangeError('The measured distance must be a positive number');
  }
  if (!Number.isFinite(realDistance) || realDistance <= 0) {
    throw new RangeError('The real distance must be a positive number');
  }
  return toMillimetres(realDistance, unit) / intrinsicDistance;
}

export interface ScaleInput {
  /** The ORIGINAL upload's filename — see assumedMmPerUnit. */
  filename: string;
  /** Stored mm-per-unit keyed by page number; UNPAGED for files without pages. */
  calibrations?: Record<number, number>;
  /** Which page is on screen. Defaults to UNPAGED. */
  page?: number;
}

export function resolveScale({ filename, calibrations, page = UNPAGED }: ScaleInput): Scale {
  const calibrated = calibrations?.[page];
  if (typeof calibrated === 'number' && Number.isFinite(calibrated) && calibrated > 0) {
    return { mmPerUnit: calibrated, source: 'calibrated' };
  }

  const assumed = assumedMmPerUnit(filename);
  if (assumed !== null) return { mmPerUnit: assumed, source: 'assumed' };

  return { mmPerUnit: null, source: 'unknown' };
}
