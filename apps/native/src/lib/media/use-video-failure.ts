import { useEffect } from 'react';
import { useEvent } from 'expo';
import type { VideoPlayer } from 'expo-video';

/**
 * Report a video player's death upward (#278). `expo-video` has a real error signal — the
 * `statusChange` event lands on `status === 'error'` when a URL that signed fine then 404s on
 * GET — so a dead video can flip its surface to unavailable instead of sitting behind a still
 * frame that never plays. The one signal photos always had (`expo-image`'s `onError`), for the
 * players.
 *
 * `onFailure` may be called more than once for the same failure (the effect re-runs when the
 * caller re-renders); callers set idempotent state, so that costs nothing.
 */
export function useVideoFailure(player: VideoPlayer, onFailure: () => void) {
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') onFailure();
  }, [status, onFailure]);
}
