import type { VersionStatus } from './status';

/**
 * The shapes /api/projects/[id]/overview returns.
 *
 * These lived on the project page until the dashboard absorbed it. They are
 * here rather than in lib/queries because nothing under test imports them and
 * lib/queries pulls a database connection at module load.
 */

export interface ProjectPerson {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
  verdict: string | null;
  viewedAt: string | null;
  commentCount: number;
  lastCommentAt: string | null;
}

export interface ProjectPackage {
  id: string;
  name: string;
  tag: string | null;
  /** ISO timestamp. The panel shows when each package was created. */
  createdAt: string;
  versionNumber: number | null;
  changelog: string | null;
  publishedAt: string | null;
  updatedByName: string | null;
  fileCount: number;
  openComments: number;
  status: VersionStatus;
  people: ProjectPerson[];
  pending: {
    email: string;
    role: string;
    createdAt: string;
    expiresAt: string;
  }[];
}

export interface ProjectOverview {
  project: { id: string; name: string; createdAt: string };
  members: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    role: string;
    isYou: boolean;
  }[];
  packages: ProjectPackage[];
  /**
   * Every portal under the project, TRASHED INCLUDED — unlike
   * `packages` above, which excludes them. Trashed content still holds
   * files, comments and S3 objects until the purge runs, so this
   * deliberately over-counts the live list: it is a "how much is really
   * sitting here" count, not a display count.
   */
  totalPackageCount: number;
  disclosure: {
    packagesInProject: number;
    peopleCount: number;
    hasPublishedVersion: boolean;
  };
}
