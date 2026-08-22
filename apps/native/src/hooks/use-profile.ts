import { useQuery } from '@tanstack/react-query';
import { getProfileById, profileKeys } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * Resolve a member's profile by id — the handle/avatar for the post author row and comment
 * commenters, and the whole subject of Person Detail. Cached under profileKeys.detail;
 * members-wide RLS. Pass null/undefined to no-op (the query stays disabled).
 *
 * `null` data is a real answer, not a failure: an unknown id, a blocked pair, or signed-out.
 * A banned member still RESOLVES, with every identity column NULL and `removed` true (#314).
 */
export function useProfile(profileId: string | null | undefined) {
  return useQuery({
    queryKey: profileKeys.detail(profileId ?? 'none'),
    queryFn: () => getProfileById(supabase, profileId as string),
    enabled: Boolean(profileId),
    staleTime: 5 * 60_000,
  });
}
