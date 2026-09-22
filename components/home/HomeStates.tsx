'use client';

import Button from '@/components/ui/Button';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import AvatarMenu from '@/components/shell/AvatarMenu';
import { SkeletonBar } from '@/components/ui/Primitives';

/** 3g — the error panel, moved unchanged from app/page.tsx. */
export function HomeError({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <Shell>
      <TopBar right={<AvatarMenu />} />
      <Column width={720}>
        <div className="mt-10 rounded-panel bg-white p-8 text-center shadow-stiko-panel">
          <span
            className="mx-auto flex h-[44px] w-[44px] items-center justify-center rounded-[13px]"
            style={{ background: '#FFE2E2' }}
          >
            <svg
              className="h-5 w-5"
              style={{ color: '#B23A52' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </span>
          <h1 className="mt-4 text-[19px] font-extrabold text-stiko-ink">
            Couldn&apos;t load your packages
          </h1>
          <p className="mt-2 text-[13px] leading-[1.6] text-stiko-muted">
            {message ?? 'Something went wrong on our side.'}
          </p>
          <div className="mt-6">
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </div>
      </Column>
    </Shell>
  );
}

/**
 * A skeleton in the shape of the answer, never a spinner: the bar, two cards,
 * and a rail with three tiles. An error must never render as one of these.
 */
export function HomeSkeleton() {
  return (
    <Shell>
      <TopBar right={<SkeletonBar width={200} height={30} />} />
      <div className="flex min-h-0 flex-1 gap-6 px-1">
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mb-3 pt-1">
            <SkeletonBar width={180} height={22} />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-panel border border-stiko-sheet bg-white p-4 shadow-stiko-card"
                style={{ flex: '1 1 420px', minWidth: 0 }}
              >
                <SkeletonBar width={200} height={18} />
                <div className="mt-3 flex flex-col gap-[6px]">
                  <SkeletonBar width="100%" height={46} />
                  <SkeletonBar width="100%" height={46} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Mirrors ActivityRail's lg:order-first, so the placeholder rail
            sits on the left at lg — without it the skeleton draws the rail
            on the right and the real rail swaps it to the left the moment
            /api/home resolves. */}
        <aside
          className="hidden shrink-0 rounded-panel bg-white p-3 shadow-stiko-panel lg:block lg:order-first"
          style={{ width: 344 }}
        >
          <SkeletonBar width={120} height={18} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <SkeletonBar key={i} width="100%" height={56} />
            ))}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
