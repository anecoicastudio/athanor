import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ mem: new Map<string, string>(), throwOnSet: false }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      if (store.throwOnSet) throw new Error('disk full');
      store.mem.set(k, v);
    },
    removeItem: async (k: string) => {
      store.mem.delete(k);
    },
  },
}));

import { deviceLocale } from './locale';
import {
  clearDraft,
  hasDraftAnswers,
  loadDraft,
  saveDraft,
  type OnboardingDraft,
} from './onboarding-draft';

const KEY = 'athanor.onboarding.draft';
// The stamp the module writes today. Read from the module so a bump does not silently make
// these assertions test a version nothing produces any more.
const DRAFT_VERSION = 3;

const ANSWERS = {
  locale: 'it' as const,
  identity_tags: ['maker'],
  seeking: ['collab'],
  dream: 'aprire un forno',
  avatar_uri: null,
  birth_date: '1990-08-10',
};

beforeEach(() => {
  store.mem.clear();
  store.throwOnSet = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // silence __DEV__ warnings
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveDraft / loadDraft', () => {
  it('round-trips a draft with the current version stamp', async () => {
    await saveDraft(ANSWERS);
    expect(await loadDraft()).toEqual({ v: DRAFT_VERSION, ...ANSWERS });
  });

  it('version mismatch → null (old drafts invalidated)', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 99, ...ANSWERS }));
    expect(await loadDraft()).toBeNull();
  });

  it('corrupt JSON → null, no throw (__DEV__ warn path)', async () => {
    store.mem.set(KEY, '{broken');
    await expect(loadDraft()).resolves.toBeNull();
  });

  // `locale: deviceLocale` and not `'it'` (#331): a stored draft that predates the locale
  // field follows the device, the same rule useLocale() applies to a profile without one.
  // Asserting the constant cannot catch a regression BACK to 'it' on an Italian machine —
  // `source-audit.test.ts` is what does that, by failing on any hardcoded locale fallback.
  it('missing fields fall back to safe defaults', async () => {
    store.mem.set(KEY, JSON.stringify({ v: DRAFT_VERSION }));
    expect(await loadDraft()).toEqual({
      v: DRAFT_VERSION,
      locale: deviceLocale,
      identity_tags: [],
      seeking: [],
      dream: '',
      avatar_uri: null,
      birth_date: null,
    });
  });

  it('a non-string birth_date reads as null rather than as a value (#694)', async () => {
    store.mem.set(KEY, JSON.stringify({ v: DRAFT_VERSION, ...ANSWERS, birth_date: 19900810 }));
    expect((await loadDraft())?.birth_date).toBeNull();
  });

  it('a v2 draft (no birth_date) is invalidated, not migrated', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 2, ...ANSWERS }));
    expect(await loadDraft()).toBeNull();
  });

  it('a failed write does not throw (__DEV__ warn path)', async () => {
    store.throwOnSet = true;
    await expect(saveDraft(ANSWERS)).resolves.toBeUndefined();
  });

  it('clearDraft removes the stored draft', async () => {
    await saveDraft(ANSWERS);
    await clearDraft();
    expect(await loadDraft()).toBeNull();
  });
});

describe('hasDraftAnswers', () => {
  const draft = (over: Partial<OnboardingDraft>): OnboardingDraft => ({
    v: DRAFT_VERSION,
    ...ANSWERS,
    ...over,
  });

  it('null → false', () => {
    expect(hasDraftAnswers(null)).toBe(false);
  });

  it('needs both vocab answers and a birth date; dream and photo are optional', () => {
    expect(hasDraftAnswers(draft({}))).toBe(true);
    expect(hasDraftAnswers(draft({ dream: '' }))).toBe(true);
    expect(hasDraftAnswers(draft({ avatar_uri: null }))).toBe(true);
    expect(hasDraftAnswers(draft({ identity_tags: [] }))).toBe(false);
    expect(hasDraftAnswers(draft({ seeking: [] }))).toBe(false);
    // #694: a draft with no date cannot satisfy onboardingAnswersSchema — not worth a round trip.
    expect(hasDraftAnswers(draft({ birth_date: null }))).toBe(false);
  });
});
