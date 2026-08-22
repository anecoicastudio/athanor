import { getMomentsPage, momentKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * The first keyset page of a member's live momenti (rule #9 — never offset). 24 rows; infinite
 * scroll on the full grid is deferred.
 *
 * One entry per owner, shared by the own Profilo gallery, the full-screen grid and Person
 * Detail — which is what makes `useMomentUpload`'s and the grid's
 * `invalidateQueries(momentKeys.list(uid))` reach all three after an add or a soft-delete.
 */
export function momentsPageQuery(ownerId: string | null | undefined) {
  return queryOptions({
    queryKey: momentKeys.list(ownerId ?? ''),
    queryFn: () => getMomentsPage(supabase, ownerId as string),
    enabled: Boolean(ownerId),
  });
}

export function useMomentsPage(ownerId: string | null | undefined) {
  return useQuery(momentsPageQuery(ownerId));
}
