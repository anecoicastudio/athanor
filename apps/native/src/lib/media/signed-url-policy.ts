import { BUCKET_URL_TTL } from '@athanor/api';
import type { MediaBucket } from './upload';

/**
 * How long React Query may reuse a signed URL, derived from the lifetime the URL actually has.
 *
 * The TTL itself lives in `@athanor/api` (`BUCKET_URL_TTL`) so it cannot be lost by forgetting
 * an argument at a call site. What belongs here is the client-cache half: `staleTime` must sit
 * under `expiresIn`, or the cache serves a dead URL for the difference — which renders as media
 * that silently stops loading. They are one decision and must move together.
 *
 * `story-segments` is capped at 5 min because an RLS predicate runs when a URL is MINTED, not
 * when it is used, so for a bucket whose objects expire the TTL is the residual exposure after
 * expiry (issue #21). That is short enough to need `refetchInterval` as well: `staleTime` alone
 * only governs refetch on mount and refocus, so a story left open — a paused video, an app
 * backgrounded and resumed inside the same mount — would hit a dead URL five minutes in. At the
 * 1h default that was academic; at 5 min it is a Tuesday.
 */
const REFRESH_MARGIN_MS = 60_000;

/** Signed-URL lifetime for expiring story segments. Do NOT raise without re-reading issue #21. */
export const STORY_SEGMENT_TTL = BUCKET_URL_TTL['story-segments'];

export type SignedUrlPolicy = {
  /** Seconds the URL is valid for — the bucket's entry in `BUCKET_URL_TTL`. */
  expiresIn: number;
  /** Milliseconds for TanStack `staleTime` — always strictly under `expiresIn`. */
  staleTime: number;
  /** Milliseconds for `refetchInterval`, or `false` where the TTL is long enough not to need it. */
  refetchInterval: number | false;
};

export function signedUrlPolicy(bucket: MediaBucket): SignedUrlPolicy {
  const expiresIn = BUCKET_URL_TTL[bucket];
  const staleTime = expiresIn * 1000 - REFRESH_MARGIN_MS;
  // Only the capped bucket re-signs on a timer. Polling the hour-long buckets would be pure
  // battery for a URL that outlives any realistic session on one screen.
  return { expiresIn, staleTime, refetchInterval: expiresIn <= 600 ? staleTime : false };
}
