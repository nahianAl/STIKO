'use client';

import React, { useMemo, useState } from 'react';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import FileDropzone, { type FileWithPath } from '@/components/ui/FileDropzone';
import { UploadProgressRow } from '@/components/ui/UploadProgress';
import {
  Avatar,
  ErrorBanner,
  Field,
  Note,
  Textarea,
  Toggle,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { useUpload } from '@/lib/useUpload';

/**
 * 2e — the new-version drawer.
 *
 * Replaces the /portal/[id]/submit route (gap #7: submitting exited the review
 * view). The package stays mounted behind the scrim — no navigation, no reload,
 * no lost zoom or scroll.
 */
export function NewVersionDrawer({
  isOpen,
  onClose,
  portalId,
  projectId,
  packageName,
  nextVersionNumber,
  currentVersionNumber,
  existingFilenames,
  participants,
  openComments,
  latestVersionId,
  onPublished,
}: {
  isOpen: boolean;
  onClose: () => void;
  portalId: string;
  projectId: string;
  packageName: string;
  nextVersionNumber: number;
  currentVersionNumber: number | null;
  /** Used to mark files that supersede one already in the package. */
  existingFilenames: string[];
  participants: { id: string; name: string }[];
  openComments: number;
  /** The package's newest version, drafted from when "Suggest" is clicked. */
  latestVersionId: string | null;
  onPublished: () => void;
}) {
  const { toast } = useToast();
  const upload = useUpload();

  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [changelog, setChangelog] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const existing = useMemo(
    () => new Set(existingFilenames.map((f) => f.toLowerCase())),
    [existingFilenames]
  );

  const itemsWithReplaces = upload.items.map((item) => ({
    ...item,
    replacesVersion: existing.has(item.filename.toLowerCase())
      ? currentVersionNumber
      : null,
  }));

  const reset = () => {
    setFiles([]);
    setChangelog('');
    setError(null);
    setDraftVersionId(null);
    upload.reset();
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  async function suggestChangelog() {
    if (!latestVersionId) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/versions/${latestVersionId}/changelog-draft`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) setDraftError(body.error ?? 'Could not draft a changelog');
      else setChangelog(body.changelog);
    } finally {
      setDrafting(false);
    }
  }

  const publish = async () => {
    setError(null);

    // The note is optional: a self-evident change, or a publish under time
    // pressure, should not be blocked on prose. Files are still required —
    // an empty version is the half-version reviewers must never receive.
    if (files.length === 0) {
      setError('Add at least one file.');
      return;
    }

    setBusy(true);
    try {
      let versionId = draftVersionId;

      if (!versionId) {
        const res = await fetch('/api/versions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portalId }),
        });
        if (!res.ok) throw new Error('Could not start the version');
        versionId = (await res.json()).id as string;
        setDraftVersionId(versionId);
      }

      const ok = await upload.start(files, { versionId, projectId, portalId });
      if (!ok) {
        setError(
          'Some files didn’t upload. Retry them — nothing is published until they all land.'
        );
        setBusy(false);
        return;
      }

      await finishPublish(versionId);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  const finishPublish = async (versionId: string) => {
    const res = await fetch('/api/versions/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionId,
        changelog: changelog.trim() || null,
        notify,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not publish the version');
      setBusy(false);
      return;
    }

    toast(`Version ${nextVersionNumber} published`);
    setBusy(false);
    reset();
    onPublished();
    onClose();
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={close}
      title={`Submit version ${nextVersionNumber}`}
      subtitle={packageName}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Save as draft
          </Button>
          <Button onClick={publish} disabled={busy}>
            {busy ? 'Publishing…' : `Publish version ${nextVersionNumber}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {upload.items.length > 0 ? (
          <div className="flex flex-col gap-4">
            {itemsWithReplaces.map((item) => (
              <UploadProgressRow
                key={item.path}
                item={item}
                onRetry={async (path) => {
                  const ok = await upload.retry(path);
                  if (ok && upload.allDone && draftVersionId) {
                    await finishPublish(draftVersionId);
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <FileDropzone
            files={files}
            onFilesChange={setFiles}
            compact
            title="Drop replacement files"
            hint="Matching filenames are versioned, new ones are added · PDF, DWG, DXF, GLB, STEP, OBJ, STL, images, video"
          />
        )}

        {latestVersionId && (
          <div className="mb-1 flex items-center justify-end gap-2">
            {draftError && <span className="text-xs text-red-600">{draftError}</span>}
            <button
              type="button"
              onClick={suggestChangelog}
              disabled={drafting}
              className="text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
            >
              {drafting ? 'Drafting…' : 'Suggest from open comments'}
            </button>
          </div>
        )}
        <Field label="What changed" hint="optional">
          <Textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            rows={3}
            autoFocus
            className="min-h-[78px]"
            placeholder="Shear tabs added at grid line 4"
          />
        </Field>
        <p className="-mt-3 text-[11.5px] text-stiko-faint">
          Shown on the version and in the notification your reviewers receive.
        </p>

        {participants.length > 0 && (
          <div className="rounded-panel bg-stiko-app p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-stiko-ink">
                Notify {participants.length}{' '}
                {participants.length === 1 ? 'person' : 'people'}
              </span>
              <Toggle
                checked={notify}
                onChange={setNotify}
                label="Notify people on this package"
              />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex items-center">
                {participants.slice(0, 6).map((p, i) => (
                  <span key={p.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <Avatar id={p.id} name={p.name} size={26} ring="#F6F8FE" />
                  </span>
                ))}
              </div>
              <span className="text-[11.5px] text-stiko-muted">
                get an email with your note
              </span>
            </div>
          </div>
        )}

        {openComments > 0 && (
          <Note>
            {openComments} open comment{openComments === 1 ? '' : 's'} on V
            {currentVersionNumber} will carry over and stay pinned to their
            positions.
          </Note>
        )}
      </div>
    </Drawer>
  );
}
