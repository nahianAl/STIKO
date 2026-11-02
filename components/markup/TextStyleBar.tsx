'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FONT_SIZE_PRESETS,
  TEXT_BAR_GAP,
  TEXT_BAR_ROTATER_GAP,
  TEXT_FILL_SWATCHES,
  clampFontSize,
  placeTextBar,
  type RectLike,
  type TextAlign,
  type TextStyle,
} from '@/lib/markup/text';

const BTN = 'flex h-[28px] min-w-[28px] items-center justify-center rounded-[8px] px-[5px] text-[13px] leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#5B60FF]';
const btn = (active: boolean) => `${BTN} ${active ? 'bg-stiko-tint text-stiko-primary' : 'text-stiko-secondary hover:bg-stiko-subtle'}`;
const MENU = 'absolute top-full mt-[6px] rounded-[10px] border border-stiko-border bg-white p-[4px] shadow-stiko-panel';

const ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

function Divider() {
  return <span aria-hidden className="mx-[3px] h-[18px] w-px bg-stiko-divider" />;
}

function AlignIcon({ align }: { align: TextAlign }) {
  // Three lines; the short middle one hugs the side the text aligns to.
  const mid = align === 'left' ? { x1: 3, x2: 11 } : align === 'right' ? { x1: 7, x2: 15 } : { x1: 5, x2: 13 };
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3" y1="5" x2="15" y2="5" />
      <line x1={mid.x1} y1="9" x2={mid.x2} y2="9" />
      <line x1="3" y1="13" x2="15" y2="13" />
    </svg>
  );
}

/** A fill swatch; '' is drawn as white with a red slash, the usual "none". */
function FillChip({ fill }: { fill: string }) {
  return (
    <span
      className="relative block h-[16px] w-[16px] overflow-hidden rounded-full border border-stiko-border-strong"
      style={{ background: fill || '#FFFFFF' }}
    >
      {!fill && <span className="absolute left-1/2 top-[-2px] h-[20px] w-[1.5px] -translate-x-1/2 rotate-45 bg-[#E5484D]" />}
    </span>
  );
}

const formatSize = (n: number) => String(Math.round(n * 10) / 10);

/** Put the caret back in the open text editor after the size field took focus. */
function refocusEditor() {
  document.querySelector<HTMLTextAreaElement>('[data-markup-text-editor]')?.focus();
}

export interface TextStyleBarProps {
  /** The selection's box, in the pixels of the container this bar is absolutely positioned in. */
  anchor: RectLike;
  /** That container's size, to clamp inside. */
  view: { width: number; height: number };
  /** What the controls show: the primary target text's style. */
  style: TextStyle;
  /** True while a text is open in the editor (no Transformer, so the bar can sit close). */
  editing: boolean;
  /** Applied by the surface to every target text. */
  onChange: (patch: Partial<TextStyle>) => void;
}

/**
 * The floating text bar: size, bold, italic, alignment, fill and border for the selected texts or
 * the one being edited. Plain DOM over the stage. `data-markup-text-chrome` makes CanvasTextEditor
 * treat a press here as inside the editor, and because it is not the canvas, a press here never
 * reaches Konva — so it can neither finish an edit nor start a selection box or a draw.
 */
export default function TextStyleBar({ anchor, view, style, editing, onChange }: TextStyleBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [menu, setMenu] = useState<'size' | 'fill' | null>(null);
  // The size field's text while it has focus; null shows the live size. Mirrored in a ref so
  // Escape-then-blur (both inside one keydown) sees the cleared draft and commits nothing.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Measure after every render: the bar's width depends on nothing it can predict (fonts, the
  // size field's digits). Sets state only on a real change, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s && s.width === w && s.height === h ? s : { width: w, height: h }));
  });

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const writeDraft = (v: string | null) => {
    draftRef.current = v;
    setDraft(v);
  };
  /**
   * Every control but the size field's own typing goes through this. Button presses are
   * preventDefault'ed, so the size field can still hold focus and a draft; left alone, its later
   * blur would commit that stale number over the choice just made.
   */
  const act = (patch: Partial<TextStyle>) => {
    writeDraft(null);
    onChange(patch);
  };

  // A size changed from outside (Cmd+Shift+>, a preset on another surface) while the field is not
  // being typed in: whatever it was holding is stale.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [style.fontSize]);

  // Esc closes an open menu and nothing else (it must not finish the edit). Capture on the
  // document, because focus is usually in the editor's textarea, which would commit on Esc.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [menu]);
  const commitDraft = () => {
    const d = draftRef.current;
    writeDraft(null);
    if (d === null) return;
    const n = parseFloat(d);
    if (Number.isFinite(n)) onChange({ fontSize: clampFontSize(n) });
  };

  // The bar can unmount with a size typed but not committed — the click on empty canvas that
  // deselects the text takes the bar away before the field's blur. Commit it on the way out,
  // through the last onChange this bar was given (bound to the texts it was showing).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => () => {
    const d = draftRef.current;
    draftRef.current = null;
    if (d === null) return;
    const n = parseFloat(d);
    if (Number.isFinite(n)) onChangeRef.current({ fontSize: clampFontSize(n) });
  }, []);

  // A selection shows Konva's rotate handle 50px above the box; the bar clears it rather than
  // covering it. While editing there is no Transformer, so it comes in close.
  const pos = size ? placeTextBar(anchor, size, view, editing ? TEXT_BAR_GAP : TEXT_BAR_ROTATER_GAP) : null;

  return (
    <div
      ref={ref}
      data-markup-text-chrome=""
      role="toolbar"
      aria-label="Text style"
      className="absolute z-40 flex h-[38px] items-center gap-[2px] rounded-[12px] border border-stiko-border bg-white px-[5px] shadow-stiko-panel select-none"
      // Hidden, not absent, until measured: placing needs the bar's own size.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      // Buttons must not take focus from the text being edited — the caret stays in the editor
      // while you restyle. The size field is the one control that needs focus.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          aria-label="Font size"
          type="number"
          min={6}
          max={400}
          step={1}
          value={draft ?? formatSize(style.fontSize)}
          onFocus={(e) => {
            writeDraft(formatSize(style.fontSize));
            e.currentTarget.select();
          }}
          onChange={(e) => writeDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
              e.currentTarget.blur();
              if (editing) refocusEditor();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              // React is hydrated onto `document`; the bar's stopPropagation does not stop the
              // portal Drawer's own document Escape listener. Only this does.
              e.nativeEvent.stopImmediatePropagation();
              writeDraft(null);
              e.currentTarget.blur();
              if (editing) refocusEditor();
            }
          }}
          className="h-[28px] w-[46px] rounded-[8px] border border-stiko-divider bg-white px-[6px] text-[13px] text-stiko-ink outline-none [appearance:textfield] focus:border-stiko-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="Font size presets"
          aria-haspopup="menu"
          aria-expanded={menu === 'size'}
          className={btn(menu === 'size')}
          onClick={() => setMenu(menu === 'size' ? null : 'size')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5 5 6.5 8 3.5" />
          </svg>
        </button>
        {menu === 'size' && (
          <div role="menu" aria-label="Font size presets" className={`${MENU} left-0 flex flex-col`}>
            {FONT_SIZE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={style.fontSize === p}
                className={`${btn(style.fontSize === p)} w-[56px] justify-start px-[10px]`}
                onClick={() => {
                  act({ fontSize: p });
                  setMenu(null);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      <Divider />

      <button type="button" aria-label="Bold" aria-pressed={style.bold} className={`${btn(style.bold)} font-bold`} onClick={() => act({ bold: !style.bold })}>
        B
      </button>
      <button type="button" aria-label="Italic" aria-pressed={style.italic} className={`${btn(style.italic)} font-serif italic`} onClick={() => act({ italic: !style.italic })}>
        I
      </button>

      <Divider />

      {ALIGNS.map((a) => (
        <button key={a} type="button" aria-label={`Align ${a}`} aria-pressed={style.align === a} className={btn(style.align === a)} onClick={() => act({ align: a })}>
          <AlignIcon align={a} />
        </button>
      ))}

      <Divider />

      <div className="relative flex">
        <button type="button" aria-label="Fill" aria-haspopup="menu" aria-expanded={menu === 'fill'} className={btn(menu === 'fill')} onClick={() => setMenu(menu === 'fill' ? null : 'fill')}>
          <FillChip fill={style.fill} />
        </button>
        {menu === 'fill' && (
          <div role="menu" aria-label="Fill" aria-orientation="horizontal" className={`${MENU} left-1/2 flex -translate-x-1/2 gap-[2px]`}>
            <button
              type="button"
              role="menuitemradio"
              aria-label="No fill"
              aria-checked={!style.fill}
              className={btn(!style.fill)}
              onClick={() => {
                act({ fill: '' });
                setMenu(null);
              }}
            >
              <FillChip fill="" />
            </button>
            {TEXT_FILL_SWATCHES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="menuitemradio"
                aria-label={`${s.label} fill`}
                aria-checked={style.fill === s.value}
                className={btn(style.fill === s.value)}
                onClick={() => {
                  act({ fill: s.value });
                  setMenu(null);
                }}
              >
                <FillChip fill={s.value} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" aria-label="Border" aria-pressed={style.border} className={btn(style.border)} onClick={() => act({ border: !style.border })}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3.5" y="4.5" width="11" height="9" rx="1.5" />
        </svg>
      </button>
    </div>
  );
}
