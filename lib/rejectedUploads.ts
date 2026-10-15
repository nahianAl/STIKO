/**
 * Validation for refused-upload reports. Only extensions ever leave the browser — never
 * filenames — so this counts demand without recording what anyone was working on.
 */

export const MAX_REJECTED_PER_REPORT = 20;

const EXTENSION = /^[a-z0-9_]{1,10}$/;

/**
 * The extensions worth counting from an untrusted request body: lowercased, one entry per
 * refused file (duplicates kept), junk dropped, capped. '' is a file with no extension.
 */
export function normalizeRejectedExtensions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const ext = raw.toLowerCase();
    if (ext === '') out.push('(none)');
    else if (EXTENSION.test(ext)) out.push(ext);
    if (out.length === MAX_REJECTED_PER_REPORT) break;
  }
  return out;
}
