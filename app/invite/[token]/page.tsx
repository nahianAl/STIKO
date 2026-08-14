'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { signIn, useSession, signOut } from 'next-auth/react';
import { LogoMark, Wordmark } from '@/components/ui/Shell';
import Button from '@/components/ui/Button';
import {
  Avatar,
  AvatarStack,
  ErrorBanner,
  Field,
  FileChip,
  Input,
  Note,
  SectionLabel,
  TagChip,
} from '@/components/ui/Primitives';
import { PasswordStrength } from '@/components/auth/AuthShell';
import { InviteProblem } from '@/components/invite/InviteProblem';

interface InviteInfo {
  token: string;
  portalId: string;
  role: 'viewer' | 'commenter' | 'uploader';
  /** Null for a share link, which is addressed to nobody in particular. */
  email: string | null;
  /** A share link: reusable, so this page must not assume a fixed identity. */
  multiUse: boolean;
  packageName: string;
  projectName: string;
  inviterName: string;
  inviterEmail: string | null;
  inviterId: string;
  version: {
    versionNumber: number;
    changelog: string | null;
    publishedAt: string | null;
  } | null;
  files: { id: string; filename: string }[];
  others: { id: string; name: string }[];
}

const ROLE_LABEL: Record<string, string> = {
  viewer: 'Viewer',
  commenter: 'Commenter',
  uploader: 'Uploader',
};

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status, data: session } = useSession();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) setInvite(d);
        else setProblem(d.error ?? 'not_found');
      })
      .catch(() => setProblem('not_found'));
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    const res = await fetch(`/api/invite/${token}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      router.push(data.redirectPath);
    } else {
      setError(data.error ?? 'Could not accept this invitation');
      setAccepting(false);
    }
  };

  if (problem) {
    return (
      <InviteProblem
        kind={problem}
        packageName={invite?.packageName}
        inviterName={invite?.inviterName}
        inviterEmail={invite?.inviterEmail ?? undefined}
      />
    );
  }

  if (!invite || status === 'loading') {
    return <InviteSkeleton />;
  }

  // 2b — already signed in.
  if (status === 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stiko-app px-4 py-10">
        <div className="w-full max-w-[460px] rounded-shell bg-white p-8 shadow-stiko-panel">
          <div className="flex items-center gap-[9px]">
            <LogoMark />
            <Wordmark />
          </div>

          <div className="mt-7 flex items-center gap-[10px]">
            <Avatar id={invite.inviterId} name={invite.inviterName} size={34} />
            <p className="text-[13.5px] text-stiko-secondary">
              <b className="text-stiko-ink">{invite.inviterName}</b> invited you
              to review
            </p>
          </div>

          <h1 className="mt-4 text-[23px] font-extrabold leading-tight tracking-title text-stiko-ink">
            {invite.packageName}
          </h1>

          <div className="mt-2 flex items-center gap-2">
            <span className="text-[13px] text-stiko-muted">
              {invite.projectName}
            </span>
            <span className="text-stiko-crumb">·</span>
            <TagChip tag={ROLE_LABEL[invite.role]} />
          </div>

          <WaitingSummary invite={invite} compact />

          {error && (
            <div className="mt-4">
              <ErrorBanner>{error}</ErrorBanner>
            </div>
          )}

          <div className="mt-6">
            <Button
              fullWidth
              onClick={accept}
              disabled={accepting}
              className="!py-3"
            >
              {accepting
                ? 'Opening…'
                : `Start reviewing as ${ROLE_LABEL[invite.role]}`}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11.5px] text-stiko-faint">
            <Avatar
              id={session?.user?.id ?? 'me'}
              name={session?.user?.name ?? session?.user?.email ?? '?'}
              size={22}
            />
            <span>Signed in as {session?.user?.email}</span>
            <span className="text-stiko-crumb">·</span>
            <button
              // Preserve the token across the sign-out, so switching to the
              // right account does not lose the invitation.
              onClick={() => signOut({ callbackUrl: `/invite/${token}` })}
              className="font-bold text-stiko-primary hover:text-stiko-primary-hover"
            >
              Switch
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2a — not signed in. Auth happens INSIDE the invitation, so acceptance is a
  // side effect of signing in and cannot be dropped by a redirect.
  return <InviteAuth invite={invite} onAccepted={accept} />;
}

/* -------------------------------------------------------------------------- */

function WaitingSummary({
  invite,
  compact = false,
}: {
  invite: InviteInfo;
  compact?: boolean;
}) {
  if (!invite.version) {
    return (
      <div className="mt-5 rounded-panel bg-stiko-app p-4">
        <SectionLabel>Waiting for you</SectionLabel>
        <p className="mt-2 text-[12.5px] text-stiko-muted">
          No files have been published yet — you&apos;ll get an email when the
          first version lands.
        </p>
      </div>
    );
  }

  const shown = invite.files.slice(0, 3);
  const extra = invite.files.length - shown.length;

  return (
    <div
      className={`mt-5 rounded-panel p-4 ${compact ? 'bg-stiko-app' : 'bg-white shadow-stiko-panel'}`}
    >
      <div className="flex items-center justify-between">
        <SectionLabel>Waiting for you</SectionLabel>
        <span className="rounded-pill bg-stiko-tint px-2 py-[3px] text-[10px] font-extrabold text-stiko-primary">
          V{invite.version.versionNumber}
          {invite.version.publishedAt
            ? ` · ${new Date(invite.version.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
            : ''}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-[7px]">
        {shown.map((f) => (
          <div key={f.id} className="flex min-w-0 items-center gap-[10px]">
            <FileChip filename={f.filename} />
            <span className="truncate text-[12.5px] font-semibold text-stiko-ink">
              {f.filename}
            </span>
          </div>
        ))}
        {extra > 0 && (
          <span className="text-[11.5px] text-stiko-muted">
            + {extra} more file{extra === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {invite.version.changelog && (
        <p className="mt-3 border-t border-stiko-border pt-3 text-[12.5px] leading-[1.5] text-stiko-secondary">
          “{invite.version.changelog}”
        </p>
      )}
    </div>
  );
}

function InviteAuth({
  invite,
  onAccepted,
}: {
  invite: InviteInfo;
  onAccepted: () => void;
}) {
  const [tab, setTab] = useState<'create' | 'signin'>('create');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // An email invite names its recipient and the field is read-only — the whole
  // point is that the account matches who was invited. A share link names
  // nobody, so the visitor supplies their own address.
  const [typedEmail, setTypedEmail] = useState('');
  const email = invite.email ?? typedEmail.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (tab === 'create') {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Could not create your account');
        setLoading(false);
        return;
      }
    }

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(
        tab === 'signin'
          ? 'Invalid password'
          : 'Account created, but sign-in failed. Try the Sign in tab.'
      );
      setLoading(false);
      return;
    }

    onAccepted();
  };

  const firstFile = invite.files[0]?.filename;

  return (
    <div className="flex min-h-screen items-center justify-center bg-stiko-app px-4 py-10">
      <div className="grid w-full max-w-[940px] overflow-hidden rounded-shell bg-white shadow-stiko-panel md:grid-cols-[1fr_400px]">
        {/* Left — context */}
        <div className="flex flex-col gap-[22px] bg-stiko-tint px-9 py-[34px]">
          <div className="flex items-center gap-[9px]">
            <LogoMark />
            <Wordmark />
          </div>

          <div className="flex items-center gap-[10px]">
            <Avatar id={invite.inviterId} name={invite.inviterName} size={34} />
            <p className="text-[13.5px] text-stiko-secondary">
              <b className="text-stiko-ink">{invite.inviterName}</b> invited you
              to review
            </p>
          </div>

          <div>
            <h1 className="text-[26px] font-extrabold leading-tight tracking-title text-stiko-ink">
              {invite.packageName}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[13px] text-stiko-muted">
                {invite.projectName}
              </span>
              <span className="text-stiko-crumb">·</span>
              <TagChip tag={ROLE_LABEL[invite.role]} />
            </div>
          </div>

          <WaitingSummary invite={invite} />

          {invite.others.length > 0 && (
            <div className="mt-auto flex items-center gap-[10px] pt-4">
              <AvatarStack people={invite.others} size={26} ring="#F1F3FF" />
              <span className="text-[12.5px] text-stiko-muted">
                {invite.others.length} other
                {invite.others.length === 1 ? ' is' : 's are'} already reviewing
              </span>
            </div>
          )}
        </div>

        {/* Right — auth */}
        <div className="flex flex-col px-8 py-[34px]">
          <div className="flex rounded-[11px] bg-stiko-app p-1">
            {(['create', 'signin'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-[8px] py-[7px] text-[12.5px] font-bold transition ${
                  tab === t
                    ? 'bg-white text-stiko-ink shadow-stiko-tab'
                    : 'text-stiko-muted hover:text-stiko-ink'
                }`}
              >
                {t === 'create' ? 'Create account' : 'Sign in'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-[15px]">
            {error && <ErrorBanner>{error}</ErrorBanner>}

            {tab === 'create' && (
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                  autoComplete="name"
                  placeholder="Your name"
                />
              </Field>
            )}

            <Field label="Email">
              {invite.email ? (
                <div className="relative">
                  <Input
                    type="email"
                    value={invite.email}
                    readOnly
                    className="bg-stiko-app pr-[104px]"
                  />
                  <span
                    className="absolute right-[10px] top-1/2 -translate-y-1/2 rounded-chip px-[6px] py-[3px] text-[10px] font-bold uppercase"
                    style={{ background: '#EDFFDA', color: '#4B7A28' }}
                  >
                    From invite
                  </span>
                </div>
              ) : (
                <Input
                  type="email"
                  value={typedEmail}
                  onChange={(e) => setTypedEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@email.com"
                />
              )}
            </Field>

            <div>
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={tab === 'create' ? 8 : undefined}
                  autoComplete={
                    tab === 'create' ? 'new-password' : 'current-password'
                  }
                />
              </Field>
              {tab === 'create' && <PasswordStrength password={password} />}
            </div>

            <Button type="submit" fullWidth disabled={loading} className="!py-3">
              {loading
                ? 'One moment…'
                : tab === 'create'
                  ? 'Create account & start reviewing'
                  : 'Sign in & start reviewing'}
            </Button>

            <Note>
              Accepting is automatic — you&apos;ll land on{' '}
              {firstFile ? <b>{firstFile}</b> : 'the package'}, not a dashboard.
            </Note>

            <p className="text-[11.5px] leading-[1.5] text-stiko-faint">
              By continuing you agree to our Terms and Privacy Policy.{' '}
              {invite.email
                ? `This invite is for ${invite.email} and expires in 14 days.`
                : `This is a shared link — anyone with it can join as ${invite.role}. It expires in 14 days.`}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function InviteSkeleton() {
  // 3g: a skeleton in the shape of the answer, so nothing jumps when data lands.
  return (
    <div className="flex min-h-screen items-center justify-center bg-stiko-app px-4">
      <div className="grid w-full max-w-[940px] overflow-hidden rounded-shell bg-white shadow-stiko-panel md:grid-cols-[1fr_400px]">
        <div className="flex flex-col gap-5 bg-stiko-tint px-9 py-[34px]">
          <div className="h-[26px] w-24 rounded-[6px] bg-white/70" />
          <div className="h-[34px] w-52 rounded-[6px] bg-white/70" />
          <div className="h-[120px] rounded-panel bg-white/70" />
        </div>
        <div className="flex flex-col gap-4 px-8 py-[34px]">
          <div className="h-[38px] rounded-[11px] bg-stiko-app" />
          <div className="h-[44px] rounded-[10px] bg-stiko-app" />
          <div className="h-[44px] rounded-[10px] bg-stiko-app" />
          <div className="h-[44px] rounded-[11px] bg-stiko-tint" />
        </div>
      </div>
    </div>
  );
}
