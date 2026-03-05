'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import VersionTimeline from '@/components/portal/VersionTimeline';
import FileList from '@/components/portal/FileList';
import CommentsPanel from '@/components/portal/CommentsPanel';

interface Portal {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
}

interface FileRecord {
  id: string;
  versionId: string;
  filename: string;
  storageKey: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
}

interface Participant {
  id: string;
  portalId: string;
  email: string;
  role: string;
  createdAt: string;
}

function getFileCategory(fileType: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (fileType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return 'image';
  }
  if (fileType.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi'].includes(ext)) {
    return 'video';
  }
  if (fileType === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (['glb', 'gltf'].includes(ext)) {
    return '3d';
  }
  return 'other';
}

export default function PortalPage() {
  const params = useParams();
  const portalId = params.id as string;

  const [portal, setPortal] = useState<Portal | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);

  // Fetch portal details
  useEffect(() => {
    const fetchPortal = async () => {
      try {
        const res = await fetch(`/api/portals/${portalId}`);
        if (res.ok) {
          const data = await res.json();
          setPortal(data);
        }
      } catch (err) {
        console.error('Failed to fetch portal:', err);
      }
    };
    fetchPortal();
  }, [portalId]);

  // Fetch participants
  useEffect(() => {
    const fetchParticipants = async () => {
      try {
        const res = await fetch(`/api/participants?portalId=${portalId}`);
        const data = await res.json();
        setParticipants(data);
      } catch (err) {
        console.error('Failed to fetch participants:', err);
      }
    };
    fetchParticipants();
  }, [portalId]);

  // Fetch versions and select latest
  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const res = await fetch(`/api/versions?portalId=${portalId}`);
        const data: Version[] = await res.json();
        setVersions(data);
        if (data.length > 0) {
          setSelectedVersionId(data[0].id); // newest first from API
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchVersions();
  }, [portalId]);

  // Fetch files when version changes
  const fetchFiles = useCallback(async (versionId: string) => {
    setFilesLoading(true);
    try {
      const res = await fetch(`/api/files?versionId=${versionId}`);
      const data: FileRecord[] = await res.json();
      setFiles(data);
      if (data.length > 0) {
        setSelectedFileId(data[0].id);
      } else {
        setSelectedFileId(null);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedVersionId) {
      fetchFiles(selectedVersionId);
    }
  }, [selectedVersionId, fetchFiles]);

  const handleSelectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    setSelectedFileId(null);
    setFiles([]);
  };

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;

  const renderFileViewer = () => {
    if (filesLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      );
    }

    if (!selectedFile) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-400">
          <svg className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <p className="text-sm">Select a file to view</p>
        </div>
      );
    }

    const category = getFileCategory(selectedFile.fileType, selectedFile.filename);

    if (category === 'image') {
      return (
        <div className="flex items-center justify-center h-full p-4 overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/${selectedFile.storageKey}`}
            alt={selectedFile.filename}
            className="max-w-full max-h-full object-contain rounded shadow-sm"
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <svg className="h-16 w-16 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm font-medium mb-1">{selectedFile.filename}</p>
        <p className="text-xs text-gray-400">
          {category === 'video' ? 'Video' : category === 'pdf' ? 'PDF' : category === '3d' ? '3D Model' : 'File'} viewer coming soon
        </p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 text-white flex-shrink-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {portal && (
              <Link
                href={`/project/${portal.projectId}`}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
            )}
            <h1 className="text-lg font-bold tracking-tight">
              {portal?.name ?? 'Loading...'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowParticipants(!showParticipants)}
              >
                Participants ({participants.length})
              </Button>
              {showParticipants && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-200 bg-white shadow-lg z-20">
                  <div className="p-3 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-900">
                      Participants
                    </p>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {participants.length === 0 ? (
                      <p className="p-3 text-xs text-gray-400">
                        No participants yet
                      </p>
                    ) : (
                      participants.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between px-3 py-2 text-xs border-b border-gray-50 last:border-0"
                        >
                          <span className="text-gray-700 truncate">
                            {p.email}
                          </span>
                          <span className="text-gray-400 capitalize ml-2">
                            {p.role}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <Link href={`/portal/${portalId}/submit`}>
              <Button size="sm">Submit New Version</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* 3-Panel Layout */}
      <div className="flex-1 grid grid-cols-[280px_1fr_320px] h-[calc(100vh-64px)]">
        {/* Left Panel: Version Timeline */}
        <VersionTimeline
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelectVersion={handleSelectVersion}
        />

        {/* Center Panel: File Viewer */}
        <div className="flex flex-col h-full overflow-hidden bg-gray-50">
          <FileList
            files={files}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
          />
          <div className="flex-1 overflow-hidden">
            {renderFileViewer()}
          </div>
        </div>

        {/* Right Panel: Comments */}
        <CommentsPanel fileId={selectedFileId} />
      </div>
    </div>
  );
}
