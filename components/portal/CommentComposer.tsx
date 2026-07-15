'use client';

import React, { useRef, useMemo, useEffect } from 'react';

interface CommentComposerProps {
  authorName: string;
  onAuthorChange: (name: string) => void;
  text: string;
  onTextChange: (t: string) => void;
  pendingFiles: File[];
  onFilesChange: (files: File[]) => void;
  tagging: boolean;
  hasTag: boolean;
  onClearTag: () => void;
  onSubmit: () => void;
  submitting: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}

export default function CommentComposer({
  authorName, onAuthorChange, text, onTextChange, pendingFiles, onFilesChange,
  tagging, hasTag, onClearTag, onSubmit, submitting, inputRef,
}: CommentComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = !!text.trim() || pendingFiles.length > 0 || hasTag;

  const removeFile = (index: number) => onFilesChange(pendingFiles.filter((_, i) => i !== index));

  const filePreviews = useMemo(
    () => pendingFiles.map((file) => ({
      file,
      url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    })),
    [pendingFiles]
  );
  useEffect(() => {
    return () => {
      filePreviews.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
    };
  }, [filePreviews]);

  return (
    <div className="bg-stiko-subtle rounded-xl p-3 flex flex-col gap-[10px]">
      <input
        type="text"
        value={authorName}
        onChange={(e) => onAuthorChange(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-lg border border-stiko-border bg-white px-3 py-1.5 text-xs text-stiko-secondary focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none transition-colors"
      />

      {/* Tag chip */}
      {hasTag && (
        <div className="flex items-center gap-1.5 rounded-lg bg-stiko-tint border border-stiko-primary/30 px-2.5 py-1.5 text-xs text-stiko-primary w-fit">
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
          </svg>
          Tag placed
          <button onClick={onClearTag} className="ml-0.5 text-stiko-primary/50 hover:text-stiko-primary" title="Remove tag">
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
            </svg>
          </button>
        </div>
      )}

      {/* Tagging-armed hint */}
      {tagging && !hasTag && (
        <p className="text-xs text-stiko-primary">Click on the file to drop a tag…</p>
      )}

      {/* Pending file previews */}
      {filePreviews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filePreviews.map(({ file, url }, i) => (
            <div key={i} className="relative group">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={file.name} className="h-14 w-14 rounded-lg object-cover border border-stiko-border" />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-white border border-stiko-border flex items-center justify-center text-[9px] text-stiko-muted">
                  {file.name.split('.').pop()}
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
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Add a comment…"
        className="w-full rounded-lg border border-stiko-border bg-white px-3 py-2 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none transition-colors"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit(); } }}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) onFilesChange([...pendingFiles, ...Array.from(e.target.files)]); e.target.value = ''; }}
      />

      <div className="flex items-center justify-between">
        {/* Left: pin-to-file status (reflects toolbar Pin/tagging state) + attach */}
        <div className="flex items-center gap-3">
          <span className={`text-[11px] font-semibold ${tagging || hasTag ? 'text-stiko-primary' : 'text-stiko-muted'}`}>
            ◎ Pin to file
          </span>
          <button onClick={() => fileInputRef.current?.click()} className="text-stiko-muted hover:text-stiko-secondary transition-colors" title="Attach file">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          </button>
        </div>
        <button
          onClick={onSubmit}
          disabled={submitting || !canSend}
          className="text-white font-bold text-[12.5px] px-[18px] py-2 rounded-[10px] disabled:opacity-40 transition-[filter] hover:brightness-[0.97]"
          style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
