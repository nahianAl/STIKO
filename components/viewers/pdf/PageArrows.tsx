'use client';

interface PageArrowsProps {
  canPrev: boolean;
  canNext: boolean;
  /** Page navigation is locked (a markup session with objects in it). */
  disabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}

// Positioned on the VIEWPORT's edges, not the page's, so zooming and panning never move them.
const BUTTON =
  'absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-gray-700 shadow-md ring-1 ring-black/5 transition hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B60FF]';

export default function PageArrows({ canPrev, canNext, disabled, onPrev, onNext }: PageArrowsProps) {
  return (
    <>
      {canPrev && (
        <button type="button" aria-label="Previous page" title="Previous page" onClick={onPrev} disabled={disabled} className={`${BUTTON} left-3`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {canNext && (
        <button type="button" aria-label="Next page" title="Next page" onClick={onNext} disabled={disabled} className={`${BUTTON} right-3`}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </>
  );
}
