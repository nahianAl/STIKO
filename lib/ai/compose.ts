import { complete } from './provider.ts';
import { validateVersionBrief, validateProjectBrief } from './validate.ts';
import {
  buildVersionPrompt,
  buildProjectPrompt,
  capComments,
  labelAuthors,
} from './prompt.ts';
import type {
  Provider,
  VersionBrief,
  VersionFacts,
  RawComment,
  PriorTheme,
  ProjectBrief,
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

export interface ProjectLoad {
  projectName: string;
  packages: Array<{
    portalId: string;
    name: string;
    versions: Array<{ versionId: string; versionNumber: number; headline: string }>;
  }>;
  coveredThrough: string;
}

export type ProjectComposeOutcome =
  | { ok: true; brief: ProjectBrief; coveredThrough: string; model: string }
  | { ok: false; reason: string };

export async function composeProjectBrief(
  load: ProjectLoad,
  provider: Provider = complete
): Promise<ProjectComposeOutcome> {
  const { system, user } = buildProjectPrompt({
    projectName: load.projectName,
    packages: load.packages,
  });

  const result = await provider({ system, user });
  if (!result.ok) return { ok: false, reason: result.reason };

  const portalIds = new Set(load.packages.map((p) => p.portalId));
  const versionIds = new Set(
    load.packages.flatMap((p) => p.versions.map((v) => v.versionId))
  );

  const { brief, droppedSections } = validateProjectBrief(
    result.data,
    portalIds,
    versionIds
  );

  if (droppedSections > 0) {
    console.warn(`[ai] project validation dropped ${droppedSections} section(s)`);
  }
  if (!brief) return { ok: false, reason: 'No section survived citation validation' };

  return { ok: true, brief, coveredThrough: load.coveredThrough, model: result.model };
}
