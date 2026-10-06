'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  activeMentionQuery,
  filterMentionable,
  insertMention,
  type MentionablePerson,
} from '@/lib/mentions';
import { getInitials } from '@/lib/initials';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Ids of the people picked so far. The server re-checks every one. */
  mentionIds: string[];
  onMentionIdsChange: (ids: string[]) => void;
  people: MentionablePerson[];
  /**
   * Where the list opens. The composer sits at the bottom of the panel, so it
   * opens upward. A reply or edit box sits inside the scrolling thread, where a
   * list above the first comment would be clipped — those open downward.
   */
  placement?: 'above' | 'below';
  inputRef?: React.RefObject<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  autoFocus?: boolean;
  /** Runs for every key the open list did not consume. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** A single-line text input that offers people to mention after an `@`. */
export default function MentionInput({
  value,
  onChange,
  mentionIds,
  onMentionIdsChange,
  people,
  placement = 'below',
  inputRef,
  placeholder,
  className,
  wrapperClassName,
  autoFocus,
  onKeyDown,
}: MentionInputProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // The `@` whose list was picked from or dismissed. Without it, the text right
  // after a pick ("@Jane do it") is itself a query that can match someone else
  // ("Jane Doe"), the list reopens, and Enter picks a person instead of sending.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  // Where the caret belongs after a pick rewrote the text. A controlled input
  // otherwise drops it at the end.
  const pendingCaret = useRef<number | null>(null);

  const active = focused ? activeMentionQuery(value, caret) : null;
  const activeStart = active ? active.start : null;
  const matches =
    active && active.start !== closedAt ? filterMentionable(people, active.query) : [];
  const open = matches.length > 0;
  const current = Math.min(highlight, matches.length - 1);

  // Once the caret has left that `@` behind, forget it, so a later `@` typed at
  // the same index opens normally.
  useEffect(() => {
    if (activeStart === null && closedAt !== null) setClosedAt(null);
  }, [activeStart, closedAt]);

  // An input mounted with autoFocus is focused during mount. Do not depend on
  // that first focus reaching onFocus.
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement === el) {
      setFocused(true);
      setCaret(el.selectionStart ?? el.value.length);
    }
  }, [ref]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value, ref]);

  const syncCaret = (el: HTMLInputElement) => {
    setCaret(el.selectionStart ?? el.value.length);
  };

  const pick = (person: MentionablePerson) => {
    if (!active) return;
    const next = insertMention(value, active.start, caret, person.label);
    pendingCaret.current = next.caret;
    onChange(next.text);
    setCaret(next.caret);
    setClosedAt(active.start);
    if (!mentionIds.includes(person.userId)) {
      onMentionIdsChange([...mentionIds, person.userId]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // An input method uses Enter (and arrows) to choose and commit its own
    // candidates. Leave those keys alone until the composition has ended.
    // keyCode 229 is how Safari reports a key that belongs to a composition.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      onKeyDown?.(e);
      return;
    }
    if (open && active) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((current + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((current - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[current]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // React is hydrated onto `document`, so stopPropagation() would not
        // stop a document-level Escape handler (a drawer, the package page's
        // own shortcuts). Only this does.
        e.nativeEvent.stopImmediatePropagation();
        setClosedAt(active.start);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <input
        ref={ref}
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          syncCaret(e.target);
          setHighlight(0);
        }}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onFocus={(e) => {
          setFocused(true);
          syncCaret(e.currentTarget);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className={`absolute left-0 z-30 w-[240px] max-w-full overflow-hidden rounded-xl border border-stiko-divider bg-white py-1 shadow-stiko-popover ${
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-1'
          }`}
        >
          {matches.map((person, i) => (
            <li
              key={person.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // mousedown, not click, and prevented: a click would blur the
              // input first, which closes the list before the click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(person);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 ${
                i === current ? 'bg-stiko-tint' : ''
              }`}
            >
              <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-stiko-idle text-[9px] font-extrabold text-stiko-secondary">
                {getInitials(person.label)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-stiko-ink">
                  {person.label}
                </span>
                {person.company && (
                  <span className="block truncate text-[11px] text-stiko-muted">
                    {person.company}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
