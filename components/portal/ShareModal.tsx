'use client';

import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';

type Role = 'viewer' | 'commenter' | 'uploader';
const ROLES: Role[] = ['viewer', 'commenter', 'uploader'];
const GRADIENT = 'linear-gradient(135deg, #8094F5, #5B60FF)';

export default function ShareModal({ isOpen, onClose, portalId }: { isOpen: boolean; onClose: () => void; portalId: string }) {
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('commenter');
  const [linkRole, setLinkRole] = useState<Role>('viewer');
  const [busy, setBusy] = useState<'invite' | 'link' | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Who the last invite actually reached, and whether mail really went out.
  // The server sends the invitation itself; this modal used to throw that
  // answer away and tell people to copy a link the recipient had already been
  // emailed. `delivered` is false when no mail provider is configured, and the
  // copy-the-link fallback is the honest thing to show then.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(false);

  // Reset the form each time the modal closes so a stale link/email doesn't reappear on reopen.
  useEffect(() => {
    if (!isOpen) {
      setEmail(''); setInviteLink(null); setShareLink(null);
      setError(null); setBusy(null); setCopied(null);
      setSentTo(null); setDelivered(false);
    }
  }, [isOpen]);

  const createInvite = async (
    emailValue: string,
    role: Role
  ): Promise<{ link: string; emailDelivered: boolean } | null> => {
    try {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalId, email: emailValue, role }),
      });
      if (!res.ok) return null;
      const { token, emailDelivered } = await res.json();
      return {
        link: `${window.location.origin}/invite/${token}`,
        emailDelivered: Boolean(emailDelivered),
      };
    } catch {
      return null;
    }
  };

  const handleInvite = async () => {
    const recipient = email.trim();
    if (!recipient || busy) return;
    setBusy('invite'); setError(null);
    try {
      const result = await createInvite(recipient, inviteRole);
      if (result) {
        setInviteLink(result.link);
        setDelivered(result.emailDelivered);
        setSentTo(recipient);
        setEmail('');
      } else {
        setError('Could not create the invite. Please try again.');
      }
    } finally { setBusy(null); }
  };

  const handleShareLink = async () => {
    if (busy) return;
    setBusy('link'); setError(null);
    try {
      const result = await createInvite('', linkRole);
      if (result) setShareLink(result.link);
      else setError('Could not create the link. Please try again.');
    } finally { setBusy(null); }
  };

  const copy = (value: string, which: string) => {
    navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  };

  const selectCls = 'rounded-lg border border-stiko-border bg-white px-2.5 py-1.5 text-[12.5px] text-stiko-secondary capitalize focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none';
  const linkRow = (value: string, which: string) => (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-stiko-subtle p-2">
      <span className="flex-1 truncate text-[11.5px] text-stiko-secondary">{value}</span>
      <button onClick={() => copy(value, which)} className="text-[11px] font-bold text-stiko-primary hover:opacity-80">{copied === which ? 'Copied!' : 'Copy'}</button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share package">
      <div className="flex flex-col gap-5">
        {/* Invite by email */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-stiko-faint mb-2">Invite someone</p>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
              className="flex-1 rounded-lg border border-stiko-border bg-white px-3 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={selectCls}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button onClick={handleInvite} disabled={!email.trim() || busy === 'invite'} className="text-white font-bold text-[12.5px] px-4 py-1.5 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: GRADIENT }}>
              {busy === 'invite' ? '…' : 'Send'}
            </button>
          </div>

          {sentTo && delivered && (
            <div className="mt-2 rounded-lg px-2.5 py-2 text-[12px] font-semibold" style={{ background: '#EDFFDA', color: '#4B7A28' }}>
              Invite emailed to {sentTo}
            </div>
          )}
          {sentTo && !delivered && (
            <div className="mt-2 rounded-lg px-2.5 py-2 text-[12px] font-semibold" style={{ background: '#FFFCCE', color: '#7A5E00' }}>
              Invite created, but we couldn’t email it — send them this link instead.
            </div>
          )}

          {inviteLink && linkRow(inviteLink, 'invite')}

          <p className="mt-1.5 text-[11px] text-stiko-faint">
            {sentTo && delivered
              ? 'They can use the link above too — it’s the same invitation.'
              : 'We email them the invite link. It expires in 14 days.'}
          </p>
        </div>

        <div className="h-px bg-stiko-border" />

        {/* General share link */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-stiko-faint mb-2">Share a link</p>
          <div className="flex items-center gap-2">
            <select value={linkRole} onChange={(e) => setLinkRole(e.target.value as Role)} className={selectCls}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button onClick={handleShareLink} disabled={busy === 'link'} className="text-white font-bold text-[12.5px] px-4 py-1.5 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: GRADIENT }}>
              {busy === 'link' ? '…' : 'Create link'}
            </button>
          </div>
          {shareLink && linkRow(shareLink, 'link')}
          <p className="mt-1.5 text-[11px] text-stiko-faint">Anyone with the link can sign in and join as {linkRole}.</p>
        </div>

        {error && <p className="text-[12px] font-semibold text-[#B23A52]">{error}</p>}
      </div>
    </Modal>
  );
}
