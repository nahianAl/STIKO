'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import FileDropzone from '@/components/ui/FileDropzone';
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

export default function SubmitVersionPage() {
  const params = useParams();
  const router = useRouter();
  const portalId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPortal = async () => {
      try {
        const res = await fetch(`/api/portals/${portalId}`);
        if (res.ok) {
          const data = await res.json();
          setPortal(data);
          try {
            const projRes = await fetch(`/api/projects/${data.projectId}`);
            if (projRes.ok) {
              const projData = await projRes.json();
              setProject(projData);
            }
          } catch (projErr) {
            console.error('Failed to fetch project:', projErr);
          }
        }
      } catch (err) {
        console.error('Failed to fetch portal:', err);
      }
    };
    fetchPortal();
  }, [portalId]);

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);

    try {
      // Step 1: Create version
      const versionRes = await fetch('/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalId }),
      });

      if (!versionRes.ok) {
        throw new Error('Failed to create version');
      }

      const version = await versionRes.json();

      // Step 2: Upload files
      const formData = new FormData();
      formData.append('versionId', version.id);
      for (const file of files) {
        formData.append('files', file);
      }

      const uploadRes = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload files');
      }

      // Step 3: Redirect back to portal
      router.push(`/portal/${portalId}`);
    } catch (err) {
      console.error('Submit failed:', err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          ...(project ? [{ label: project.name, href: `/project/${project.id}` }] : []),
          ...(portal ? [{ label: portal.name, href: `/portal/${portalId}` }] : []),
          { label: 'Submit Version' },
        ]}
      />

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">
          Submit New Version
        </h2>

        <FileDropzone files={files} onFilesChange={setFiles} />

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={files.length === 0 || uploading}
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Uploading...
              </span>
            ) : (
              'Submit Version'
            )}
          </Button>
        </div>
      </main>
    </div>
  );
}
