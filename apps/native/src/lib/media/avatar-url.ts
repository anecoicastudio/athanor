import { useQuery } from '@tanstack/react-query';
import { signMediaUrls } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { createSignedUrlBatcher } from './signed-url-batch';
import { signedUrlPolicy } from './signed-url-policy';

/**
 * The one spelling of the avatar-URL cache key (`api.md`: a key is never spelled twice). The
 * uploader busts this exact entry after overwriting the object — a second hand-written copy is
 * how that cache-bust silently stops matching the query it is meant to invalidate.
 */
export const avatarUrlKey = (path: string) => ['avatar-url', path] as const;

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
    queryKey: avatarUrlKey(path as string),
    queryFn: () => resolveAvatarUrl(path as string),
    enabled: !!path,
    staleTime,
    // Never persisted (#287): the URL is a credential that dies after BUCKET_URL_TTL.avatars
    // (1h), while the persisted cache lives 24h — a cold start inside that window rehydrates a
    // dead URL on every avatar at once. Re-signing on launch is one batched call.
    meta: { persist: false },
  });
  return data ?? null;
}
