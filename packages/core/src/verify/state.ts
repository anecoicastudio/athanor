import type { VerificationStatus } from '@athanor/schemas';

/** UI-facing verification state (frontend 09-m9-trust §3.2). */
export type VerifyState = 'idle' | 'pending' | 'verified' | 'failed';

export type VerifyStateInput = {
  /** `profiles.identity_verified` — server-set by the W9 webhook. The source of truth. */
  identityVerified: boolean;
  /** Status of the latest `verifications` row, or null when the user never started one. */
  latestStatus: VerificationStatus | null;
  /** Client-local: a session was just started and the app is polling for the flip. */
  sessionPending?: boolean;
};

/**
 * Map (profile flag, latest session status, local pending) → the UI state that drives the
 * Identità chip + verify sheet. Pure: no I/O, no clock. Precedence per §3.2:
 * verified > pending > failed > idle. The flag wins so a stale `failed` row never masks a
 * later success, and a just-started retry shows `pending` over the old `failed`.
 */
export function deriveVerifyState({
  identityVerified,
  latestStatus,
  sessionPending = false,
}: VerifyStateInput): VerifyState {
  if (identityVerified || latestStatus === 'verified') return 'verified';
  if (sessionPending || latestStatus === 'pending') return 'pending';
  if (latestStatus === 'failed') return 'failed';
  return 'idle';
}
