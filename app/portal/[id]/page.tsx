'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import Header from '@/components/ui/Header';
import VersionTimeline from '@/components/portal/VersionTimeline';
import FileList from '@/components/portal/FileList';
import CommentsPanel from '@/components/portal/CommentsPanel';
import ViewerContainer from '@/components/viewers/ViewerContainer';
import DrawingTools from '@/components/markup/DrawingTools';
import MarkupOverlay from '@/components/markup/MarkupOverlay';
import type { Comment } from '@/lib/types';

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

type ToolType = 'pointer' | 'comment' | 'freehand' | 'line' | 'arrow' | 'rect';

export default function PortalPage() {
  const params = useParams();
  const portalId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);

  // Drawing tools state
  const [activeTool, setActiveTool] = useState<ToolType>('pointer');
  const [drawingColor, setDrawingColor] = useState('#ef4444');
  const [drawingStrokeWidth, setDrawingStrokeWidth] = useState(4);

  // Comment linking state
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);

  // Comment placement popup state
  const [commentPopup, setCommentPopup] = useState<{
    x: number;
    y: number;
    percentX: number;
    percentY: number;
  } | null>(null);
  const [commentPopupText, setCommentPopupText] = useState('');
  const [commentPopupAuthor, setCommentPopupAuthor] = useState('Anonymous');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Fetch portal details and parent project
  useEffect(() => {
    const fetchPortal = async () => {
      try {
        const res = await fetch(`/api/portals/${portalId}`);
        if (res.ok) {
          const data = await res.json();
          setPortal(data);
          // Fetch parent project for breadcrumbs
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
          setSelectedVersionId(data[0].id);
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

  // Fetch comments for the selected file (for pins)
  const fetchComments = useCallback(async () => {
    if (!selectedFileId) {
      setComments([]);
      return;
    }
    try {
      const res = await fetch(`/api/comments?fileId=${selectedFileId}`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (err) {
      console.error('Failed to fetch comments for pins:', err);
    }
  }, [selectedFileId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments, commentsRefreshKey]);

  const handleSelectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    setSelectedFileId(null);
    setFiles([]);
    setActiveTool('pointer');
    setActiveCommentId(null);
  };

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;

  // Comment placement handler
  const handleCommentPlace = useCallback((percentX: number, percentY: number) => {
    setCommentPopup({ x: percentX, y: percentY, percentX, percentY });
    setCommentPopupText('');
  }, []);

  const handleCommentPopupSubmit = async () => {
    if (!commentPopupText.trim() || !selectedFileId || !commentPopup) return;
    setSubmittingComment(true);
    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: selectedFileId,
          content: commentPopupText.trim(),
          author: commentPopupAuthor.trim() || 'Anonymous',
          xPosition: commentPopup.percentX,
          yPosition: commentPopup.percentY,
        }),
      });
      setCommentPopup(null);
      setCommentPopupText('');
      setCommentsRefreshKey((k) => k + 1);
      await fetchComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  // Comment <-> Pin linkage
  const handleCommentPinClick = useCallback((comment: Comment) => {
    setActiveCommentId(comment.id);
  }, []);

  const handleCommentClick = useCallback((comment: Comment) => {
    setActiveCommentId(comment.id);
  }, []);

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

    return <ViewerContainer file={selectedFile} />;
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
      <Header
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          ...(project ? [{ label: project.name, href: `/project/${project.id}` }] : []),
          { label: portal?.name ?? 'Loading...' },
        ]}
        rightContent={
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
        }
      />

      {/* 3-Panel Layout */}
      <div className="flex-1 grid grid-cols-[280px_1fr_320px] h-[calc(100vh-64px)]">
        {/* Left Panel: Version Timeline */}
        <VersionTimeline
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelectVersion={handleSelectVersion}
        />

        {/* Center Panel: File Viewer with Drawing Tools & Markup Overlay */}
        <div className="flex flex-col h-full overflow-hidden bg-gray-50">
          <FileList
            files={files}
            selectedFileId={selectedFileId}
            onSelectFile={setSelectedFileId}
          />
          <DrawingTools
            activeTool={activeTool}
            onToolChange={setActiveTool}
            color={drawingColor}
            onColorChange={setDrawingColor}
            strokeWidth={drawingStrokeWidth}
            onStrokeWidthChange={setDrawingStrokeWidth}
          />
          <div className="relative flex-1 overflow-hidden">
            {renderFileViewer()}
            {selectedFileId && (
              <MarkupOverlay
                fileId={selectedFileId}
                activeTool={activeTool}
                color={drawingColor}
                strokeWidth={drawingStrokeWidth}
                onCommentPlace={handleCommentPlace}
                comments={comments}
                activeCommentId={activeCommentId}
                onCommentPinClick={handleCommentPinClick}
              />
            )}
            {/* Comment placement popup */}
            {commentPopup && (
              <div
                className="absolute z-30 bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-64"
                style={{
                  left: `${Math.min(commentPopup.x, 70)}%`,
                  top: `${Math.min(commentPopup.y, 70)}%`,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={commentPopupAuthor}
                  onChange={(e) => setCommentPopupAuthor(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs mb-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
                <textarea
                  autoFocus
                  value={commentPopupText}
                  onChange={(e) => setCommentPopupText(e.target.value)}
                  placeholder="Add a comment..."
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-none h-16 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleCommentPopupSubmit();
                    }
                    if (e.key === 'Escape') {
                      setCommentPopup(null);
                    }
                  }}
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => setCommentPopup(null)}
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCommentPopupSubmit}
                    disabled={submittingComment || !commentPopupText.trim()}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submittingComment ? '...' : 'Post'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Comments */}
        <CommentsPanel
          fileId={selectedFileId}
          onCommentClick={handleCommentClick}
          activeCommentId={activeCommentId}
          refreshKey={commentsRefreshKey}
        />
      </div>
    </div>
  );
}
