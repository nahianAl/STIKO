'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Header from '@/components/ui/Header';

interface Project {
  id: string;
  name: string;
  createdAt: string;
}

interface Portal {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [loading, setLoading] = useState(true);

  // Portal creation
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [newPortalName, setNewPortalName] = useState('');
  const [creatingPortal, setCreatingPortal] = useState(false);

  // Invite participant
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [invitePortalId, setInvitePortalId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'commenter' | 'uploader'>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
      }
    } catch (err) {
      console.error('Failed to fetch project:', err);
    }
  };

  const fetchPortals = async () => {
    try {
      const res = await fetch(`/api/portals?projectId=${projectId}`);
      const data = await res.json();
      setPortals(data);
    } catch (err) {
      console.error('Failed to fetch portals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
    fetchPortals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleCreatePortal = async () => {
    if (!newPortalName.trim()) return;
    setCreatingPortal(true);
    try {
      await fetch('/api/portals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPortalName.trim(), projectId }),
      });
      setNewPortalName('');
      setPortalModalOpen(false);
      await fetchPortals();
    } catch (err) {
      console.error('Failed to create portal:', err);
    } finally {
      setCreatingPortal(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portalId: invitePortalId,
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const data = await res.json();
      const base = window.location.origin;
      // Viewers get the portal link directly; uploaders/commenters get an invite token link
      const link = inviteRole === 'viewer'
        ? `${base}/portal/${invitePortalId}`
        : `${base}/invite/${data.token}`;
      setInviteEmail('');
      setInviteRole('viewer');
      setInviteLink(link);
    } catch (err) {
      console.error('Failed to invite participant:', err);
    } finally {
      setInviting(false);
    }
  };

  const openInviteModal = (portalId: string) => {
    setInvitePortalId(portalId);
    setInviteEmail('');
    setInviteRole('viewer');
    setInviteLink(null);
    setLinkCopied(false);
    setInviteModalOpen(true);
  };

  const handleCopyLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="min-h-screen">
      <Header
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: project?.name ?? 'Loading...' },
        ]}
      />

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold text-gray-900">
            {project?.name ?? 'Loading...'}
          </h2>
          {portals.length > 0 && (
            <Button onClick={() => setPortalModalOpen(true)}>
              + New Portal
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        ) : portals.length === 0 ? (
          <EmptyState
            message="Create your first portal to start collecting feedback"
            actionLabel="Create Portal"
            onAction={() => setPortalModalOpen(true)}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {portals.map((portal) => (
              <div
                key={portal.id}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md hover:border-blue-200 transition-all duration-200"
              >
                <Link href={`/portal/${portal.id}`} className="block mb-3">
                  <h3 className="font-medium text-gray-900 mb-1">
                    {portal.name}
                  </h3>
                  <p className="text-xs text-gray-400">
                    Created{' '}
                    {new Date(portal.createdAt).toLocaleDateString()}
                  </p>
                </Link>
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openInviteModal(portal.id)}
                  >
                    Invite
                  </Button>
                  <Link href={`/portal/${portal.id}`}>
                    <Button variant="secondary" size="sm">
                      Open
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Portal Modal */}
      <Modal
        isOpen={portalModalOpen}
        onClose={() => setPortalModalOpen(false)}
        title="New Portal"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreatePortal();
          }}
        >
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Portal Name
          </label>
          <input
            type="text"
            value={newPortalName}
            onChange={(e) => setNewPortalName(e.target.value)}
            placeholder="Enter portal name"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="secondary"
              onClick={() => setPortalModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creatingPortal || !newPortalName.trim()}
            >
              {creatingPortal ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Invite Participant Modal */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title="Invite Participant"
      >
        {inviteLink ? (
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Participant added. Share this link with them:
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="flex-1 text-xs text-gray-700 truncate font-mono">
                {inviteLink}
              </span>
              <button
                onClick={handleCopyLink}
                className="flex-shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                {linkCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={() => setInviteModalOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleInvite();
            }}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="participant@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(
                      e.target.value as 'viewer' | 'commenter' | 'uploader'
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors bg-white"
                >
                  <option value="viewer">Viewer — can view files and comments</option>
                  <option value="commenter">Commenter — can view and leave comments</option>
                  <option value="uploader">Uploader — can submit new versions</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="secondary"
                onClick={() => setInviteModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
              >
                {inviting ? 'Adding...' : 'Add & Get Link'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
