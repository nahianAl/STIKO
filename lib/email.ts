/**
 * Outbound email.
 *
 * The redesign assumes real delivery in three places — invitations (`2h`, `4c`),
 * notifications (`3k`) and password reset (`3c`, `3d`) — but the project has no
 * mail provider configured. So this is one seam with two transports:
 *
 *   - `RESEND_API_KEY` set  → posts to Resend's HTTP API (plain fetch, no new
 *                             npm dependency).
 *   - otherwise             → logs the message and reports that it was NOT
 *                             delivered.
 *
 * The dev transport deliberately does not pretend to succeed. Callers get an
 * honest `delivered` flag so the UI never claims an email was sent when nothing
 * left the building.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Kept text-only — a templated HTML layer is out of scope here. */
  body: string;
}

export interface EmailResult {
  delivered: boolean;
  /** Present when delivery failed or was skipped, for logging and for the UI. */
  reason?: string;
}

const FROM = process.env.EMAIL_FROM ?? 'Stiko <noreply@stiko.app>';

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(
      `[email] NOT DELIVERED (no RESEND_API_KEY configured)\n` +
        `  to:      ${message.to}\n` +
        `  subject: ${message.subject}\n` +
        `  body:    ${message.body.replace(/\n/g, '\n           ')}`
    );
    return { delivered: false, reason: 'No email provider configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [message.to],
        subject: message.subject,
        text: message.body,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[email] provider rejected the message: ${detail}`);
      return { delivered: false, reason: 'Email provider rejected the message' };
    }

    return { delivered: true };
  } catch (err) {
    console.error('[email] transport error', err);
    return { delivered: false, reason: 'Could not reach the email provider' };
  }
}

/* -------------------------------------------------------------------------- */
/* Message bodies                                                             */
/* -------------------------------------------------------------------------- */

export function inviteEmail(opts: {
  inviterName: string;
  packageName: string;
  projectName: string;
  role: string;
  link: string;
  note?: string | null;
}): Omit<EmailMessage, 'to'> {
  return {
    // "Review" is a verb. Never "a review".
    subject: `${opts.inviterName} invited you to review ${opts.packageName}`,
    body: [
      `${opts.inviterName} invited you to review ${opts.packageName} (${opts.projectName}) as ${opts.role}.`,
      opts.note ? `\n"${opts.note}"\n` : '',
      `Open it here: ${opts.link}`,
      ``,
      `This invitation expires in 14 days.`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function newVersionEmail(opts: {
  publisherName: string;
  packageName: string;
  versionNumber: number;
  /**
   * Optional since 2026-08-14. When absent the whole "What changed" block is
   * dropped — interpolating it unconditionally emailed a bare pair of quotes.
   */
  changelog?: string | null;
  link: string;
}): Omit<EmailMessage, 'to'> {
  const note = opts.changelog?.trim();

  // Built by pushing rather than filter(Boolean) like inviteEmail above: the
  // blank separators here are meaningful, and filter(Boolean) eats them.
  const lines = [
    `${opts.publisherName} published version ${opts.versionNumber} of ${opts.packageName}.`,
  ];
  if (note) lines.push(``, `What changed:`, `"${note}"`);
  lines.push(``, `Review it here: ${opts.link}`);

  return {
    subject: `Version ${opts.versionNumber} of ${opts.packageName} is ready to review`,
    body: lines.join('\n'),
  };
}

export function passwordResetEmail(opts: {
  link: string;
}): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Reset your Stiko password',
    body: [
      `Use this link to set a new password:`,
      opts.link,
      ``,
      `It works once and expires in an hour. If you didn't ask for this, you can ignore it.`,
    ].join('\n'),
  };
}

export function mentionEmail(opts: {
  actorName: string;
  fileName: string;
  packageName: string;
  excerpt: string;
  link: string;
}): Omit<EmailMessage, 'to'> {
  return {
    subject: `${opts.actorName} mentioned you on ${opts.fileName}`,
    body: [
      `${opts.actorName} mentioned you on ${opts.fileName} in ${opts.packageName}:`,
      ``,
      `"${opts.excerpt}"`,
      ``,
      `Open it here: ${opts.link}`,
    ].join('\n'),
  };
}
