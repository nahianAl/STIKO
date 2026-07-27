/**
 * The notification events and their defaults (3k).
 *
 * Per-event, per-channel control, so nobody has to mute everything to escape
 * noise. A missing `notification_prefs` row means the default below, which is
 * why nothing needs backfilling for existing users.
 *
 * Lives in lib/ rather than the route because a Next.js route file may only
 * export route handlers.
 */
export interface NotificationEvent {
  key: string;
  label: string;
  note: string | null;
  inApp: boolean;
  email: boolean;
  inAppApplies: boolean;
  emailApplies: boolean;
}

export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  {
    key: 'mention',
    label: 'Someone @mentions me',
    note: 'Always worth interrupting you for.',
    inApp: true,
    email: true,
    inAppApplies: true,
    emailApplies: true,
  },
  {
    key: 'new_version',
    label: 'A new version is published',
    note: 'On packages you’re a participant in.',
    inApp: true,
    email: true,
    inAppApplies: true,
    emailApplies: true,
  },
  {
    key: 'comment_reply',
    label: 'Someone replies to my comment',
    note: null,
    inApp: true,
    email: false,
    inAppApplies: true,
    emailApplies: true,
  },
  {
    key: 'new_comment',
    label: 'Any new comment on my packages',
    note: 'Noisy on busy sets — off by default.',
    inApp: true,
    email: false,
    inAppApplies: true,
    emailApplies: true,
  },
  {
    key: 'invite_accepted',
    label: 'Invitation accepted',
    note: null,
    inApp: true,
    email: false,
    inAppApplies: true,
    emailApplies: true,
  },
  {
    key: 'weekly_summary',
    label: 'Weekly summary',
    note: 'Monday morning, everything still open.',
    inApp: false,
    email: true,
    // In-app doesn't apply to a digest — the cell renders as an em-dash.
    inAppApplies: false,
    emailApplies: true,
  },
];
