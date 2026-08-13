import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadSeenStoryIds, persistSeenStoryIds, sanitizeSeenIds } from '@/lib/story-seen';

/**
 * Cache key for the device-local seen set. NOT in `@athanor/api`'s `storyKeys` on purpose:
 * that factory names server data, this is a device preference (see story-seen.ts).
 */
const SEEN_KEY = ['stories', 'seen-local'] as const;

/**
 * Seen story authors, shared across screens through the query cache — the rail dims as soon
 * as the viewer finishes a person (#298). `markSeen` fires when a story FINISHES, never when
 * it is opened: a mis-tap must not burn a ring.
 *
 * Cache data is `string[]`, never a `Set`: the query cache is persisted via JSON.stringify,
 * which turns a Set into `'{}'`. The Set consumers need is derived here, behind a sanitizer
 * that also tolerates a poisoned pre-fix cache restore. Durability belongs to story-seen.ts's
 * own AsyncStorage payload, so the query opts out of the persister (`meta.persist`).
 */
export function useStorySeen(): {
  seenIds: Set<string>;
  markSeen: (authorId: string) => void;
} {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SEEN_KEY,
    queryFn: loadSeenStoryIds,
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { persist: false },
  });

  const seenIds = useMemo(() => new Set(sanitizeSeenIds(query.data)), [query.data]);

  // One-shot heal: a restored pre-fix cache entry is `{}` — defined, not an array — and
  // staleTime: Infinity would freeze it forever, shadowing the intact canonical list in
  // AsyncStorage. Invalidate so the queryFn reloads it: dimmed rings come back instead of
  // re-lighting.
  useEffect(() => {
    if (query.data !== undefined && !Array.isArray(query.data)) {
      void queryClient.invalidateQueries({ queryKey: SEEN_KEY });
    }
  }, [queryClient, query.data]);

  const markSeen = useCallback(
    (authorId: string) => {
      const current = sanitizeSeenIds(queryClient.getQueryData(SEEN_KEY));
      if (current.includes(authorId)) return;
      const next = [...current, authorId];
      queryClient.setQueryData(SEEN_KEY, next);
      void persistSeenStoryIds(next);
    },
    [queryClient],
  );

  return { seenIds, markSeen };
}
