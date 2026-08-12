import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadSeenStoryIds, persistSeenStoryIds } from '@/lib/story-seen';

/**
 * Cache key for the device-local seen set. NOT in `@athanor/api`'s `storyKeys` on purpose:
 * that factory names server data, this is a device preference (see story-seen.ts).
 */
const SEEN_KEY = ['stories', 'seen-local'] as const;

/**
 * Seen story authors, shared across screens through the query cache — the rail dims as soon
 * as the viewer finishes a person (#298). `markSeen` fires when a story FINISHES, never when
 * it is opened: a mis-tap must not burn a ring.
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
  });

  const markSeen = useCallback(
    (authorId: string) => {
      const next = new Set(queryClient.getQueryData<Set<string>>(SEEN_KEY) ?? []);
      if (next.has(authorId)) return;
      next.add(authorId);
      queryClient.setQueryData(SEEN_KEY, next);
      void persistSeenStoryIds(next);
    },
    [queryClient],
  );

  return { seenIds: query.data ?? new Set<string>(), markSeen };
}
