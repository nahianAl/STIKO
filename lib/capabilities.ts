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
