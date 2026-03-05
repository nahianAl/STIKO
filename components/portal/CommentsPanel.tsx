'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';

interface Comment {
  id: string;
  fileId: string;
  parentCommentId: string | null;
  content: string;
  xPosition: number | null;
  yPosition: number | null;
  author: string;
  createdAt: string;
}

interface CommentsPanelProps {
  fileId: string | null;
  onCommentClick?: (comment: Comment) => void;
  activeCommentId?: string | null;
  refreshKey?: number;
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

function CommentItem({
  comment,
  replies,
  depth,
  isActive,
  onClick,
}: {
  comment: Comment;
  replies: Comment[];
  depth: number;
  isActive?: boolean;
  onClick?: (comment: Comment) => void;
}) {
  const hasPosition = comment.xPosition !== null && comment.yPosition !== null;
  return (
    <div
      id={`comment-${comment.id}`}
      className={`${depth > 0 ? 'ml-4 border-l-2 border-gray-100 pl-3' : ''} ${
        isActive ? 'bg-blue-50 rounded' : ''
      } ${hasPosition && onClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
      onClick={hasPosition && onClick ? () => onClick(comment) : undefined}
    >
      <div className="py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-900">
            {comment.author}
          </span>
          {hasPosition && (
            <svg
              className="h-3 w-3 text-blue-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          )}
          <span className="text-xs text-gray-400">
            {timeAgo(comment.createdAt)}
          </span>
        </div>
        <p className="text-sm text-gray-700">{comment.content}</p>
      </div>
      {replies.map((reply) => (
        <CommentItem key={reply.id} comment={reply} replies={[]} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function CommentsPanel({ fileId, onCommentClick, activeCommentId, refreshKey }: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [authorName, setAuthorName] = useState('Anonymous');
  const [submitting, setSubmitting] = useState(false);

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

  // Scroll to active comment
  useEffect(() => {
    if (activeCommentId) {
      const el = document.getElementById(`comment-${activeCommentId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCommentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !fileId) return;
    setSubmitting(true);
    try {
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId,
          content: newComment.trim(),
          author: authorName.trim() || 'Anonymous',
        }),
      });
      setNewComment('');
      await fetchComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Build threaded structure
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

  // Sort by date ascending
  topLevelComments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">
          Comments{' '}
          <span className="text-gray-400 font-normal">
            ({comments.length})
          </span>
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {!fileId ? (
          <p className="text-sm text-gray-400 text-center py-8">
            Select a file to view comments
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : topLevelComments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No comments yet
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {topLevelComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                replies={repliesByParent[comment.id] ?? []}
                depth={0}
                isActive={activeCommentId === comment.id}
                onClick={onCommentClick}
              />
            ))}
          </div>
        )}
      </div>

      {fileId && (
        <div className="border-t border-gray-200 p-3">
          <form onSubmit={handleSubmit}>
            <div className="mb-2">
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
              />
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !newComment.trim()}
              >
                {submitting ? '...' : 'Send'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
