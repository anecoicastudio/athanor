import { useQuery } from '@tanstack/react-query';
import { getProfileById, profileKeys } from '@athanor/api';
import { supabase } from '@/lib/supabase';

/**
 * Resolve a member's profile by id (handle/avatar for the post author row + comment
 * commenters). Cached under profileKeys.detail; members-wide RLS. Pass null/undefined
 * to no-op (the query stays disabled).
 */
export function useProfile(profileId: string | null | undefined) {
  return useQuery({
    queryKey: profileKeys.detail(profileId ?? 'none'),
    queryFn: () => getProfileById(supabase, profileId as string),
    enabled: Boolean(profileId),
    staleTime: 5 * 60_000,
  });
}
