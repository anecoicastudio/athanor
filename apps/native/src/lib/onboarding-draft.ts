import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Locale } from '@athanor/schemas';

/**
 * Pre-auth onboarding draft. The funnel (`(onboarding)/index.tsx`) now runs
 * BEFORE account creation, so the answers are collected with no session and
 * cannot be written to `profiles` yet (anon has no table access). We stash them
 * here and flush to the profile after OTP (see `flush-onboarding.ts`). Survives
 * the OTP round-trip + app backgrounding because AsyncStorage is on disk.
 */
const KEY = 'athanor.onboarding.draft';
const VERSION = 1 as const;

export type OnboardingDraft = {
  v: typeof VERSION;
  locale: Locale;
  identity_tags: string[];
  seeking: string[];
  dream: string;
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
      locale: (parsed.locale ?? 'it') as Locale,
      identity_tags: Array.isArray(parsed.identity_tags) ? parsed.identity_tags : [],
      seeking: Array.isArray(parsed.seeking) ? parsed.seeking : [],
      dream: typeof parsed.dream === 'string' ? parsed.dream : '',
    };
  } catch {
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

/** A draft worth flushing has at least the two required vocab answers (dream is optional). */
export function hasDraftAnswers(draft: OnboardingDraft | null): draft is OnboardingDraft {
  return !!draft && draft.identity_tags.length > 0 && draft.seeking.length > 0;
}
