import type { PostMedia } from '@athanor/schemas';

/** Seconds → `M:SS` (165 → "2:45"). Null/negative → "". */
export function formatDuration(s: number | null): string {
  if (s === null || s < 0) return '';
  const total = Math.floor(s);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Aspect ratio from intrinsic dims; fallback 4:5 (portrait) when unknown. */
export function aspectRatio(media: Pick<PostMedia, 'width' | 'height'>): number {
  if (media.width && media.height && media.height > 0) return media.width / media.height;
  return 4 / 5;
}
