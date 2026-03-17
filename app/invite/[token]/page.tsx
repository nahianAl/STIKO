'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface InviteInfo {
  token: string;
  portalId: string;
  role: string;
  email: string;
  portalName: string;
  projectName: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { status } = useSession();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setInvite(data);
      });
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    const res = await fetch(`/api/invite/${token}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      router.push(data.redirectPath);
    } else {
      setError(data.error ?? 'Failed to accept invite');
      setAccepting(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <Link href="/" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">You&apos;re invited</h1>
        <p className="text-sm text-gray-500 mb-6">
          Join <span className="font-medium text-gray-800">{invite.portalName}</span> in{' '}
          <span className="font-medium text-gray-800">{invite.projectName}</span> as{' '}
          <span className="capitalize font-medium text-gray-800">{invite.role}</span>
        </p>

        {status === 'unauthenticated' ? (
          <div className="space-y-2">
            <Link
              href={`/login?callbackUrl=/invite/${token}`}
              className="block w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Sign in to accept
            </Link>
            <Link
              href={`/signup?callbackUrl=/invite/${token}`}
              className="block w-full rounded-lg border border-gray-300 text-gray-700 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Create account &amp; accept
            </Link>
          </div>
        ) : (
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {accepting ? 'Joining...' : `Accept as ${invite.role}`}
          </button>
        )}
      </div>
    </div>
  );
}
