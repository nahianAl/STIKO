'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { moveValue, nextActive, toggleValue, visibleOptions } from '@/lib/kyc/combo';

export interface ComboOption {
  id: string;
  label: string;
  helper?: string;
  /** Options with the same group sit under one non-selectable header. */
  group?: string;
  synonyms?: readonly string[];
}

interface CommonProps {
  /** DOM id of the trigger: the field's label points at it and errors focus it. */
  id: string;
  labelId: string;
  options: ComboOption[];
  placeholder?: string;
  searchable?: boolean;
  invalid?: boolean;
  /** DOM id of the field's error text, set only while there is an error. */
  describedBy?: string;
  disabled?: boolean;
}
interface SingleProps extends CommonProps { multiple?: false; value: string; onChange: (v: string) => void }
interface MultiProps extends CommonProps {
  multiple: true;
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  /** Label the first tag "Primary" and let tags be reordered (Market). */
  primaryTag?: boolean;
}

/**
 * A dropdown with optional search, group headers and removable tags (spec §6).
 * Keyboard: ArrowUp/Down move, Enter picks, Escape closes this dropdown only,
 * Tab closes and moves on. Tags reorder by drag or by ArrowLeft/Right when focused.
 */
export default function ComboSelect(props: SingleProps | MultiProps) {
  const { id, labelId, options, placeholder = 'Select…', searchable = false, invalid = false, disabled = false, describedBy } = props;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Moving a keyed tag to the right makes React re-insert the focused node, which
  // drops focus. Remember which tag was moving and hand focus back after the render.
  const tagRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const refocusTag = useRef<string | null>(null);

  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const max = props.multiple ? props.max ?? Infinity : 1;
  const shown = useMemo(() => visibleOptions(options, query), [options, query]);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  useEffect(() => {
    if (!open) setQuery('');
    else if (searchable) searchRef.current?.focus();
  }, [open, searchable]);
  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, listId]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  useEffect(() => {
    const tag = refocusTag.current;
    if (!tag) return;
    refocusTag.current = null;
    const el = tagRefs.current[tag];
    if (el && document.activeElement !== el) el.focus();
  });

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (optId: string) => {
    if (props.multiple) props.onChange(toggleValue(props.value, optId, max));
    else {
      props.onChange(optId);
      close();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Mid-IME-composition (keyCode 229 covers Safari): Enter confirms the candidate,
    // arrows move through candidates. None of it is ours, but an Escape must not
    // reach an enclosing drawer either.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      }
      return;
    }
    const nav = e.key === 'ArrowDown' || e.key === 'ArrowUp' || (!searchable && (e.key === 'Home' || e.key === 'End'));
    if (nav) {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => nextActive(a, shown.length, e.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'));
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      const o = shown[active];
      if (o) choose(o.id);
      return;
    }
    if (e.key === 'Escape' && open) {
      // Close this dropdown only, never the page or a dialog around it. App Router
      // hydrates React onto `document`, the same node a Drawer's keydown listener
      // sits on, so stopPropagation alone would not reach it.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      close();
      return;
    }
    if (e.key === 'Tab') setOpen(false);
  };

  const summary = props.multiple
    ? props.value.length >= max ? `${max} selected` : placeholder
    : byId.get(props.value)?.label ?? placeholder;
  const hasValue = props.multiple ? false : Boolean(props.value);

  let lastGroup: string | undefined;
  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;
  // The search box holds focus while open, so the field shows its focus ring itself.
  const fieldBorder = open
    ? 'border-stiko-primary shadow-stiko-focus'
    : invalid
      ? 'border-note-red-accent'
      : 'border-stiko-divider';

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex min-h-[40px] flex-wrap items-center gap-[6px] rounded-[10px] border-[1.5px] bg-white px-[10px] py-[5px] transition focus-within:border-stiko-primary focus-within:shadow-stiko-focus ${fieldBorder} ${
          disabled ? 'opacity-50' : ''
        }`}
      >
        {props.multiple &&
          props.value.map((v, i) => {
            const multi = props as MultiProps;
            const reorder = Boolean(multi.primaryTag) && multi.value.length > 1 && !disabled;
            const name = byId.get(v)?.label ?? v;
            const moveTag = (to: number) => {
              const next = moveValue(multi.value, i, to);
              if (next === multi.value) return;
              refocusTag.current = v;
              multi.onChange(next);
            };
            return (
              <span
                key={v}
                ref={(el) => {
                  tagRefs.current[v] = el;
                }}
                role={reorder ? 'group' : undefined}
                tabIndex={reorder ? 0 : -1}
                draggable={reorder}
                onDragStart={(e) => {
                  // Firefox only starts a drag when the event carries some data. A custom
                  // type, not text/plain, so a drop outside the tags is never read as text
                  // (typed into an input, or opened as a URL).
                  e.dataTransfer.setData('application/x-stiko-tag', name);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragFrom(i);
                }}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => reorder && e.preventDefault()}
                onDrop={(e) => {
                  // Without this Firefox's default for a dropped item is to navigate away.
                  e.preventDefault();
                  if (dragFrom !== null) multi.onChange(moveValue(multi.value, dragFrom, i));
                  setDragFrom(null);
                }}
                onKeyDown={(e) => {
                  // Arrow keys from the remove button inside the tag are not reorder keys.
                  if (!reorder || e.target !== e.currentTarget) return;
                  if (e.key === 'ArrowLeft') { e.preventDefault(); moveTag(i - 1); }
                  if (e.key === 'ArrowRight') { e.preventDefault(); moveTag(i + 1); }
                }}
                aria-label={reorder ? `${name}${i === 0 ? ', primary' : ''}. Use left and right arrows to reorder.` : undefined}
                className="inline-flex items-center gap-[5px] rounded-full bg-stiko-app px-[9px] py-[3px] text-[12.5px] font-semibold text-stiko-ink outline-none focus-visible:shadow-stiko-focus"
              >
                {multi.primaryTag && i === 0 && (
                  <span className="rounded-full bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[6px] text-[10.5px] font-bold text-white">
                    Primary
                  </span>
                )}
                {name}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    multi.onChange(multi.value.filter((x) => x !== v));
                    // The tag is about to unmount; keep keyboard focus in this field.
                    triggerRef.current?.focus();
                  }}
                  aria-label={`Remove ${name}`}
                  className="text-stiko-muted hover:text-stiko-ink"
                >
                  ×
                </button>
              </span>
            );
          })}
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-activedescendant={searchable ? undefined : activeId}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKeyDown}
          className={`min-w-[120px] flex-1 py-[4px] text-left text-[13.5px] outline-none ${
            hasValue ? 'text-stiko-ink' : 'text-stiko-faint'
          }`}
        >
          {summary}
          <span aria-hidden="true" className="float-right text-stiko-muted">▾</span>
        </button>
      </div>

      {open && (
        <div
          // A press anywhere in the popover but the search box must not pull focus off
          // the field: key handlers would go dead and Escape would reach a drawer.
          onMouseDown={(e) => {
            if (e.target !== searchRef.current) e.preventDefault();
          }}
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-[10px] border-[1.5px] border-stiko-divider bg-white shadow-lg"
        >
          {searchable && (
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              aria-label="Search"
              aria-controls={listId}
              aria-activedescendant={activeId}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type to search"
              className="w-full border-b border-stiko-divider px-3 py-2 text-[13.5px] text-stiko-ink outline-none placeholder:text-stiko-faint"
            />
          )}
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            aria-multiselectable={props.multiple || undefined}
            className="max-h-[280px] overflow-y-auto py-1"
          >
            {shown.length === 0 && <li className="px-3 py-2 text-[13px] text-stiko-muted">No matches</li>}
            {shown.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const isSelected = selected.includes(o.id);
              const isDisabled = !isSelected && props.multiple === true && selected.length >= max;
              return (
                <React.Fragment key={o.id}>
                  {header && (
                    <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-stiko-faint">
                      {header}
                    </li>
                  )}
                  <li
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={isDisabled || undefined}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => !isDisabled && choose(o.id)}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-[7px] text-[13.5px] ${
                      i === active ? 'bg-stiko-app' : ''
                    } ${isDisabled ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    {props.multiple && (
                      <span aria-hidden="true" className={`mt-[3px] inline-block h-[14px] w-[14px] shrink-0 rounded-[4px] border-[1.5px] ${
                        isSelected ? 'border-stiko-primary bg-stiko-primary' : 'border-stiko-divider'
                      }`} />
                    )}
                    <span className="min-w-0">
                      <span className={`block ${isSelected ? 'font-bold text-stiko-ink' : 'text-stiko-ink'}`}>{o.label}</span>
                      {o.helper && <span className="block text-[12px] text-stiko-muted">{o.helper}</span>}
                    </span>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
