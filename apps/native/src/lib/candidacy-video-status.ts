import type { MessageKey } from '@athanor/i18n';
import type { PermStatus } from '@/lib/media/permission-status';
import {
  UploadCanceledError,
  UploadHttpError,
  UploadStalledError,
} from '@/lib/media/upload-transport';

/**
 * What step 4 of the candidacy wizard says when the video does not go up (#412).
 *
 * The bug this closes: seven distinct outcomes rendered as one grey `◓`, pixel-identical to
 * not having tapped anything, and all seven ended at the same red «Aggiungi il video del tuo
 * sogno» on Continue. `UploadStatus` had an `error` member that was set in two places and
 * drawn in none, so a blocked photo permission, an over-cap video and a refused write were
 * told to the member with the same sentence — or with no sentence at all.
 *
 * The reason now travels beside the status instead of collapsing into `'error'`, and the
 * status→key map lives here: pure, in `src/lib`, so `apps/native/vitest.config.ts`'s
 * `environment: 'node'` run can actually collect it. Same argument as `candidacy-wizard.ts`
 * (#385/#413) — a `.tsx` screen is structurally untestable in this harness, so the decision
 * that matters is extracted out of it.
 */

/** Where the step-4 tile is in its lifecycle. Owned here; `use-candidacy-upload` re-exports it. */
export type UploadStatus = 'idle' | 'uploading' | 'done' | 'error' | 'canceled' | 'stalled';

/**
 * Why an attempt ended in `error`. Every member names one message; none of them is silent.
 *
 * `canceled` and `stalled` are not here on purpose — they are statuses, because they leave the
 * tile retryable in a way an error does not, and they already had copy before this change.
 */
export type VideoFailure =
  | 'camera-denied'
  | 'camera-blocked'
  | 'library-denied'
  | 'library-blocked'
  | 'too-long'
  | 'too-large'
  | 'unsupported-type'
  | 'refused'
  | 'failed';

/** A status plus the reason behind it — what the hook holds and the tile renders. */
export type VideoOutcome = {
  readonly status: UploadStatus;
  readonly failure: VideoFailure | null;
};

/**
 * The i18n key each failure names itself with.
 *
 * A `Record<VideoFailure, …>` rather than a switch so a new failure mode cannot be added
 * without choosing its copy — the omission would not compile.
 */
const FAILURE_MESSAGE: Record<VideoFailure, MessageKey> = {
  // Declined but the OS will ask again: say what is missing, the buttons below still work.
  'camera-denied': 'candidacy.step4.cameraDenied',
  'library-denied': 'candidacy.step4.libraryDenied',
  // Declined for good. The copy is the shared one because the recovery is the same either
  // way, and `videoStatusOffersSettings` is what turns it into a route rather than a wall.
  'camera-blocked': 'permission.blocked.body',
  'library-blocked': 'permission.blocked.body',
  // Rejected before a byte moved — `classifyVideoAsset` decided these from the picked asset.
  'too-long': 'media.tooLong',
  'too-large': 'media.tooLarge',
  'unsupported-type': 'media.unsupportedType',
  // Storage said no: the insert gate wants identity_verified AND an open window
  // (20260617234036_m7_candidacy_video_insert_gate). Naming identity is the useful half —
  // a member can act on it, and the window is stated by the wizard's own empty state.
  refused: 'candidacy.step4.refused',
  failed: 'media.failed',
};

/**
 * The message the step-4 tile shows under its glyph, or null when there is nothing to say
 * (idle, uploading, done).
 *
 * `error` with no reason still speaks: a failure that arrived without being classified is a
 * bug in the caller, and «Caricamento non riuscito» is a better answer to it than silence —
 * which is the exact behaviour this whole issue exists to delete.
 */
export function videoStatusMessage(
  status: UploadStatus,
  failure: VideoFailure | null,
): MessageKey | null {
  if (status === 'canceled') return 'media.canceled';
  if (status === 'stalled') return 'media.stalled';
  if (status !== 'error') return null;
  return FAILURE_MESSAGE[failure ?? 'failed'];
}

/**
 * Whether the tile should offer «Apri Impostazioni» beside the message.
 *
 * Only for a `blocked` grant: that is the one state the member cannot leave from inside the
 * app, because the OS will not prompt again. Offering Settings for a `denied` grant would
 * send someone to a settings screen when tapping the button again would have worked.
 */
export function videoStatusOffersSettings(
  status: UploadStatus,
  failure: VideoFailure | null,
): boolean {
  if (status !== 'error') return false;
  return failure === 'camera-blocked' || failure === 'library-blocked';
}

/**
 * A permission verdict → the failure it is, or null when the launch may go ahead.
 *
 * `undetermined` counts as denied: `ensureCameraPermission` only returns it when the OS
 * prompt was never resolved, and a launch on an unresolved grant is the silent no-op this
 * issue reported.
 */
export function permissionFailure(
  source: 'camera' | 'library',
  status: PermStatus,
): VideoFailure | null {
  if (status === 'granted') return null;
  const blocked = status === 'blocked';
  if (source === 'camera') return blocked ? 'camera-blocked' : 'camera-denied';
  return blocked ? 'library-blocked' : 'library-denied';
}

/**
 * An upload rejection → the outcome the tile renders.
 *
 * Supersedes `uploadFailureStatus` on this path, which collapsed everything but cancel and
 * stall into a bare `'error'`. The HTTP statuses are read because Storage answers the three
 * interesting refusals distinctly: 403 is the insert gate (identity/window), 413 is the
 * bucket's 200 MB ceiling, 415 is `allowed_mime_types`. Anything else — a 5xx, a dropped
 * socket, a native throw — is a plain failure, which is honest rather than guessed.
 */
export function uploadFailureOutcome(err: unknown): VideoOutcome {
  if (err instanceof UploadCanceledError) return { status: 'canceled', failure: null };
  if (err instanceof UploadStalledError) return { status: 'stalled', failure: null };
  if (err instanceof UploadHttpError) {
    if (err.status === 403) return { status: 'error', failure: 'refused' };
    if (err.status === 413) return { status: 'error', failure: 'too-large' };
    if (err.status === 415) return { status: 'error', failure: 'unsupported-type' };
  }
  return { status: 'error', failure: 'failed' };
}
