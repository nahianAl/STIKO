'use client';

import { useEffect, type RefObject } from 'react';
import { columnCount, planGlides, type GlidePoint } from '@/lib/gridGlide';

/** The handoff's reflow timing — the same curve the Packages panel opens on. */
const GLIDE_MS = 520;
const GLIDE_EASE = 'cubic-bezier(.32,.72,0,1)';

/**
 * Glides the cards of a reflowing grid to their new cells instead of letting
 * them jump there.
 *
 * Cards opt in with `data-glide="<stable key>"`. The grid must be
 * `position: relative`, so each card's offsetParent is the grid and
 * offsetLeft/offsetTop are grid coordinates that ignore transforms. The grid's
 * scroll container must also set `overflow-anchor: none`, because scroll
 * anchoring in a scrolled container makes the browser adjust `scrollTop` before
 * this hook's ResizeObserver runs, so every glide would start from the wrong
 * place.
 *
 * Why a ResizeObserver rather than a measure-before/after-commit FLIP: the
 * side panels animate `width`, so at commit time nothing has moved yet. The
 * jump happens mid-transition, on whichever frame the column count changes,
 * and only an observer that runs on every frame of the resize sees it. The
 * design prototype's commit-time FLIP never fires for exactly this reason.
 *
 * ResizeObserver callbacks run after layout and before paint, and a new
 * animation applies its first keyframe at once, so the frame that lays a card
 * out in its new cell already paints it at its old spot — no one-frame flash.
 */
export function useGridGlide(gridRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const running = new Map<string, Animation>();

    const cards = () =>
      Array.from(grid.querySelectorAll<HTMLElement>('[data-glide]'));

    const measure = () => {
      const points = new Map<string, GlidePoint>();
      for (const el of cards()) {
        const key = el.dataset.glide;
        if (key) points.set(key, { x: el.offsetLeft, y: el.offsetTop });
      }
      return points;
    };

    const columns = () =>
      columnCount(getComputedStyle(grid).gridTemplateColumns);

    let prev = measure();
    let prevColumns = columns();

    // A filter change or a reload swaps the cards without resizing the grid,
    // which would leave `prev` describing cards that have since moved or gone.
    // MutationObserver callbacks run as a microtask straight after React's
    // commit — before the next layout — so the baseline is retaken before any
    // resize frame can compare against a stale one.
    const mutations = new MutationObserver(() => {
      prev = measure();
      prevColumns = columns();
    });
    mutations.observe(grid, { childList: true });

    const resizes = new ResizeObserver(() => {
      const next = measure();
      const nextColumns = columns();

      if (nextColumns !== prevColumns && !reduceMotion.matches) {
        const byKey = new Map(
          cards().map((el) => [el.dataset.glide ?? '', el] as const)
        );

        // Where each still-gliding card visibly is, relative to its layout.
        // Read BEFORE the cancel below — cancelling drops the transform.
        const inFlight = new Map<string, GlidePoint>();
        running.forEach((animation, key) => {
          const el = byKey.get(key);
          if (!el || animation.playState !== 'running') {
            running.delete(key);
            return;
          }
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          inFlight.set(key, { x: m.m41, y: m.m42 });
        });

        for (const { key, dx, dy } of planGlides(prev, next, true, inFlight)) {
          const el = byKey.get(key);
          if (!el) continue;
          running.get(key)?.cancel();
          const animation = el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'none' },
            ],
            { duration: GLIDE_MS, easing: GLIDE_EASE }
          );
          running.set(key, animation);
          // Drop it once done so a card that unmounts mid-glide is not held
          // until the next column change. cancel() rejects `finished`, hence
          // the no-op rejection handler.
          animation.finished.then(
            () => {
              if (running.get(key) === animation) running.delete(key);
            },
            () => {}
          );
        }
      }

      prev = next;
      prevColumns = nextColumns;
    });
    resizes.observe(grid);

    return () => {
      resizes.disconnect();
      mutations.disconnect();
      running.forEach((animation) => animation.cancel());
    };
  }, [gridRef]);
}
