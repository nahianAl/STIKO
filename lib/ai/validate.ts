import type { BriefTheme, VersionBrief, ProjectBrief, ProjectSection } from './types';

/**
 * The anti-hallucination guard.
 *
 * Everything a brief asserts is anchored to ids the server itself sent. Any id
 * the model invented is removed here, and a theme that has nothing left to
 * point at is removed with it. That is what lets the UI render a citation chip
 * as a link without checking first: it cannot reference a comment that does not
 * exist.
 *
 * Deliberately dependency-free — no database, no network — so the guarantee can
 * be tested directly.
 */

const MAX_THEMES = 6;

export interface ValidationResult {
  /** Null when nothing survived. Callers must not persist a null brief. */
  brief: VersionBrief | null;
  droppedIds: number;
  droppedThemes: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function validateVersionBrief(
  raw: unknown,
  sentIds: Set<string>,
  priorVersionIds: Set<string>
): ValidationResult {
  let droppedIds = 0;
  let droppedThemes = 0;

  if (!isRecord(raw)) return { brief: null, droppedIds, droppedThemes };

  const headline = text(raw.headline);
  if (!headline || !Array.isArray(raw.themes)) {
    return { brief: null, droppedIds, droppedThemes };
  }

  const themes: BriefTheme[] = [];

  for (const candidate of raw.themes) {
    if (!isRecord(candidate)) {
      droppedThemes += 1;
      continue;
    }

    const title = text(candidate.title);
    const body = text(candidate.body);
    const ids = Array.isArray(candidate.commentIds) ? candidate.commentIds : [];

    const kept: string[] = [];
    for (const id of ids) {
      if (typeof id === 'string' && sentIds.has(id)) {
        if (!kept.includes(id)) kept.push(id);
      } else {
        droppedIds += 1;
      }
    }

    if (!title || !body || kept.length === 0) {
      droppedThemes += 1;
      continue;
    }

    const first = typeof candidate.firstSeenVersionId === 'string'
      ? candidate.firstSeenVersionId
      : null;

    themes.push({
      title,
      body,
      commentIds: kept,
      // Only trust a recurrence claim that names a version we actually
      // supplied as prior context.
      firstSeenVersionId: first && priorVersionIds.has(first) ? first : null,
    });
  }

  if (themes.length === 0) return { brief: null, droppedIds, droppedThemes };

  return {
    brief: { headline, themes: themes.slice(0, MAX_THEMES) },
    droppedIds,
    droppedThemes,
  };
}

export interface ProjectValidationResult {
  brief: ProjectBrief | null;
  droppedSections: number;
}

export function validateProjectBrief(
  raw: unknown,
  portalIds: Set<string>,
  versionIds: Set<string>
): ProjectValidationResult {
  let droppedSections = 0;
  if (!isRecord(raw)) return { brief: null, droppedSections };

  const headline = text(raw.headline);
  if (!headline || !Array.isArray(raw.sections)) {
    return { brief: null, droppedSections };
  }

  const sections: ProjectSection[] = [];

  for (const candidate of raw.sections) {
    if (!isRecord(candidate)) {
      droppedSections += 1;
      continue;
    }
    const portalId = typeof candidate.portalId === 'string' ? candidate.portalId : null;
    const body = text(candidate.body);
    const cited = Array.isArray(candidate.versionIds) ? candidate.versionIds : [];
    const kept = cited.filter(
      (v): v is string => typeof v === 'string' && versionIds.has(v)
    );

    if (!portalId || !portalIds.has(portalId) || !body) {
      droppedSections += 1;
      continue;
    }

    sections.push({ portalId, body, versionIds: Array.from(new Set(kept)) });
  }

  if (sections.length === 0) return { brief: null, droppedSections };
  return { brief: { headline, sections }, droppedSections };
}
