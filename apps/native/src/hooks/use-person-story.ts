import { getPersonStory, storyKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * One person's story segments. Community warms `storyKeys.person(myId)` for its «Il tuo passo»
 * ring, and the viewer reads that same entry for the current author plus the next one it is
 * prefetching (#298) — so a chain handoff is not a blank frame.
 *
 * Returning the raw result matters here: the viewer reads `queryClient.getQueryData` on this key
 * too, and both paths have to agree on the cached shape.
 */
export function personStoryQuery(profileId: string | null | undefined) {
  return queryOptions({
    queryKey: storyKeys.person(profileId ?? ''),
    queryFn: () => getPersonStory(supabase, profileId as string),
    enabled: Boolean(profileId),
  });
}

export function usePersonStory(profileId: string | null | undefined) {
  return useQuery(personStoryQuery(profileId));
}
