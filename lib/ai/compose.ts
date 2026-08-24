import { complete } from './provider.ts';
import { validateVersionBrief } from './validate.ts';
import { buildVersionPrompt, capComments, labelAuthors } from './prompt.ts';
import type {
  Provider,
  VersionBrief,
  VersionFacts,
  RawComment,
  PriorTheme,
} from './types';

/**
 * Orchestration: load → prompt → provider → validate → upsert.
 *
 * `composeVersionBrief` is separated from the database so the interesting
 * behaviour — watermarking, validation, pseudonymisation — is testable without
 * Neon or a network.
 */

export interface VersionLoad {
  versionNumber: number;
  facts: VersionFacts;
  comments: RawComment[];
  priorThemes: PriorTheme[];
  coverage: { count: number; maxCreatedAt: string };
}

export type ComposeOutcome =
  | {
      ok: true;
      brief: VersionBrief;
      coveredCount: number;
      coveredThrough: string;
      model: string;
    }
  | { ok: false; reason: string };

export async function composeVersionBrief(
  load: VersionLoad,
  provider: Provider = complete
): Promise<ComposeOutcome> {
  const { kept, omittedCount } = capComments(load.comments, 150);
  const { labelled } = labelAuthors(kept);

  const { system, user } = buildVersionPrompt({
    versionNumber: load.versionNumber,
    comments: labelled,
    facts: load.facts,
    priorThemes: load.priorThemes,
    omittedCount,
  });

  const result = await provider({ system, user });
  if (!result.ok) return { ok: false, reason: result.reason };

  const sentIds = new Set(labelled.map((c) => c.id));
  const priorIds = new Set(load.priorThemes.map((t) => t.versionId));
  const { brief, droppedIds, droppedThemes } = validateVersionBrief(
    result.data,
    sentIds,
    priorIds
  );

  if (droppedIds > 0 || droppedThemes > 0) {
    // The signal that ATLAS_MODEL is the wrong choice. Watch this in logs.
    console.warn(
      `[ai] validation dropped ${droppedIds} citation(s) and ${droppedThemes} theme(s)`
    );
  }

  if (!brief) {
    return { ok: false, reason: 'No theme survived citation validation' };
  }

  return {
    ok: true,
    brief,
    coveredCount: load.coverage.count,
    coveredThrough: load.coverage.maxCreatedAt,
    model: result.model,
  };
}
