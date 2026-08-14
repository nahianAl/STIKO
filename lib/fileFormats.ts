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
const MODEL = ['glb', 'gltf', 'obj', 'stl', '3ds', 'ply', 'dae', 'step', 'stp'];

// No viewer branch and no conversion job — createStepToGlbJob is STEP-only.
// Whitelisted deliberately so the import pipeline work lands without a format
// gate to unpick first. Until then these upload and download normally and the
// viewport shows its unsupported-type message.
const CAD = ['dwg', 'dxf'];

export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...IMAGE,
  ...VIDEO,
  ...DOCUMENT,
  ...MODEL,
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
