'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { paletteForKey } from '@/lib/commentColors';
import { initialsFromEmail } from '@/lib/portalFormat';
import ShareModal from './ShareModal';

interface Project { id: string; name: string; createdAt: string }
interface Portal { id: string; projectId: string; name: string; createdAt: string }
interface Participant { id: string; portalId: string; email: string; role: string; createdAt: string }

interface PortalTopBarProps {
  project: Project | null;
  portal: Portal | null;
  participants: Participant[];
  portalId: string;
}

const GRADIENT = 'linear-gradient(135deg, #8094F5, #5B60FF)';

export default function PortalTopBar({ project, portal, participants, portalId }: PortalTopBarProps) {
  const [showParticipants, setShowParticipants] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showParticipants) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowParticipants(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showParticipants]);

  const shown = participants.slice(0, 3);
  const extra = participants.length - shown.length;

  return (
    <div className="h-[52px] flex-shrink-0 bg-white rounded-panel shadow-stiko-panel flex items-center justify-between px-[18px]">
      {/* Left cluster */}
      <div className="flex items-center gap-[14px]">
        <Link href="/" className="flex items-center gap-[9px]">
          <span
            className="w-[26px] h-[26px] rounded-lg flex items-center justify-center"
            style={{ background: GRADIENT }}
          >
            <span className="w-[11px] h-[11px] bg-white rounded-[3px] -rotate-[10deg]" />
          </span>
          <span className="font-extrabold text-[18px] tracking-[-0.02em] text-stiko-ink">Stiko</span>
        </Link>
        <div className="flex items-center gap-2 text-[13px] text-stiko-muted">
          <span>{project?.name ?? '…'}</span>
          <span style={{ color: '#C9CBD6' }}>›</span>
          <span className="text-stiko-ink font-semibold">{portal?.name ?? 'Loading…'}</span>
        </div>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-3">
        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setShowParticipants((s) => !s)}
            className="flex items-center"
            title={`${participants.length} participant${participants.length === 1 ? '' : 's'}`}
          >
            {shown.map((p, i) => {
              const c = paletteForKey(p.email);
              return (
                <span
                  key={p.id}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ background: c.swatch, color: c.dark, marginLeft: i === 0 ? 0 : -9 }}
                >
                  {initialsFromEmail(p.email)}
                </span>
              );
            })}
            {extra > 0 && (
              <span
                className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[11px] font-bold text-stiko-secondary bg-stiko-idle"
                style={{ marginLeft: shown.length ? -9 : 0 }}
              >
                +{extra}
              </span>
            )}
          </button>
          {showParticipants && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-stiko-border bg-white shadow-lg z-50">
              <div className="p-3 border-b border-stiko-border">
                <p className="text-xs font-bold text-stiko-ink">Participants</p>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {participants.length === 0 ? (
                  <p className="p-3 text-xs text-stiko-faint">No participants yet</p>
                ) : (
                  participants.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs border-b border-stiko-border/60 last:border-0">
                      <span className="text-stiko-secondary truncate">{p.email}</span>
                      <span className="text-stiko-faint capitalize ml-2">{p.role}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowShare(true)}
          className="flex items-center gap-2 text-white font-bold text-[13px] px-[18px] py-[10px] rounded-[11px] shadow-stiko-primary transition-[filter] hover:brightness-[0.97]"
          style={{ background: 'linear-gradient(135deg, #8094F5, #5B60FF)' }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share
        </button>
      </div>
      <ShareModal isOpen={showShare} onClose={() => setShowShare(false)} portalId={portalId} />
    </div>
  );
}
