import { useQuery } from '@tanstack/react-query';
import { signMediaUrls } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { createSignedUrlBatcher } from './signed-url-batch';
import { signedUrlPolicy } from './signed-url-policy';

/** One batcher for the whole app — a shared queue is what makes the coalescing worth anything. */
const resolveAvatarUrl = createSignedUrlBatcher((paths) =>
  signMediaUrls(supabase, 'avatars', paths),
);

/**
 * Resolve one `avatar_path` to a short-lived signed URL (#76).
 *
 * Per path rather than per screen — see `signed-url-batch.ts` for why, and for the batching that
 * keeps a list of rows down to one signing call. A null path (the member set no photo) disables
 * the query, so a profile without one costs nothing.
 */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const { staleTime } = signedUrlPolicy('avatars');
  const { data } = useQuery({
    queryKey: ['avatar-url', path],
    queryFn: () => resolveAvatarUrl(path as string),
    enabled: !!path,
    staleTime,
  });
  return data ?? null;
}
