import { useQuery } from '@tanstack/react-query';
import { signMediaUrls } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import { signedUrlPolicy } from './signed-url-policy';
import type { MediaBucket } from './upload';

/**
 * Resolve private storage paths → short-lived signed URLs for rendering.
 * Returns a `path → url` map; paths that fail to sign are omitted (caller shows
 * a placeholder). Lifetime and refresh cadence come from `signedUrlPolicy` — they are one
 * decision per bucket, and `story-segments` is capped well under the default because an RLS
 * predicate is evaluated when a URL is minted, not when it is used (issue #21).
 * Query is disabled when there are no paths.
 *
 * The key is stable across path order (sorted) so the same set hits one cache
 * entry regardless of the order the caller passes them in.
 */
export function useSignedUrls(
  bucket: MediaBucket,
  paths: string[],
): { urls: Record<string, string>; isLoading: boolean } {
  const sorted = [...paths].sort();
  const { staleTime, refetchInterval } = signedUrlPolicy(bucket);
  const query = useQuery({
    queryKey: ['signed-media', bucket, ...sorted],
    // No `expiresIn` argument: signMediaUrls defaults to the bucket's own TTL, which is where
    // the guarantee belongs — passing one here would be a second place to get it wrong.
    queryFn: () => signMediaUrls(supabase, bucket, sorted),
    enabled: sorted.length > 0,
    staleTime,
    // Capped buckets re-sign on a timer; a story left open must not outlive its URL. Foreground
    // only — a backgrounded app has nothing to render and refetching would just cost battery.
    refetchInterval,
    refetchIntervalInBackground: false,
    // Never persisted (#287): every URL here expires within its bucket's TTL (≤1h), while the
    // persisted cache lives 24h — rehydrating one hands the renderer a dead credential.
    meta: { persist: false },
  });

  return { urls: query.data ?? {}, isLoading: query.isLoading };
}
