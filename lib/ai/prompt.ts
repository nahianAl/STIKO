import type { PayloadComment, VersionFacts, RawComment, PriorTheme } from './types';

/**
 * Pure prompt construction.
 *
 * Two jobs beyond string building, both of which are guarantees rather than
 * conveniences:
 *
 *   * pseudonymisation — real names never reach a third party. Labels are
 *     stable within a request so the model can still say "three reviewers",
 *     and the caller rehydrates names client-side from the cited ids.
 *   * capping — a version with 300 comments is truncated, and the prompt says
 *     so. Silent truncation would produce a brief that is quietly wrong.
 */

export function capComments<T>(
  rows: T[],
  limit = 150
): { kept: T[]; omittedCount: number } {
  if (rows.length <= limit) return { kept: rows, omittedCount: 0 };
  return { kept: rows.slice(0, limit), omittedCount: rows.length - limit };
}

/** A, B, ... Z, AA, AB — enough for any realistic reviewer count. */
function labelFor(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Reviewer ${out}`;
}

export function labelAuthors(
  rows: RawComment[]
): { labelled: PayloadComment[]; labels: Map<string, string> } {
  const byKey = new Map<string, string>();
  const labels = new Map<string, string>();

  const labelled = rows.map((row) => {
    let label = byKey.get(row.authorKey);
    if (!label) {
      label = labelFor(byKey.size);
      byKey.set(row.authorKey, label);
      labels.set(label, row.authorKey);
    }
    return {
      id: row.id,
      author: label,
      text: row.text,
      file: row.file,
      isReply: row.isReply,
      pseudonymised: true as const,
    };
  });

  return { labelled, labels };
}

const SYSTEM = `You summarise design-review feedback on engineering and architectural files.

Return ONLY a JSON object with this shape:
{
  "headline": "one sentence on where this version stands",
  "themes": [
    {
      "title": "short label",
      "body": "one or two sentences",
      "commentIds": ["<ids of the comments this theme is built from>"],
      "firstSeenVersionId": "<a version id from PRIOR THEMES, or null>"
    }
  ]
}

Rules:
- Every id in commentIds MUST come from the comments supplied below. Never invent one.
- Produce between one and six themes. Group related pins; do not restate each comment.
- Set firstSeenVersionId only when a theme clearly repeats a prior theme supplied below.
- Be neutral and factual. The people being summarised will read this.
- Do not name individuals beyond the reviewer labels given.`;

export function buildVersionPrompt(input: {
  versionNumber: number;
  comments: PayloadComment[];
  facts: VersionFacts;
  priorThemes: PriorTheme[];
  omittedCount: number;
}): { system: string; user: string } {
  const lines: string[] = [];

  lines.push(`VERSION ${input.versionNumber}`);
  lines.push(
    `Facts: ${input.facts.commentCount} comments, ${input.facts.openThreadCount} unanswered threads, ` +
      `${input.facts.approvedCount} approved, ${input.facts.changesRequestedCount} requested changes, ` +
      `${input.facts.participantCount} participants.`
  );
  if (input.facts.mostAnnotatedFile) {
    lines.push(`Most annotated file: ${input.facts.mostAnnotatedFile}`);
  }
  if (input.omittedCount > 0) {
    lines.push(
      `NOTE: only the ${input.comments.length} most recent comments are shown; ` +
        `${input.omittedCount} older ones were omitted. Say so in the headline.`
    );
  }

  if (input.priorThemes.length > 0) {
    lines.push('', 'PRIOR THEMES (from earlier versions):');
    for (const t of input.priorThemes) {
      lines.push(`- [${t.versionId}] ${t.title}: ${t.body}`);
    }
  }

  lines.push('', 'COMMENTS:');
  for (const c of input.comments) {
    const kind = c.isReply ? 'reply' : 'comment';
    lines.push(`- id=${c.id} (${kind}, ${c.author}, on ${c.file}): ${c.text}`);
  }

  return { system: SYSTEM, user: lines.join('\n') };
}

const PROJECT_SYSTEM = `You write a short status brief for a design project, from per-version summaries.

Return ONLY a JSON object with this shape:
{
  "headline": "one sentence on where the project stands",
  "sections": [
    { "portalId": "<a package id supplied below>", "body": "one or two sentences", "versionIds": ["<version ids supplied below>"] }
  ]
}

Rules:
- Use only the package and version ids supplied below. Never invent one.
- One section per package that has activity. Say whether it is converging or stuck, and what is blocking.
- Be neutral and factual.`;

export function buildProjectPrompt(input: {
  projectName: string;
  packages: Array<{
    portalId: string;
    name: string;
    versions: Array<{ versionId: string; versionNumber: number; headline: string }>;
  }>;
}): { system: string; user: string } {
  const lines: string[] = [`PROJECT: ${input.projectName}`, ''];

  for (const pkg of input.packages) {
    lines.push(`PACKAGE ${pkg.name} (portalId=${pkg.portalId}):`);
    for (const v of pkg.versions) {
      lines.push(`  - [${v.versionId}] v${v.versionNumber}: ${v.headline}`);
    }
    lines.push('');
  }

  return { system: PROJECT_SYSTEM, user: lines.join('\n') };
}

const CHANGELOG_SYSTEM = `You draft a short changelog entry for a new version of a design package.

Return ONLY a JSON object: { "changelog": "one or two sentences" }

Write what the new version addresses, based on the open concerns from the previous
version. Be concrete and plain. No preamble, no bullet points, no marketing tone.`;

export function buildChangelogPrompt(input: {
  previousVersionNumber: number;
  openThemes: Array<{ title: string; body: string }>;
}): { system: string; user: string } {
  const lines = [`Open concerns from version ${input.previousVersionNumber}:`];
  for (const t of input.openThemes) {
    lines.push(`- ${t.title}: ${t.body}`);
  }
  return { system: CHANGELOG_SYSTEM, user: lines.join('\n') };
}
