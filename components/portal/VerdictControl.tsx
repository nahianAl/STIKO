'use client';

import React, { useState } from 'react';
import { Avatar, StatusChip } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';
import { approvalSummary, type VersionStatus, type Verdict } from '@/lib/status';
import { NOTES } from '@/lib/design';

/**
 * Recording a verdict.
 *
 * 01 specifies that version status is derived from per-reviewer verdicts, but
 * the handoff never designs the control that PRODUCES one — no screen carries an
 * approve / request-changes button. This is that control, built from the
 * existing primitives and placed in the comments-panel header where a reviewer
 * finishes their pass.
 *
 * A viewer never sees it: a verdict is a review action, and their role is
 * view-only.
 */
export function VerdictControl({
  versionId,
  status,
  verdicts,
  requiredReviewers,
  myVerdict,
  canVote,
  onChanged,
}: {
  versionId: string;
  status: VersionStatus;
  verdicts: { userId: string; name: string; verdict: Verdict }[];
  requiredReviewers: number;
  myVerdict: Verdict | null;
  canVote: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const record = async (verdict: Verdict) => {
    setBusy(true);
    const res = await fetch('/api/verdicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId, verdict }),
    });
    setBusy(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error ?? 'Could not record your verdict');
      return;
    }

    toast(
      verdict === 'approved' ? 'Approved' : 'Changes requested',
      // Reversible, so it offers Undo instead of a confirm up front.
      myVerdict
        ? undefined
        : {
            label: 'Undo',
            onClick: async () => {
              await fetch('/api/verdicts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  versionId,
                  verdict: verdict === 'approved' ? 'changes_requested' : 'approved',
                }),
              });
              onChanged();
            },
          }
    );
    onChanged();
  };

  return (
    <div className="border-b border-stiko-border px-[18px] py-3">
      <div className="flex items-center justify-between gap-2">
        <StatusChip status={status} />
        {requiredReviewers > 0 && (
          <span className="text-[11px] text-stiko-faint">
            {approvalSummary(
              verdicts.map((v) => v.verdict),
              requiredReviewers
            )}
          </span>
        )}
      </div>

      {verdicts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-[6px]">
          {verdicts.map((v) => (
            <span
              key={v.userId}
              title={`${v.name} ${v.verdict === 'approved' ? 'approved' : 'requested changes'}`}
              className="flex items-center gap-1 rounded-pill px-[6px] py-[3px]"
              style={{
                background:
                  v.verdict === 'approved'
                    ? NOTES.green.pastel
                    : NOTES.red.pastel,
              }}
            >
              <Avatar id={v.userId} name={v.name} size={18} />
              <span
                className="text-[10px] font-extrabold"
                style={{
                  color:
                    v.verdict === 'approved'
                      ? NOTES.green.text
                      : NOTES.red.text,
                }}
              >
                {v.verdict === 'approved' ? '✓' : '!'}
              </span>
            </span>
          ))}
        </div>
      )}

      {canVote && (
        <div className="mt-[10px] flex gap-2">
          <VerdictButton
            active={myVerdict === 'approved'}
            disabled={busy}
            onClick={() => record('approved')}
            swatch={NOTES.green}
          >
            Approve
          </VerdictButton>
          <VerdictButton
            active={myVerdict === 'changes_requested'}
            disabled={busy}
            onClick={() => record('changes_requested')}
            swatch={NOTES.red}
          >
            Request changes
          </VerdictButton>
        </div>
      )}
    </div>
  );
}

function VerdictButton({
  active,
  disabled,
  onClick,
  swatch,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  swatch: { pastel: string; text: string };
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded-[9px] px-2 py-[7px] text-[11.5px] font-bold transition disabled:opacity-50"
      style={{
        background: active ? swatch.pastel : '#fff',
        color: active ? swatch.text : '#5A6076',
        border: `1.5px solid ${active ? swatch.pastel : '#D3D8E6'}`,
      }}
    >
      {children}
    </button>
  );
}
