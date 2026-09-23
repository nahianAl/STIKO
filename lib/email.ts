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

/**
 * The sender address for outbound mail.
 *
 * Deliberately has no fallback. The previous default was
 * `Stiko <noreply@stiko.app>` — a domain Stiko does not own and which does not
 * resolve — so a deploy that lost EMAIL_FROM sent every message from an address
 * Resend cannot verify. Invitations surfaced that through `delivered`; password
 * resets discarded it and told the user to check their inbox.
 *
 * Same contract as lib/appUrl.ts: configuration is mandatory, and a missing
 * value fails loudly rather than producing something plausible that never lands.
 *
 * Must be on the Resend-verified domain, which is stiko.design.
 */
export function emailFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from || !from.trim()) {
    throw new Error(
      'EMAIL_FROM must be configured before Stiko can send email, ' +
        'and must be on the Resend-verified domain (stiko.design).'
    );
  }
  return from.trim();
}

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

  // emailFrom throws by design, but sendEmail's contract is to return a result.
  // app/api/participants/route.ts reads result.delivered to tell the invite UI
  // whether mail actually left; letting this escape would turn a misconfiguration
  // into a 500 on a route that otherwise degrades honestly.
  let from: string;
  try {
    from = emailFrom();
  } catch (err) {
    console.error('[email] no sender configured', err);
    return { delivered: false, reason: 'No sender address configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
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
    `${opts.publisherName} published submission ${opts.versionNumber} of ${opts.packageName}.`,
  ];
  if (note) lines.push(``, `What changed:`, `"${note}"`);
  lines.push(``, `Review it here: ${opts.link}`);

  return {
    subject: `Submission ${opts.versionNumber} of ${opts.packageName} is ready to review`,
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
