import { describe, expect, it } from 'vitest';
import { BUCKET_URL_TTL } from '@athanor/api';
import { STORY_SEGMENT_TTL, signedUrlPolicy } from './signed-url-policy';
import type { MediaBucket } from './upload';

const BUCKETS: MediaBucket[] = ['post-media', 'moments', 'story-segments'];

describe('signedUrlPolicy', () => {
  it('caps story-segment URLs at 5 minutes — the residual window after a segment expires', () => {
    // An RLS predicate runs when the URL is MINTED, so this number IS the exposure after
    // expires_at passes. The migration cannot enforce it; this is the only guard.
    expect(STORY_SEGMENT_TTL).toBe(300);
    expect(signedUrlPolicy('story-segments').expiresIn).toBe(300);
  });

  it('takes the TTL from @athanor/api, so a call site cannot diverge from the policy', () => {
    for (const bucket of BUCKETS) {
      expect(signedUrlPolicy(bucket).expiresIn).toBe(BUCKET_URL_TTL[bucket]);
    }
  });

  it('leaves the non-expiring buckets on the 1h default', () => {
    expect(signedUrlPolicy('post-media').expiresIn).toBe(3600);
    expect(signedUrlPolicy('moments').expiresIn).toBe(3600);
  });

  it('gives story-segments a materially shorter life than the buckets that never expire', () => {
    // Guards the direction, not just the value: a mutant swapping the arms would keep both
    // numbers valid-looking while handing the expiring media the longest TTL of the three.
    expect(signedUrlPolicy('story-segments').expiresIn).toBeLessThan(
      signedUrlPolicy('post-media').expiresIn,
    );
  });

  it('always refreshes before the URL dies, for every bucket', () => {
    // The failure this prevents: staleTime ≥ expiresIn means React Query serves a dead URL for
    // the difference, which renders as media that silently stops loading.
    for (const bucket of BUCKETS) {
      const { expiresIn, staleTime } = signedUrlPolicy(bucket);
      expect(staleTime).toBeLessThan(expiresIn * 1000);
      expect(staleTime).toBeGreaterThan(0);
    }
  });

  it('keeps the refresh margin at one minute, not a fraction of the TTL', () => {
    // A proportional margin would shrink to 15s on the 5-minute bucket — inside the window a
    // slow network needs to re-sign.
    for (const bucket of BUCKETS) {
      const { expiresIn, staleTime } = signedUrlPolicy(bucket);
      expect(expiresIn * 1000 - staleTime).toBe(60_000);
    }
  });

  it('re-signs the capped bucket on a timer, and only the capped bucket', () => {
    // staleTime alone fires on mount and refocus. A story left open inside one mount — paused
    // video, app resumed — would hit a dead URL five minutes in without this.
    const story = signedUrlPolicy('story-segments');
    expect(story.refetchInterval).toBe(story.staleTime);
    expect(signedUrlPolicy('post-media').refetchInterval).toBe(false);
    expect(signedUrlPolicy('moments').refetchInterval).toBe(false);
  });

  it('never polls faster than it refreshes — the interval IS the stale window', () => {
    for (const bucket of BUCKETS) {
      const { staleTime, refetchInterval } = signedUrlPolicy(bucket);
      if (refetchInterval !== false) expect(refetchInterval).toBeGreaterThanOrEqual(staleTime);
    }
  });
});
