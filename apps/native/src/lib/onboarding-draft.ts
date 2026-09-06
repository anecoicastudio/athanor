import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Locale } from '@athanor/schemas';
import { devWarn } from '@/lib/log';
import { deviceLocale } from '@/lib/locale';

/**
 * Pre-auth onboarding draft. The funnel (`(onboarding)/index.tsx`) now runs
 * BEFORE account creation, so the answers are collected with no session and
 * cannot be written to `profiles` yet (anon has no table access). We stash them
 * here and flush to the profile after OTP (see `flush-onboarding.ts`). Survives
 * the OTP round-trip + app backgrounding because AsyncStorage is on disk.
 */
const KEY = 'athanor.onboarding.draft';
// v2 added `avatar_uri` (#76); v3 adds `birth_date` (#694). Bumping invalidates any older draft
// in flight rather than migrating it — a draft lives minutes, and `loadDraft` already treats an
// unknown version as no draft.
const VERSION = 3 as const;

export type OnboardingDraft = {
  v: typeof VERSION;
  locale: Locale;
  identity_tags: string[];
  seeking: string[];
  dream: string;
  /**
   * LOCAL file:// uri of the photo picked during onboarding (#76), not a storage key.
   *
   * The funnel runs before the account exists, and every `avatars` storage policy keys on
   * auth.uid() — so there is nobody to upload as yet. The flush uploads it once the session
   * lands. It is a cache path, so it can be gone by then; the flush treats that as no photo.
   */
  avatar_uri: string | null;
  /**
   * `YYYY-MM-DD`, local calendar parts (#694). Required for a NEW sign-up: the funnel's step 2
   * does not advance without one, and `hasDraftAnswers` refuses to flush without one — so a
   * draft that somehow lacks it routes back to the funnel rather than landing a profile the
   * onboarding schema would reject.
   */
  birth_date: string | null;
};

export async function saveDraft(draft: Omit<OnboardingDraft, 'v'>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ v: VERSION, ...draft }));
  } catch (err) {
    // Best-effort: a failed write means the post-auth flush can't read the draft
    // (→ incomplete profile → AuthGuard loops to the funnel). Surface it in dev.
    if (__DEV__) console.warn('[onboarding-draft] saveDraft failed', err);
  }
}

export async function loadDraft(): Promise<OnboardingDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (parsed?.v !== VERSION) return null; // version bump invalidates old drafts
    return {
      v: VERSION,
      locale: parsed.locale ?? deviceLocale,
      identity_tags: Array.isArray(parsed.identity_tags) ? parsed.identity_tags : [],
      seeking: Array.isArray(parsed.seeking) ? parsed.seeking : [],
      dream: typeof parsed.dream === 'string' ? parsed.dream : '',
      avatar_uri: typeof parsed.avatar_uri === 'string' ? parsed.avatar_uri : null,
      birth_date: typeof parsed.birth_date === 'string' ? parsed.birth_date : null,
    };
  } catch (e) {
    devWarn('[onboarding-draft] loadDraft', e);
    return null; // corrupt/unreadable draft → treat as none
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore — a stale draft is harmless; the flush is idempotent on a complete profile
  }
}

/**
 * A draft worth flushing has the two required vocab answers and a birth date (#694); the dream
 * and the photo are optional. Anything less cannot satisfy `onboardingAnswersSchema`, so it is
 * not worth a round trip.
 */
export function hasDraftAnswers(draft: OnboardingDraft | null): draft is OnboardingDraft {
  return (
    !!draft &&
    draft.identity_tags.length > 0 &&
    draft.seeking.length > 0 &&
    draft.birth_date !== null
  );
}
