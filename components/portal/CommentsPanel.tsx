'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import type { Comment, CommentAttachment } from '@/lib/types';
import { uploadFile } from '@/lib/uploadAttachment';
import { buildTagNumbers } from '@/lib/tagNumbers';
import { paletteForComment } from '@/lib/commentColors';
import VersionBrief from '@/components/portal/VersionBrief';
import { getInitials } from '@/lib/initials';
import { formatFileSize } from '@/lib/versionDetail';

interface CommentsPanelProps {
  fileId: string | null;
  versionId?: string | null;
  onCommentClick?: (comment: Comment) => void;
  activeCommentId?: string | null;
  refreshKey?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  composer?: React.ReactNode;
  onViewImage?: (url: string) => void;
  onCommentsChanged?: () => void;
  /** A citation chip in the brief was clicked. The comment may live on a
   * different file than the one currently selected, so this is owned by
   * whoever owns `fileId`/`activeCommentId` (the page), not this panel. */
  onSelectCitedComment?: (commentId: string, fileId: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

// ── Attachment previews ────────────────────────────────────

function AttachmentPreview({ attachment, onView }: { attachment: CommentAttachment; onView?: (url: string) => void }) {
  const url = attachment.url ?? '';
  if (isImageType(attachment.contentType)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={attachment.filename}
        className="mt-2 rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity object-cover"
        style={{ maxHeight: 140, maxWidth: '100%' }}
        onClick={(e) => {
          e.stopPropagation();
          if (!url) return;
          if (onView) onView(url);
          else window.open(url, '_blank');
        }}
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
    >
      <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className="truncate flex-1">{attachment.filename}</span>
      <span className="text-gray-400 flex-shrink-0">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

// ── Inline reply / comment form ────────────────────────────

interface CommentFormProps {
  fileId: string;
  parentCommentId?: string | null;
  authorName: string;
  onAuthorChange: (name: string) => void;
  onSubmitted: () => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

function CommentForm({
  fileId,
  parentCommentId,
  authorName,
  onAuthorChange,
  onSubmitted,
  onCancel,
  placeholder = 'Add a comment...',
  autoFocus = false,
}: CommentFormProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) textInputRef.current?.focus();
  }, [autoFocus]);

  const handleSubmit = async () => {
    if (!text.trim() && pendingFiles.length === 0) return;
    setSubmitting(true);
    try {
      // Upload attachments
      let attachments: CommentAttachment[] = [];
      if (pendingFiles.length > 0) {
        setUploading(true);
        attachments = await Promise.all(pendingFiles.map(uploadFile));
        setUploading(false);
      }

      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          content: text.trim() || (attachments.length > 0 ? `Shared ${attachments.length} file${attachments.length > 1 ? 's' : ''}` : ''),
          author: authorName.trim() || 'Anonymous',
          parentCommentId: parentCommentId ?? null,
          attachments,
        }),
      });
      setText('');
      setPendingFiles([]);
      onSubmitted();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  const removeFile = (index: number) => {
    setPendingFiles((f) => f.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {/* Author name (only for top-level, not replies) */}
      {!parentCommentId && (
        <input
          type="text"
          value={authorName}
          onChange={(e) => onAuthorChange(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:bg-white outline-none transition-colors"
        />
      )}

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingFiles.map((file, i) => (
            <div key={i} className="relative group">
              {file.type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="h-14 w-14 rounded-lg object-cover border border-gray-200"
                />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-gray-100 border border-gray-200 flex flex-col items-center justify-center p-1">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-[9px] text-gray-400 truncate w-full text-center mt-0.5">{file.name.split('.').pop()}</span>
                </div>
              )}
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="1.5" y1="1.5" x2="6.5" y2="6.5" /><line x1="6.5" y1="1.5" x2="1.5" y2="6.5" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center gap-1.5">
        <input
          ref={textInputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:bg-white outline-none transition-colors"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />

        {/* Attach file button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Attach file"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) setPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
            e.target.value = '';
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={submitting || (!text.trim() && pendingFiles.length === 0)}
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors"
          title="Send"
        >
          {submitting ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>

        {/* Cancel button (for replies) */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Cancel"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {uploading && (
        <p className="text-xs text-blue-500 flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Uploading files...
        </p>
      )}
    </div>
  );
}

// ── Comment item ───────────────────────────────────────────

function CommentItem({
  comment,
  replies,
  depth,
  isActive,
  onClick,
  fileId,
  authorName,
  onAuthorChange,
  onRefresh,
  onViewImage,
  tagNumber,
  currentUserId,
  onChanged,
}: {
  comment: Comment;
  replies: Comment[];
  depth: number;
  isActive?: boolean;
  onClick?: (comment: Comment) => void;
  fileId: string;
  authorName: string;
  onAuthorChange: (name: string) => void;
  onRefresh: () => void;
  onViewImage?: (url: string) => void;
  tagNumber?: number;
  currentUserId: string | null;
  onChanged?: () => void;
}) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);
  const [busy, setBusy] = useState(false);
  const canModify = !!comment.userId && comment.userId === currentUserId;
  const pal = paletteForComment(comment);
  const attachments = comment.attachments ?? [];
  const hasPosition = comment.xPosition !== null && comment.yPosition !== null;

  const saveEdit = async () => {
    if (!editText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editText.trim() }),
      });
      if (res.ok) { setIsEditing(false); onRefresh(); onChanged?.(); }
    } finally { setBusy(false); }
  };

  const deleteComment = async () => {
    if (busy || !window.confirm('Delete this comment?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      if (res.ok) { onRefresh(); onChanged?.(); }
    } finally { setBusy(false); }
  };

  return (
    <div id={`comment-${comment.id}`} className={`shrink-0 ${hasPosition && onClick ? 'cursor-pointer' : ''}`}>
      <div
        onClick={hasPosition && onClick ? () => onClick(comment) : undefined}
        className="rounded-xl p-[13px] transition-colors"
        style={{ background: '#F6F8FE', borderLeft: `3px solid ${pal.accent}`, outline: isActive ? '2px solid #5B60FF' : 'none' }}
      >
        {/* Header: avatar + name + tag# + time */}
        <div className="flex items-center gap-2 mb-[7px]">
          <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-extrabold flex-shrink-0" style={{ background: pal.swatch, color: pal.dark }}>
            {getInitials(comment.author)}
          </div>
          <span className="font-bold text-[12.5px] text-stiko-ink truncate">{comment.author}</span>
          {tagNumber != null && (
            <span title={`Tag ${tagNumber}`} className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex-shrink-0" style={{ background: pal.swatch, color: pal.dark }}>
              {tagNumber}
            </span>
          )}
          <span className="text-[10px] text-stiko-faint ml-auto flex-shrink-0">{timeAgo(comment.createdAt)}</span>
        </div>

        {/* Body */}
        {isEditing ? (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editText}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setIsEditing(false); }}
              className="w-full rounded-lg border border-stiko-border bg-white px-2.5 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
            <div className="flex items-center gap-2">
              <button onClick={saveEdit} disabled={busy || !editText.trim()} className="text-[11px] font-bold text-white px-3 py-1 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}>Save</button>
              <button onClick={() => { setIsEditing(false); setEditText(comment.content); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary">Cancel</button>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] leading-[1.5] text-[#4A4F63]">{comment.content}</p>
        )}

        {/* Snapshot thumbnail */}
        {comment.snapshotUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={comment.snapshotUrl}
            alt="Annotated snapshot"
            className="mt-2 rounded-lg border border-gray-200 object-cover cursor-pointer hover:opacity-90 transition-opacity"
            style={{ maxHeight: 120, maxWidth: '100%' }}
            onClick={(e) => {
              e.stopPropagation();
              if (onViewImage) onViewImage(comment.snapshotUrl!);
              else window.open(comment.snapshotUrl!, '_blank');
            }}
          />
        )}

        {/* Attachments */}
        {attachments.map((att, i) => (
          <AttachmentPreview key={i} attachment={att} onView={onViewImage} />
        ))}

        {/* Reply button */}
        <div className="mt-1.5 flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); setShowReplyForm((v) => !v); }}
            className="text-[11px] font-bold text-stiko-primary hover:opacity-80 transition-opacity"
          >
            {showReplyForm ? 'Cancel' : 'Reply'}
          </button>
          {canModify && !isEditing && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditText(comment.content); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary transition-colors">Edit</button>
              <button onClick={(e) => { e.stopPropagation(); deleteComment(); }} className="text-[11px] font-semibold text-stiko-muted hover:text-[#B23A52] transition-colors">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Inline reply form */}
      {showReplyForm && (
        <div className="ml-9 mb-3">
          <CommentForm
            fileId={fileId}
            parentCommentId={comment.id}
            authorName={authorName}
            onAuthorChange={onAuthorChange}
            onSubmitted={() => { setShowReplyForm(false); onRefresh(); }}
            onCancel={() => setShowReplyForm(false)}
            placeholder={`Reply to ${comment.author}...`}
            autoFocus
          />
        </div>
      )}

      {/* Replies */}
      {replies.length > 0 && (
        <div className="ml-9 border-l-2 border-stiko-border pl-3">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              replies={[]}
              depth={depth + 1}
              fileId={fileId}
              authorName={authorName}
              onAuthorChange={onAuthorChange}
              onRefresh={onRefresh}
              onViewImage={onViewImage}
              currentUserId={currentUserId}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────

export default function CommentsPanel({ fileId, versionId, onCommentClick, activeCommentId, refreshKey, collapsed, onToggleCollapse, composer, onViewImage, onCommentsChanged, onSelectCitedComment }: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [authorName, setAuthorName] = useState('Anonymous');
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const fetchComments = useCallback(async () => {
    if (!fileId) {
      setComments([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/comments?fileId=${fileId}`);
      const data = await res.json();
      setComments(data);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments, refreshKey]);

  // Scroll to active comment. Also re-runs when `comments` changes (not just
  // `activeCommentId`) because a citation chip for a comment on a different
  // file sets both `fileId` and `activeCommentId` at once: the target's file
  // switches, which starts an async re-fetch here, and the very first run of
  // this effect finds the old file's comments still in the DOM — no element
  // with the new id yet. Re-running once `comments` lands retries against the
  // DOM the new fetch actually produced, without this component needing to
  // know anything about *why* activeCommentId changed.
  useEffect(() => {
    if (activeCommentId) {
      const el = document.getElementById(`comment-${activeCommentId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCommentId, comments]);

  // Build threaded structure
  // File-wide tag numbers (1,2,3…) over positioned comments in fetch order (created_at ASC),
  // matching the numbered pins in the viewport.
  const tagNumbers = buildTagNumbers(comments);

  const topLevelComments = comments.filter((c) => !c.parentCommentId);
  const repliesByParent = comments.reduce<Record<string, Comment[]>>(
    (acc, c) => {
      if (c.parentCommentId) {
        if (!acc[c.parentCommentId]) acc[c.parentCommentId] = [];
        acc[c.parentCommentId].push(c);
      }
      return acc;
    },
    {}
  );

  topLevelComments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Collapsed state
  if (collapsed) {
    return (
      <div className="flex flex-col items-center h-full bg-white rounded-panel shadow-stiko-panel py-3 px-1">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-stiko-subtle transition-colors text-stiko-muted"
          title="Expand comments"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="mt-3 flex flex-col items-center gap-1">
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {comments.length > 0 && (
            <span className="text-xs font-medium text-gray-500">{comments.length}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-panel shadow-stiko-panel overflow-hidden">
      {/* Header */}
      <div className="px-[18px] py-4 border-b border-stiko-border flex items-center justify-between">
        <span className="text-[15px] font-extrabold text-stiko-ink">Comments</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-stiko-primary bg-stiko-tint px-[9px] py-[3px] rounded-[20px]">
            {topLevelComments.length} open
          </span>
          {onToggleCollapse && (
            <button onClick={onToggleCollapse} title="Collapse comments" className="p-1 rounded-lg text-stiko-faint hover:bg-stiko-subtle transition-colors">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto p-[14px] flex flex-col gap-[10px]">
        {versionId && (
          <VersionBrief
            versionId={versionId}
            onSelectComment={(id, commentFileId) => onSelectCitedComment?.(id, commentFileId)}
          />
        )}
        {!fileId ? (
          <p className="text-sm text-stiko-faint text-center py-8">
            Select a file to view comments
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stiko-primary border-t-transparent" />
          </div>
        ) : topLevelComments.length === 0 ? (
          <div className="text-center py-10">
            <svg className="h-10 w-10 text-stiko-border mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm text-stiko-faint">
              No comments yet
            </p>
            <p className="text-xs text-stiko-faint mt-1">
              Use the box below to comment — tap the tag icon to pin it to the file
            </p>
          </div>
        ) : (
          topLevelComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              replies={repliesByParent[comment.id] ?? []}
              depth={0}
              isActive={activeCommentId === comment.id}
              onClick={onCommentClick}
              fileId={fileId}
              authorName={authorName}
              onAuthorChange={setAuthorName}
              onRefresh={fetchComments}
              onViewImage={onViewImage}
              tagNumber={tagNumbers.get(comment.id)}
              currentUserId={currentUserId}
              onChanged={onCommentsChanged}
            />
          ))
        )}
      </div>

      {/* Bottom composer (owned by the portal) */}
      {fileId && composer && (
        <div className="border-t border-stiko-border p-[14px]">{composer}</div>
      )}
    </div>
  );
}
