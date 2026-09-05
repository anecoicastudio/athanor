import {
  updateOnboardingProfileWithHandleFallback,
  updateProfile,
  upsertActiveDream,
} from '@athanor/api';
import { suggestHandle, validateOnboardingAnswers } from '@athanor/core';
import { onboardingAnswersSchema } from '@athanor/schemas';
import { devWarn } from '@/lib/log';
import { uploadAvatarImage } from '@/lib/media/avatar-upload';
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
 *
 * The name is NOT flushed here: `handle_new_user` already copied it from the signup metadata to
 * profiles.display_name at INSERT time (20260811072211), so the draft never carried one. The
 * photo is the opposite — it could not be uploaded before a session existed, so it lands here.
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
      // #694 — `updateOnboardingProfile` re-parses with the same schema and strips unknown
      // keys, so leaving this out would drop the date silently, not fail.
      birth_date: draft.birth_date,
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
    await flushAvatar(userId, draft.avatar_uri);

    await clearDraft();
    return 'flushed';
  } catch (e) {
    devWarn('[onboarding] flush', e);
    // Keep the draft; the next foreground (or next auth event) retries the flush.
    return 'error';
  }
}

/**
 * Upload the photo picked before the account existed, then point the profile at it.
 *
 * Best-effort ON PURPOSE, and the only step here that is: the picked file is a CACHE uri, so it
 * can be evicted between the funnel and the OTP, and the app may have been reinstalled in
 * between. None of that is worth failing a flush over and looping the member back through the
 * funnel — a profile with no photo is a first-class state (#75), a profile with no tags is not.
 */
async function flushAvatar(userId: string, localUri: string | null): Promise<void> {
  if (!localUri) return;
  try {
    const path = await uploadAvatarImage(userId, localUri);
    await updateProfile(supabase, userId, { avatar_path: path });
  } catch (e) {
    devWarn('[onboarding] avatar flush', e);
  }
}
