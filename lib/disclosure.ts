/**
 * Progressive disclosure thresholds — stiko_handoff/03.
 *
 * The rule these encode: below its threshold an element is NOT RENDERED. Not
 * greyed out, not disabled, not an empty section with a "nothing here yet"
 * message. Absent.
 *
 * Kept in one module so the ladder is auditable and adjustable in one place,
 * per 03's implementation note. Compute the signals server-side (or from
 * already-loaded data) so nothing materialises a beat after paint — a search
 * box that appears 300ms in is worse than one that was never there.
 */

export interface DisclosureState {
  /** Packages visible to this user, across everything. */
  packageCount: number;
  /** Files visible to this user, across everything. */
  fileCount: number;
  notificationCount: number;
  needsYouCount: number;
  /** Packages inside the project currently in view. */
  packagesInProject: number;
  /** People on the project currently in view. */
  peopleCount: number;
  /** Reviewers on the package currently in view. */
  reviewerCount: number;
  hasPublishedVersion: boolean;
  /** Versions on the package currently in view. */
  versionCount: number;
}

export const EMPTY_DISCLOSURE: DisclosureState = {
  packageCount: 0,
  fileCount: 0,
  notificationCount: 0,
  needsYouCount: 0,
  packagesInProject: 0,
  peopleCount: 0,
  reviewerCount: 0,
  hasPublishedVersion: false,
  versionCount: 0,
};

export const DISCLOSURE = {
  /** Home is a flat package list until a second package exists. */
  groupByProject: (s: DisclosureState) => s.packageCount >= 2,
  showSearch: (s: DisclosureState) => s.packageCount >= 3 || s.fileCount >= 20,
  showNotifications: (s: DisclosureState) => s.notificationCount > 0,
  /** Never render an empty "Needs you" section. */
  showNeedsYou: (s: DisclosureState) => s.needsYouCount > 0,
  showTags: (s: DisclosureState) => s.packagesInProject >= 2,
  showProjectTabs: (s: DisclosureState) =>
    s.packagesInProject >= 2 && s.peopleCount >= 3,
  showAccessMatrix: (s: DisclosureState) => s.packagesInProject >= 2,
  showWaitingOn: (s: DisclosureState) =>
    s.reviewerCount >= 2 && s.hasPublishedVersion,
  showVersionRail: (s: DisclosureState) => s.versionCount >= 2,
  showStatusChips: (s: DisclosureState) => s.hasPublishedVersion,
  /** Multi-package invite; with one package the invite goes straight to it. */
  showPackagePicker: (s: DisclosureState) => s.packagesInProject >= 2,
  showCoordinatorCards: (s: DisclosureState) => s.packagesInProject >= 2,
} as const;

/**
 * "Who can see this" is the one coordination affordance exempt from the
 * ladder — it is one click and it is the coordinator's professional liability,
 * so it is available at every package size. Exported as a named constant rather
 * than a predicate so nobody is tempted to put a threshold behind it.
 */
export const ALWAYS_SHOW_WHO_CAN_SEE_THIS = true;
