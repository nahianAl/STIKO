/**
 * The notification tray's popover is gone — the header bell now toggles the
 * activity rail, which shows the same rows with more room and no second
 * surface to keep in sync.
 *
 * This file survives for the row shape, which /api/notifications returns and
 * both the rail and the feed panel consume.
 */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  excerpt: string | null;
  href: string;
  createdAt: string;
  readAt: string | null;
  portalId: string | null;
  packageName: string | null;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
}
