// components/markup/toolbarStyles.ts
// The markup toolbar's visual recipe, shared so that anything floating over the viewport reads
// as part of one family rather than approximating it.

/** Bar and sub-bar share these, so a sub-toolbar is visually the main toolbar cut short. */
export const BAR =
  'flex items-center gap-[4px] h-[46px] px-[6px] rounded-sheet bg-white border border-stiko-border shadow-stiko-panel';

/** Hung off the button that opened it, clear of the bar's bottom edge. */
export const SUB_BAR = 'absolute top-full mt-[13px] left-1/2 -translate-x-1/2';

/**
 * Every slot in the bar: a tinted chip with a light grey edge that lifts off the bar on
 * hover. The scale is on the button and the label on the wrapper, so growing the chip never
 * drags the tooltip with it.
 */
export const SLOT_BASE =
  'relative flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border transition-all duration-150 hover:scale-[1.12] hover:z-10 hover:shadow-[0_5px_12px_-3px_rgba(28,32,48,0.22)]';

export const slot = (active: boolean) =>
  `${SLOT_BASE} ${
    active
      ? 'border-stiko-primary-light bg-stiko-tint text-stiko-primary'
      : 'border-stiko-divider bg-[#F8EDFC]/60 text-stiko-secondary hover:bg-[#F8EDFC] hover:border-stiko-border-strong'
  }`;

const LABEL_BASE =
  'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-[7px] bg-stiko-ink px-2 py-[3px] text-[11px] font-medium leading-none tracking-heading text-white opacity-0 shadow-stiko-sheet transition-opacity duration-100 group-hover:opacity-100';

/** For the toolbar, which sits at the top of the viewport — below is the side with room. */
export const LABEL = `${LABEL_BASE} top-full mt-[9px]`;

/** For the annotation pill, which sits at the bottom — above is the side with room. */
export const LABEL_ABOVE = `${LABEL_BASE} bottom-full mb-[9px]`;
