import { MEDIA_LIMITS } from './limits';

/**
 * Which second of a video the poster frame comes from.
 *
 * Pure so the clamping is testable without a decoder: the extraction itself lives in
 * `apps/native/src/lib/media/poster.ts`, which is all native calls.
 *
 * Two rules, and they pull against each other. Frame zero is the worst frame in most clips
 * (fade-in, lens cap, exposure ramp), so the default is an offset. But a clip can be shorter
 * than that offset, and a time past the end of an asset is not a frame — the decoder either
 * clamps to somewhere unhelpful or hands back nothing. So the offset is capped at the
 * midpoint, which exists in every clip that has any duration at all.
 *
 * A duration we do not have is the third case: the picker does not always report one, and
 * guessing an offset into an unknown length risks asking past the end. Frame zero is the only
 * time guaranteed to exist, so an unknown duration takes it and accepts the black-frame risk.
 */
export function videoPosterTime(durationS: number | null | undefined): number {
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) return 0;
  return Math.min(MEDIA_LIMITS.VIDEO_POSTER_SECONDS, durationS / 2);
}
