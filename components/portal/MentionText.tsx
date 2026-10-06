import React from 'react';
import { splitMentions, type Mention } from '@/lib/mentions';

/**
 * A comment body with its mentions drawn as pills.
 *
 * With no mentions this renders the text exactly as a bare `{content}` did, so
 * a typed `@something` that was never picked stays plain text.
 */
export default function MentionText({
  content,
  mentions,
  currentUserId,
}: {
  content: string;
  mentions?: Mention[];
  currentUserId: string | null;
}) {
  const segments = splitMentions(content, mentions ?? []);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'text' ? (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ) : (
          <span
            key={i}
            className={`rounded-[5px] px-1 py-px font-semibold ${
              segment.userId === currentUserId
                ? 'bg-stiko-primary text-white'
                : 'bg-stiko-primary/10 text-stiko-primary'
            }`}
          >
            {segment.text}
          </span>
        )
      )}
    </>
  );
}
