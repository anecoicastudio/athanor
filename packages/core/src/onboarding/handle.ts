import { isReservedHandle } from '@athanor/schemas';

/** What an address with no usable local part becomes. Must itself be claimable (#430). */
const FALLBACK_HANDLE = 'aura';

/** Derive an @handle suggestion from an email. Rules: ^[a-z0-9_]{3,30}$ (schemas.handleSchema). */
export function suggestHandle(email: string): string {
  // `?? ''` is required by `noUncheckedIndexedAccess` but unreachable: split always returns at
  // least one element, so [0] is never undefined. Hence the one NoCoverage mutant here — an
  // equivalent mutant in the same sense, on a branch no input can enter.
  const local = email.split('@')[0] ?? '';
  let handle = local
    .toLowerCase()
    // The `+` here is redundant with the collapse on the next line (dropping it just produces
    // more underscores for that pass to merge) — an equivalent mutant, not a coverage hole.
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (handle.length === 0) return FALLBACK_HANDLE;
  while (handle.length < 3) handle += '_';
  handle = handle.slice(0, 30);
  /*
   * #430 — dodge the reserved list HERE, before either guard downstream can see it. A reserved
   * suggestion throws inside `onboardingAnswersSchema.parse` in `flushOnboardingDraft`, which
   * keeps the draft and retries forever; past that, the column's CHECK raises 23514, which
   * `updateOnboardingProfileWithHandleFallback` does not retry (23505 only).
   *
   * Two steps, because a suffix escapes the exact list but never the brand PREFIX rule:
   * `admin` becomes `admin_`, while `athanor_support_` is still reserved and takes the fallback.
   * The suffix cannot breach the 30-char cap: a prefix match returns the fallback whatever its
   * length, and every LIST entry is held to 29 by `reserved-handles.test.ts`.
   */
  if (isReservedHandle(handle)) handle = `${handle}_`;
  if (isReservedHandle(handle)) return FALLBACK_HANDLE;
  return handle;
}
