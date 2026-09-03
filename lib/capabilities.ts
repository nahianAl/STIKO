/**
 * Who may do what with a package.
 *
 * Split out of lib/access.ts, which imports the database client, so this — the
 * security-relevant part — can be asserted directly by a test without a live connection.
 */

export type PackageRole = 'viewer' | 'commenter' | 'uploader';
export type ProjectRole = 'owner' | 'coordinator';
export type EffectiveRole = PackageRole | ProjectRole;

export interface Capabilities {
  canComment: boolean;
  canUpload: boolean;
  /** May move or rotate a 3D object for everyone. Deliberately not an alias for canUpload. */
  canTransform: boolean;
  canManagePeople: boolean;
}

/** Deny everything. The shape an unrecognised role gets, so it fails closed. */
const NO_CAPABILITIES: Capabilities = {
  canComment: false,
  canUpload: false,
  canTransform: false,
  canManagePeople: false,
};

export function capabilitiesFor(role: EffectiveRole): Capabilities {
  switch (role) {
    case 'owner':
    case 'coordinator':
      return { canComment: true, canUpload: true, canTransform: true, canManagePeople: true };
    case 'uploader':
      return { canComment: true, canUpload: true, canTransform: true, canManagePeople: false };
    case 'commenter':
      return { canComment: true, canUpload: false, canTransform: false, canManagePeople: false };
    case 'viewer':
      return { canComment: false, canUpload: false, canTransform: false, canManagePeople: false };
    default: {
      // Two guarantees at once. At compile time, adding a role to EffectiveRole without a
      // case here fails to typecheck, because `role` is no longer `never`. At runtime, a role
      // the union has not caught up with — the database's CHECK constraint can gain one, and
      // it reaches this function through an unchecked cast — denies everything, rather than
      // returning undefined and leaving the Access object with no capability keys at all.
      const unhandled: never = role;
      void unhandled;
      return { ...NO_CAPABILITIES };
    }
  }
}

export interface DeleteContext {
  role: EffectiveRole;
  /** The caller uploaded this file. Always false when judging a whole version. */
  isOwnUpload: boolean;
  /** The version is published — for a file, the version containing it. */
  isPublished: boolean;
}

/**
 * Who may destroy content.
 *
 * Deleting a file cascades to every comment and markup on it, so this is the
 * power to erase other people's work, not just one's own. That is why an
 * uploader's reach stops at publication: before it nobody has seen the file, so
 * deletion harms no one; after it, removal is the owner's call.
 *
 * A version is never "own upload" — one version can hold files from several
 * uploaders, so letting any of them delete the container would let them delete
 * the others' work.
 */
export function canDeleteContent(ctx: DeleteContext): boolean {
  switch (ctx.role) {
    case 'owner':
    case 'coordinator':
      return true;
    case 'uploader':
      return ctx.isOwnUpload && !ctx.isPublished;
    case 'commenter':
    case 'viewer':
      return false;
    default: {
      // Same two guarantees as capabilitiesFor: a role added to EffectiveRole
      // without a case here fails to typecheck, and one that reaches this
      // through an unchecked cast is denied rather than falling through.
      const unhandled: never = ctx.role;
      void unhandled;
      return false;
    }
  }
}
