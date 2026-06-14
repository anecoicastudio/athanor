import { useQuery } from '@tanstack/react-query';
import { signMediaUrls } from '@athanor/api';
import { supabase } from '@/lib/supabase';
import type { MediaBucket } from './upload';

/**
 * Resolve private storage paths → short-lived signed URLs for rendering.
 * Returns a `path → url` map; paths that fail to sign are omitted (caller shows
 * a placeholder). `staleTime` sits under the 1h signed-URL expiry so React Query
 * refreshes before a URL goes stale. Query is disabled when there are no paths.
 *
 * The key is stable across path order (sorted) so the same set hits one cache
 * entry regardless of the order the caller passes them in.
 */
export function useSignedUrls(
  bucket: MediaBucket,
  paths: string[],
): { urls: Record<string, string>; isLoading: boolean } {
  const sorted = [...paths].sort();
  const query = useQuery({
    queryKey: ['signed-media', bucket, ...sorted],
    queryFn: () => signMediaUrls(supabase, bucket, sorted),
    enabled: sorted.length > 0,
    staleTime: 50 * 60 * 1000, // 50 min — under the 1h signed-URL expiry
  });

  return { urls: query.data ?? {}, isLoading: query.isLoading };
}
