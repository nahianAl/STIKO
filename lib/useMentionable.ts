'use client';

import { useEffect, useState } from 'react';
import type { MentionablePerson } from '@/lib/mentions';

/**
 * Who can be @mentioned on a file. Empty while loading, for a null file, and
 * on any failure — in all three the comment inputs behave exactly as they did
 * before mentions existed.
 *
 * `refreshKey` re-fetches without clearing, for when the roster changes under
 * an open package.
 */
export function useMentionable(
  fileId: string | null,
  refreshKey = 0
): MentionablePerson[] {
  const [people, setPeople] = useState<MentionablePerson[]>([]);

  // A different file is a different list. Never show the last file's people
  // while the new one loads.
  useEffect(() => {
    setPeople([]);
  }, [fileId]);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    fetch(`/api/mentionable?fileId=${encodeURIComponent(fileId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setPeople(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId, refreshKey]);

  return people;
}
