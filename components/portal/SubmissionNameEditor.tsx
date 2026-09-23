'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import {
  SUBMISSION_NAME_MAX,
  normalizeSubmissionName,
  submissionTitle,
} from '@/lib/submissionName';
import type { Version } from '@/lib/types';

const FOCUS = 'focus:outline-none focus-visible:shadow-stiko-focus';

/**
 * The expanded view's title, and (for anyone allowed) the control that
 * renames the submission.
 *
 * Nothing is optimistic. The title changes only once the server has stored the
 * name, so a failed save can never leave the rail and the drawer showing a
 * name the database does not have.
 */
export default function SubmissionNameEditor({
  version,
  onRenamed,
}: {
  version: Version;
  /** Called with the name the server stored; null when it went back to the default. */
  onRenamed: (versionId: string, name: string | null) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Set by whichever of Enter, blur or Escape ends the edit first. Enter saves
  // and the input then unmounts, which can fire blur and save a second time;
  // Escape cancels and unmounts, and that blur must not save at all.
  const settled = useRef(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  // Tracks `editing` from the previous render so the focus-return effect only
  // fires on a true→false transition (save, cancel or a failed save), never
  // on first mount, when `editing` starts false and there is nothing to
  // return focus from.
  const wasEditing = useRef(false);

  // Keyboard users who opened the editor land on <body> once it unmounts,
  // outside the dialog, unless focus is put back on the control that opened
  // it.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      renameButtonRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  const start = () => {
    settled.current = false;
    setDraft(version.name ?? '');
    setEditing(true);
  };

  const cancel = () => {
    settled.current = true;
    setEditing(false);
  };

  const save = async () => {
    if (settled.current) return;
    settled.current = true;

    const parsed = normalizeSubmissionName(draft);
    if (!parsed.ok) {
      // Unreachable through the input (maxLength), kept so a bad value is
      // stated rather than silently dropped.
      toast(parsed.error);
      setEditing(false);
      return;
    }
    // Compare what would be STORED, not the raw text: "  Revised " is
    // "Revised", and a blank field is the same as no name.
    if (parsed.name === (version.name ?? null)) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/versions/${version.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: parsed.name }),
      });
      if (!res.ok) throw new Error(`rename failed: ${res.status}`);
      const data: { id: string; name: string | null } = await res.json();
      onRenamed(data.id, data.name);
    } catch {
      toast('Could not rename this submission');
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          // Mid-composition Enter/Escape commits or cancels an IME candidate,
          // not this field: let it through untouched.
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            // App Router mounts React's root listener on `document` itself
            // (see next/dist/client/app-index.js), the same node the
            // Drawer's keydown listener uses, and React's was registered
            // first, at hydration — so this event reaches the Drawer's
            // listener too, not just window. stopPropagation only stops
            // propagation to nodes further up (it still blocks the window
            // listener that would otherwise re-arm a measure gesture once
            // this input unmounts); stopImmediatePropagation is what stops
            // the Drawer's same-node listener from closing the drawer.
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            // A save in flight must finish; Escape must not abandon it or
            // let the input disappear out from under the pending request.
            if (saving) return;
            cancel();
          }
        }}
        // readOnly, not disabled: a disabled input drops focus, and Escape
        // pressed mid-save would then reach the drawer and close it.
        readOnly={saving}
        aria-busy={saving}
        maxLength={SUBMISSION_NAME_MAX}
        placeholder={submissionTitle({ versionNumber: version.versionNumber })}
        aria-label="Submission name"
        className={`-ml-2 -my-[3px] w-[calc(100%+8px)] rounded-[8px] border border-stiko-divider bg-white px-2 py-[2px] text-[17px] font-extrabold text-stiko-ink placeholder:text-stiko-faint ${FOCUS} ${saving ? 'opacity-60' : ''}`}
      />
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <h2 className="min-w-0 break-words text-[17px] font-extrabold text-stiko-ink">
        {submissionTitle(version)}
      </h2>
      {version.canRename && (
        <button
          ref={renameButtonRef}
          type="button"
          onClick={start}
          aria-label="Rename submission"
          title="Rename"
          className={`mt-[3px] flex-shrink-0 rounded-[7px] p-1 text-stiko-faint transition hover:bg-stiko-subtle hover:text-stiko-primary ${FOCUS}`}
        >
          <svg className="h-[14px] w-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      )}
    </div>
  );
}
