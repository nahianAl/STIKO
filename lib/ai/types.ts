/**
 * Shapes shared across lib/ai. No logic lives here — every module below
 * depends on this file, so anything with behaviour would make the graph cyclic.
 */

/** One clustered theme, with the comments that justify it. */
export interface BriefTheme {
  title: string;
  body: string;
  /** Comment ids. Guaranteed real: validate.ts drops anything unrecognised. */
  commentIds: string[];
  /** Set when this concern first appeared in an earlier version. */
  firstSeenVersionId: string | null;
}

export interface VersionBrief {
  headline: string;
  themes: BriefTheme[];
}

export interface ProjectSection {
  portalId: string;
  body: string;
  versionIds: string[];
}

export interface ProjectBrief {
  headline: string;
  sections: ProjectSection[];
}

/** Everything SQL knows. Rendered even when inference is unavailable. */
export interface VersionFacts {
  commentCount: number;
  openThreadCount: number;
  approvedCount: number;
  changesRequestedCount: number;
  participantCount: number;
  mostAnnotatedFile: string | null;
}

/** A comment as it comes out of SQL, with the real author name still on it. */
export interface RawComment {
  id: string;
  /** Stable identity for labelling. user_id, or the author string for guests. */
  authorKey: string;
  author: string;
  text: string;
  file: string;
  isReply: boolean;
}

/** A comment as it is sent to the provider — pseudonymous by construction. */
export interface PayloadComment {
  id: string;
  /** "Reviewer A". Never a real name. */
  author: string;
  text: string;
  file: string;
  isReply: boolean;
  /**
   * Brand. `RawComment` has every field above plus `authorKey`, which makes it
   * structurally assignable to this interface — TypeScript's structural typing
   * cannot otherwise tell "real name" from "pseudonym", so a caller could skip
   * `labelAuthors()` entirely and the compiler would accept it. This field
   * exists only so `labelAuthors()` is the sole producer of a `PayloadComment`:
   * it is not optional, because an optional field would restore assignability
   * and undo the guarantee.
   */
  readonly pseudonymised: true;
}

/** A theme from an earlier version, supplied as context for recurrence. */
export interface PriorTheme {
  versionId: string;
  title: string;
  body: string;
}

export interface CompleteOptions {
  system: string;
  user: string;
  timeoutMs?: number;
}

export type CompleteResult =
  | { ok: true; data: unknown; model: string }
  | { ok: false; reason: string };

/** Injectable so tests never make a network call. */
export type Provider = (opts: CompleteOptions) => Promise<CompleteResult>;
