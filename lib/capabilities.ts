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
  }
}
