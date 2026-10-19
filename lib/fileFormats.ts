/**
 * Which upload formats the review view can do something with.
 *
 * There were three lists before this one and no gate anywhere:
 * ViewerContainer branches on its own extension arrays, fileChips.ts colours a
 * slightly different set, and the dropzone hint copy named a fourth. An
 * unsupported file uploaded fine, registered as a package file, and only
 * failed at the very end — in the viewport, for the reviewer rather than the
 * person who uploaded it. The dropzone gates on THIS list.
 */

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const VIDEO = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
const DOCUMENT = ['pdf'];
const MODEL = [
  'glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp',
  'fbx', '3mf', '3dm', 'igs', 'iges', 'brep',
];

// DWG and DXF: shown through a PDF. The converter (converter/, its own Vercel project) turns
// each drawing into a PDF once, on upload or on first view, and the PDF viewer shows that
// (lib/drawingConversion.ts). Downloads are always the original file.
const CAD = ['dwg', 'dxf'];

export interface FormatAdvice {
  /** The application the file came from, as a reader would name it. */
  app: string;
  /** One sentence telling them what to export instead. */
  advice: string;
}

const EXPORT_STEP = 'Export STEP, then upload.';
const EXPORT_STEP_FROM_TOOL = 'Export STEP from your CAD tool, then upload.';
const EXPORT_FBX_OR_GLB = 'Export FBX or GLB, then upload.';
const EXPORT_GLB = 'Export GLB, then upload.';

/**
 * Native formats nothing free can read. A file with one of these extensions is refused
 * like any other unsupported file, but the refusal says what to do instead of just "no".
 * Disjoint from SUPPORTED_EXTENSIONS by test. SolidWorks parts (.sldprt) are not in this base
 * table: formatTables adds their advice only when the conversion switch is off.
 */
const ADVICE_BASE: Readonly<Record<string, FormatAdvice>> = {
  sldasm: { app: 'SolidWorks', advice: 'Save As STEP, then upload.' },
  ipt: { app: 'Inventor', advice: EXPORT_STEP },
  iam: { app: 'Inventor', advice: EXPORT_STEP },
  f3d: { app: 'Fusion', advice: EXPORT_STEP },
  catpart: { app: 'CATIA', advice: EXPORT_STEP },
  catproduct: { app: 'CATIA', advice: EXPORT_STEP },
  prt: { app: 'NX / Creo / Solid Edge', advice: EXPORT_STEP },
  asm: { app: 'NX / Creo / Solid Edge', advice: EXPORT_STEP },
  par: { app: 'Solid Edge', advice: EXPORT_STEP },
  psm: { app: 'Solid Edge', advice: EXPORT_STEP },
  x_t: { app: 'Parasolid', advice: EXPORT_STEP_FROM_TOOL },
  x_b: { app: 'Parasolid', advice: EXPORT_STEP_FROM_TOOL },
  jt: { app: 'JT', advice: EXPORT_STEP_FROM_TOOL },
  rvt: { app: 'Revit', advice: 'Export FBX from a 3D view, then upload.' },
  skp: { app: 'SketchUp', advice: 'Export FBX or OBJ, then upload.' },
  pln: { app: 'ArchiCAD', advice: 'Export OBJ, then upload.' },
  vwx: { app: 'Vectorworks', advice: 'Export FBX or OBJ, then upload.' },
  ifc: { app: 'IFC', advice: "IFC isn't supported yet. Export FBX or OBJ from your BIM tool." },
  c4d: { app: 'Cinema 4D', advice: EXPORT_FBX_OR_GLB },
  ma: { app: 'Maya', advice: EXPORT_FBX_OR_GLB },
  mb: { app: 'Maya', advice: EXPORT_FBX_OR_GLB },
  blend: { app: 'Blender', advice: EXPORT_GLB },
  max: { app: '3ds Max', advice: 'Export FBX, then upload.' },
  usdz: { app: 'USD', advice: EXPORT_GLB },
  usd: { app: 'USD', advice: EXPORT_GLB },
  usda: { app: 'USD', advice: EXPORT_GLB },
  usdc: { app: 'USD', advice: EXPORT_GLB },
};

const SLDPRT_ADVICE: FormatAdvice = { app: 'SolidWorks', advice: 'Save As STEP, then upload.' };

/**
 * Whether SolidWorks parts are converted (lib/cadConversion.ts). On unless the switch is 'off', so
 * production can turn it off with one env var and a redeploy. Read as the literal
 * process.env.NEXT_PUBLIC_SLDPRT_CONVERSION expression so Next inlines it into the browser bundle:
 * the dropzone decides what to accept on the client.
 */
export function sldprtConversionEnabled(value: string | undefined = process.env.NEXT_PUBLIC_SLDPRT_CONVERSION): boolean {
  return (value ?? '').trim().toLowerCase() !== 'off';
}

/** The model list and the advice table for either switch position. Pure, for tests. */
export function formatTables(enabled: boolean): { model: string[]; advice: Record<string, FormatAdvice> } {
  return enabled
    ? { model: [...MODEL, 'sldprt'], advice: { ...ADVICE_BASE } }
    : { model: [...MODEL], advice: { sldprt: SLDPRT_ADVICE, ...ADVICE_BASE } };
}

const TABLES = formatTables(sldprtConversionEnabled());

/**
 * The formats the 3D viewer opens, undotted. ViewerContainer and the portal page derive
 * their checks from this rather than keeping their own copies — there used to be three.
 * A .sldprt opens through its converted GLB; see opensAsModel in lib/cadConversion.ts.
 */
export const MODEL_FORMATS: readonly string[] = TABLES.model;

export const NATIVE_CAD_ADVICE: Readonly<Record<string, FormatAdvice>> = TABLES.advice;

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...IMAGE,
  ...VIDEO,
  ...DOCUMENT,
  ...TABLES.model,
  ...CAD,
]);

/**
 * The lowercased extension without its dot, or '' when there isn't one.
 *
 * Two cases the naive `split('.').pop()` gets wrong, and both actually occur:
 * a leading dot is a hidden file rather than an extension ('.DS_Store' lands in
 * every dropped macOS folder), and the dropzone carries paths, so a dot in a
 * folder name ('Rev1.2/sheet') must not be read as one.
 */
export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isSupportedFilename(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extensionOf(filename));
}

/** Split a list in two, preserving input order within each side. */
export function partitionBySupport<T>(
  files: T[],
  nameOf: (file: T) => string
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const file of files) {
    if (isSupportedFilename(nameOf(file))) accepted.push(file);
    else rejected.push(file);
  }
  return { accepted, rejected };
}

/**
 * For an <input type="file"> accept attribute, so the OS picker pre-filters.
 * Belt and braces only — drag-and-drop ignores `accept` entirely, which is why
 * partitionBySupport still has to run on every path.
 */
export const ACCEPT_ATTRIBUTE = Array.from(SUPPORTED_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',');

/** The export advice for a refused file, or null when there is none to give. */
export function adviceFor(filename: string): FormatAdvice | null {
  const ext = extensionOf(filename);
  // Own keys only: a filename like "x.constructor" must not resolve through Object.prototype.
  return Object.prototype.hasOwnProperty.call(NATIVE_CAD_ADVICE, ext) ? NATIVE_CAD_ADVICE[ext] : null;
}
