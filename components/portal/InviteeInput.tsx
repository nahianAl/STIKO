'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { getInitials } from '@/lib/initials';
import { mentionLabel } from '@/lib/mentions';
import { MIN_SUGGEST_QUERY } from '@/lib/peopleSuggest';

interface Suggestion {
  name: string | null;
  email: string;
  company: string | null;
}

/**
 * The invite field: type a name or an email, pick a person you already work
 * with, or just type a new address.
 *
 * A pick only fills the field in. It stays editable afterwards — a suggestion
 * is a default, never a lock. With no matches, or if the lookup fails, this is
 * a plain text box and inviting works exactly as it did.
 */
export default function InviteeInput({
  portalId,
  value,
  onChange,
  className,
}: {
  portalId: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  // The address a pick just wrote into the field. Without it that address is
  // searched in turn, matches the same person, and reopens the list on the row
  // that was just chosen.
  const pickedRef = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_SUGGEST_QUERY || q === pickedRef.current) {
      setSuggestions([]);
      return;
    }
    pickedRef.current = null;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/people/suggest?portalId=${encodeURIComponent(portalId)}&q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      )
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          setSuggestions(Array.isArray(data) ? data : []);
          setHighlight(0);
        })
        .catch(() => {
          // An aborted request was simply outrun by the next keystroke.
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, portalId]);

  const open = focused && suggestions.length > 0;
  const current = Math.min(highlight, suggestions.length - 1);

  const pick = (s: Suggestion) => {
    pickedRef.current = s.email;
    onChange(s.email);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // An input method uses Enter (and arrows) to choose and commit its own
    // candidates. Leave those keys alone until the composition has ended.
    // keyCode 229 is how Safari reports a key that belongs to a composition.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((current + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((current - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(suggestions[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // The modal closes on a document-level Escape listener, and React is
      // hydrated onto `document` too, so stopPropagation() would not stop it.
      // The first Escape closes the list; the next one closes the modal.
      e.nativeEvent.stopImmediatePropagation();
      setSuggestions([]);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        inputMode="email"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Name or email"
        aria-label="Name or email"
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People you work with"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-stiko-divider bg-white py-1 shadow-stiko-popover"
        >
          {suggestions.map((s, i) => {
            const label = mentionLabel(s.name, s.email);
            return (
              <li
                key={s.email}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                // mousedown, not click, and prevented: a click would blur the
                // input first, which closes the list before the click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${
                  i === current ? 'bg-stiko-tint' : ''
                }`}
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-stiko-idle text-[10px] font-extrabold text-stiko-secondary">
                  {getInitials(label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold text-stiko-ink">
                    {label}
                  </span>
                  <span className="block truncate text-[11.5px] text-stiko-muted">
                    {s.company ? `${s.email} · ${s.company}` : s.email}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
