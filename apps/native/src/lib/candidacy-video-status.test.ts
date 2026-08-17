import { describe, expect, it } from 'vitest';
import { t } from '@athanor/i18n';
import {
  UploadCanceledError,
  UploadHttpError,
  UploadStalledError,
} from '@/lib/media/upload-transport';
import {
  type UploadStatus,
  type VideoFailure,
  permissionFailure,
  uploadFailureOutcome,
  videoStatusMessage,
  videoStatusOffersSettings,
} from './candidacy-video-status';

const FAILURES: readonly VideoFailure[] = [
  'camera-denied',
  'camera-blocked',
  'library-denied',
  'library-blocked',
  'too-long',
  'too-large',
  'unsupported-type',
  'refused',
  'failed',
];

const QUIET: readonly UploadStatus[] = ['idle', 'uploading', 'done'];

describe('videoStatusMessage — every failure names itself (#412)', () => {
  it('says nothing while idle, uploading or done', () => {
    for (const status of QUIET) {
      expect(videoStatusMessage(status, null), status).toBeNull();
    }
  });

  it('a quiet status stays quiet even carrying a stale reason', () => {
    // The hook clears `failure` on a fresh attempt, but the tile must not depend on that:
    // a message under a spinner would read as a failure that has not happened.
    for (const status of QUIET) {
      expect(videoStatusMessage(status, 'too-long'), status).toBeNull();
    }
  });

  it('keeps the two messages that already worked', () => {
    expect(videoStatusMessage('canceled', null)).toBe('media.canceled');
    expect(videoStatusMessage('stalled', null)).toBe('media.stalled');
  });

  it('names EVERY error reason — no reason maps to null', () => {
    // The regression this pins: `status === 'error'` used to fall through to the grey ◓,
    // identical to idle, for five distinct outcomes.
    for (const failure of FAILURES) {
      expect(videoStatusMessage('error', failure), failure).not.toBeNull();
    }
  });

  it('gives each reason a DISTINCT message, except the two blocked grants', () => {
    // The defect was one sentence for seven outcomes; near-duplicates would re-create it.
    // Both `blocked` cases share `permission.blocked.body` deliberately — same recovery.
    const keys = FAILURES.map((f) => videoStatusMessage('error', f));
    expect(new Set(keys).size).toBe(FAILURES.length - 1);
    expect(videoStatusMessage('error', 'camera-blocked')).toBe(
      videoStatusMessage('error', 'library-blocked'),
    );
  });

  it('the over-cap video — the case that rendered nothing at all — says tooLong', () => {
    // `toPickedMedia` returned null past MAX_VIDEO_SECONDS and the hook early-returned
    // without touching status, so the tile never even left `idle`.
    expect(videoStatusMessage('error', 'too-long')).toBe('media.tooLong');
  });

  it('an over-size video says tooLarge and a refused write says why', () => {
    expect(videoStatusMessage('error', 'too-large')).toBe('media.tooLarge');
    expect(videoStatusMessage('error', 'refused')).toBe('candidacy.step4.refused');
  });

  it('an unclassified error still speaks rather than falling silent', () => {
    expect(videoStatusMessage('error', null)).toBe('media.failed');
  });

  it('every key it can return resolves in BOTH catalogs', () => {
    // `t` returns the key itself when the catalog has no entry (#113), so a key that renders
    // as its own name is a message the member would read as «media.tooLarge».
    const keys = [
      videoStatusMessage('canceled', null),
      videoStatusMessage('stalled', null),
      ...FAILURES.map((f) => videoStatusMessage('error', f)),
    ];
    for (const key of keys) {
      expect(key).not.toBeNull();
      expect(t(key!, 'it'), `IT missing ${key}`).not.toBe(key);
      expect(t(key!, 'en'), `EN missing ${key}`).not.toBe(key);
    }
  });
});

describe('videoStatusOffersSettings — a blocked permission is never a dead button', () => {
  it('offers Settings for a blocked grant, camera or library', () => {
    expect(videoStatusOffersSettings('error', 'camera-blocked')).toBe(true);
    expect(videoStatusOffersSettings('error', 'library-blocked')).toBe(true);
  });

  it('does NOT offer Settings for a denied grant — tapping again still works', () => {
    expect(videoStatusOffersSettings('error', 'camera-denied')).toBe(false);
    expect(videoStatusOffersSettings('error', 'library-denied')).toBe(false);
  });

  it('offers Settings for nothing else', () => {
    for (const failure of FAILURES) {
      if (failure === 'camera-blocked' || failure === 'library-blocked') continue;
      expect(videoStatusOffersSettings('error', failure), failure).toBe(false);
    }
    expect(videoStatusOffersSettings('error', null)).toBe(false);
  });

  it('never offers Settings outside an error', () => {
    for (const status of [...QUIET, 'canceled', 'stalled'] as UploadStatus[]) {
      expect(videoStatusOffersSettings(status, 'camera-blocked'), status).toBe(false);
    }
  });
});

describe('permissionFailure', () => {
  it('a granted permission is not a failure', () => {
    expect(permissionFailure('camera', 'granted')).toBeNull();
    expect(permissionFailure('library', 'granted')).toBeNull();
  });

  it('blocked and denied are told apart, per source', () => {
    expect(permissionFailure('camera', 'blocked')).toBe('camera-blocked');
    expect(permissionFailure('camera', 'denied')).toBe('camera-denied');
    expect(permissionFailure('library', 'blocked')).toBe('library-blocked');
    expect(permissionFailure('library', 'denied')).toBe('library-denied');
  });

  it('an undetermined grant counts as denied, not as permission to launch', () => {
    // A launch on an unresolved grant is the silent no-op #412 reported.
    expect(permissionFailure('camera', 'undetermined')).toBe('camera-denied');
    expect(permissionFailure('library', 'undetermined')).toBe('library-denied');
  });

  it('only the blocked verdicts route to Settings', () => {
    expect(videoStatusOffersSettings('error', permissionFailure('camera', 'blocked'))).toBe(true);
    expect(videoStatusOffersSettings('error', permissionFailure('camera', 'denied'))).toBe(false);
  });
});

describe('uploadFailureOutcome — Storage answers the interesting refusals distinctly', () => {
  it('cancel and stall stay statuses, carrying no reason', () => {
    expect(uploadFailureOutcome(new UploadCanceledError())).toEqual({
      status: 'canceled',
      failure: null,
    });
    expect(uploadFailureOutcome(new UploadStalledError())).toEqual({
      status: 'stalled',
      failure: null,
    });
  });

  it('403 is the insert gate — identity_verified AND an open window', () => {
    expect(uploadFailureOutcome(new UploadHttpError(403, 'new row violates RLS'))).toEqual({
      status: 'error',
      failure: 'refused',
    });
  });

  it("413 is the bucket's size ceiling and 415 its mime allowlist", () => {
    expect(uploadFailureOutcome(new UploadHttpError(413, '')).failure).toBe('too-large');
    expect(uploadFailureOutcome(new UploadHttpError(415, '')).failure).toBe('unsupported-type');
  });

  it('any other HTTP status is a plain failure, not a guess', () => {
    for (const status of [400, 401, 404, 409, 429, 500, 503]) {
      expect(uploadFailureOutcome(new UploadHttpError(status, '')).failure, `${status}`).toBe(
        'failed',
      );
    }
  });

  it('a network error, a native throw and a non-Error all read as failed', () => {
    expect(uploadFailureOutcome(new Error('upload-network-error'))).toEqual({
      status: 'error',
      failure: 'failed',
    });
    expect(uploadFailureOutcome('boom').failure).toBe('failed');
    expect(uploadFailureOutcome(undefined).failure).toBe('failed');
  });

  it('every outcome it produces has a message', () => {
    const errors: unknown[] = [
      new UploadCanceledError(),
      new UploadStalledError(),
      new UploadHttpError(403, ''),
      new UploadHttpError(413, ''),
      new UploadHttpError(415, ''),
      new UploadHttpError(500, ''),
      new Error('x'),
    ];
    for (const err of errors) {
      const { status, failure } = uploadFailureOutcome(err);
      expect(videoStatusMessage(status, failure)).not.toBeNull();
    }
  });
});
