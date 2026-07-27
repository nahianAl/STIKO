'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import FileDropzone, {
  type FileWithPath,
} from '@/components/ui/FileDropzone';
import { UploadProgressRow } from '@/components/ui/UploadProgress';
import {
  ErrorBanner,
  Field,
  Input,
  Note,
} from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { useUpload } from '@/lib/useUpload';
import { derivePackageName } from '@/lib/design';

type Role = 'viewer' | 'commenter' | 'uploader';

/**
 * 2c — New package.
 *
 * Replaces the old three-step "create project → create portal → go to submit"
 * (gap #4: three consecutive empty rooms before any value). One screen creates
 * project, package, version and invitations.
 */
function NewPackage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const upload = useUpload();

  // When arriving from a project, that project is preselected.
  const presetProjectId = searchParams.get('project');

  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState<string | null>(presetProjectId);
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<Role>('commenter');
  const [changelog, setChangelog] = useState('First version');
  const [phase, setPhase] = useState<'compose' | 'uploading'>('compose');
  const [error, setError] = useState<string | null>(null);
  // Held so a retry that succeeds can still publish the draft it belongs to.
  const [draft, setDraft] = useState<{
    portalId: string;
    versionId: string;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  // "Named automatically from your files — or type your own." Stops guessing as
  // soon as the user types.
  const derived = useMemo(
    () => derivePackageName(files.map((f) => f.path)),
    [files]
  );
  const effectiveName = nameTouched ? name : derived;

  const parsedEmails = emails
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes('@'));

  const create = async () => {
    setError(null);
    if (files.length === 0) {
      setError('Add at least one file.');
      return;
    }
    if (!effectiveName.trim()) {
      setError('Give the package a name.');
      return;
    }

    setPhase('uploading');

    try {
      // 1. Project — defaults to a new one named after the package, so the
      //    project layer never blocks the fast path.
      let targetProject = projectId;
      if (!targetProject) {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: effectiveName.trim() }),
        });
        if (!res.ok) throw new Error('Could not create the project');
        targetProject = (await res.json()).id;
      }

      // 2. Package.
      const pkgRes = await fetch('/api/portals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: effectiveName.trim(),
          projectId: targetProject,
        }),
      });
      if (!pkgRes.ok) throw new Error('Could not create the package');
      const pkg = await pkgRes.json();

      // 3. Draft version.
      const versionRes = await fetch('/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalId: pkg.id }),
      });
      if (!versionRes.ok) throw new Error('Could not start the version');
      const version = await versionRes.json();
      setDraft({ portalId: pkg.id, versionId: version.id });

      // 4. Upload every file in parallel.
      const ok = await upload.start(files, {
        versionId: version.id,
        projectId: targetProject!,
        portalId: pkg.id,
      });

      if (!ok) {
        // Stay on the uploading screen so the failed rows can be retried. The
        // version is still a draft, so reviewers have seen nothing.
        setError(
          'Some files didn’t upload. Retry them — nothing is published until they all land.'
        );
        return;
      }

      await finish(pkg.id, version.id);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('compose');
    }
  };

  /** Publish atomically, then invite, then open the package. */
  const finish = async (portalId: string, versionId: string) => {
    setPublishing(true);
    const publishRes = await fetch('/api/versions/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionId,
        changelog: changelog.trim() || 'First version',
        notify: false, // nobody is on the package yet
      }),
    });
    if (!publishRes.ok) {
      const data = await publishRes.json().catch(() => ({}));
      setError(data.error ?? 'Could not publish the version');
      setPublishing(false);
      return;
    }

    let undelivered = 0;
    for (const email of parsedEmails) {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalId, email, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.emailDelivered) undelivered++;
    }

    if (parsedEmails.length > 0 && undelivered === parsedEmails.length) {
      toast('Package created — copy the invite links to share it');
    } else if (parsedEmails.length > 0) {
      toast('Package created and invitations sent');
    } else {
      toast('Package created');
    }

    router.push(`/portal/${portalId}`);
  };

  const retryFailed = async (path: string) => {
    const ok = await upload.retry(path);
    if (ok) setError(null);
  };

  return (
    <Shell>
      <TopBar
        right={
          <Button variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        }
      />

      <Column width={740}>
        <h1 className="text-[28px] font-extrabold tracking-title text-stiko-ink">
          {phase === 'uploading' && effectiveName
            ? effectiveName
            : 'New package'}
        </h1>
        <p className="mt-1 text-[13px] text-stiko-muted">
          {phase === 'uploading'
            ? `Uploading ${upload.items.length} file${upload.items.length === 1 ? '' : 's'} · ${upload.doneCount} done · this stays open, you can keep working`
            : 'Drop your drawings and we’ll set everything else up.'}
        </p>

        <div className="mt-5 rounded-sheet bg-white p-[22px] shadow-stiko-panel">
          {error && (
            <div className="mb-4">
              <ErrorBanner>{error}</ErrorBanner>
            </div>
          )}

          {phase === 'uploading' ? (
            <div className="flex flex-col gap-4">
              {upload.items.map((item) => (
                <UploadProgressRow
                  key={item.path}
                  item={item}
                  onRetry={retryFailed}
                />
              ))}

              <Note>
                The version is published only when every file lands — a failure
                here never leaves a half-empty V1 for your reviewers.
              </Note>

              {/* Once every retry has landed, the draft still needs
                  publishing — the automatic path already returned. */}
              {upload.allDone && draft && (
                <div className="flex justify-end">
                  <Button
                    disabled={publishing}
                    onClick={() => finish(draft.portalId, draft.versionId)}
                  >
                    {publishing ? 'Publishing…' : 'Publish and open'}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-[18px]">
              <FileDropzone files={files} onFilesChange={setFiles} />

              <Field label="Package name">
                <Input
                  value={effectiveName}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                  placeholder="Named automatically from your files — or type your own"
                />
              </Field>

              <div>
                <span className="mb-[6px] block text-[12px] font-bold text-stiko-secondary">
                  Add to
                </span>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-stiko-app px-3 py-[10px]">
                  <div className="flex min-w-0 items-center gap-2">
                    {projectId ? (
                      <span className="truncate text-[13px] font-semibold text-stiko-ink">
                        {projects.find((p) => p.id === projectId)?.name ??
                          'Existing project'}
                      </span>
                    ) : (
                      <>
                        <span
                          className="rounded-chip px-[6px] py-[3px] text-[10px] font-extrabold uppercase"
                          style={{ background: '#F1F3FF', color: '#5B60FF' }}
                        >
                          New project
                        </span>
                        <span className="truncate text-[12.5px] text-stiko-muted">
                          Same name as the package
                        </span>
                      </>
                    )}
                  </div>

                  {projects.length > 0 && (
                    <select
                      value={projectId ?? ''}
                      onChange={(e) => setProjectId(e.target.value || null)}
                      className="shrink-0 rounded-[8px] border-[1.5px] border-stiko-divider bg-white px-2 py-1 text-[12px] font-semibold text-stiko-ink outline-none focus:border-stiko-primary"
                    >
                      <option value="">New project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <Field
                  label="Invite reviewers"
                  hint="(optional — they get an email)"
                >
                  <Input
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    placeholder="name@company.com, another@company.com"
                  />
                </Field>
                {parsedEmails.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[12px] text-stiko-muted">
                      {parsedEmails.length} invitee
                      {parsedEmails.length === 1 ? '' : 's'} as
                    </span>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as Role)}
                      className="rounded-[8px] border-[1.5px] border-stiko-divider bg-white px-2 py-1 text-[12px] font-semibold capitalize text-stiko-ink outline-none focus:border-stiko-primary"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="commenter">Commenter</option>
                      <option value="uploader">Uploader</option>
                    </select>
                  </div>
                )}
              </div>

              <Field label="What changed" hint="shown on the version">
                <Input
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="First version"
                />
              </Field>
            </div>
          )}
        </div>

        {phase === 'compose' && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[12.5px] text-stiko-faint">
              You can add files and people at any time.
            </span>
            <Button onClick={create} disabled={files.length === 0}>
              Create &amp; send for review
            </Button>
          </div>
        )}
      </Column>
    </Shell>
  );
}

export default function NewPackagePage() {
  return (
    <Suspense>
      <NewPackage />
    </Suspense>
  );
}
