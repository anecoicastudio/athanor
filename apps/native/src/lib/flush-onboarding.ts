import { updateOnboardingProfileWithHandleFallback, upsertActiveDream } from '@athanor/api';
import { suggestHandle, validateOnboardingAnswers } from '@athanor/core';
import { onboardingAnswersSchema } from '@athanor/schemas';
import { devWarn } from '@/lib/log';
import { supabase } from './supabase';
import { clearDraft, hasDraftAnswers, loadDraft } from './onboarding-draft';

export type FlushResult = 'flushed' | 'nodraft' | 'error';

/**
 * Persist the pre-auth onboarding draft to the now-authenticated profile.
 * Called once after OTP from auth-context when the freshly-created profile is
 * still incomplete. The @handle is auto-derived from the email (the funnel no
 * longer asks for one), with a 23505 fallback. Idempotent: the profile write
 * tolerates re-runs and the dream goes through `upsertActiveDream`, so a partial
 * failure simply leaves the draft in place and retries on the next foreground.
 */
export async function flushOnboardingDraft(userId: string, email: string): Promise<FlushResult> {
  const draft = await loadDraft();
  if (!hasDraftAnswers(draft)) return 'nodraft';

  try {
    const answers = onboardingAnswersSchema.parse({
      handle: suggestHandle(email),
      locale: draft.locale,
      identity_tags: draft.identity_tags,
      seeking: draft.seeking,
    });

    const vocab = validateOnboardingAnswers(answers);
    if (!vocab.ok) {
      // A draft with an off-vocabulary tag can never satisfy the server — drop it
      // (rather than loop) and let the guard route back to a fresh funnel.
      await clearDraft();
      return 'error';
    }

    await updateOnboardingProfileWithHandleFallback(supabase, userId, answers);
    const dream = draft.dream.trim();
    if (dream) await upsertActiveDream(supabase, userId, dream);

    await clearDraft();
    return 'flushed';
  } catch (e) {
    devWarn('[onboarding] flush', e);
    // Keep the draft; the next foreground (or next auth event) retries the flush.
    return 'error';
  }
}
