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

import {
  clearDraft,
  hasDraftAnswers,
  loadDraft,
  saveDraft,
  type OnboardingDraft,
} from './onboarding-draft';

const KEY = 'athanor.onboarding.draft';

const ANSWERS = {
  locale: 'it' as const,
  identity_tags: ['maker'],
  seeking: ['collab'],
  dream: 'aprire un forno',
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
    expect(await loadDraft()).toEqual({ v: 1, ...ANSWERS });
  });

  it('version mismatch → null (old drafts invalidated)', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 99, ...ANSWERS }));
    expect(await loadDraft()).toBeNull();
  });

  it('corrupt JSON → null, no throw (__DEV__ warn path)', async () => {
    store.mem.set(KEY, '{broken');
    await expect(loadDraft()).resolves.toBeNull();
  });

  it('missing fields fall back to safe defaults', async () => {
    store.mem.set(KEY, JSON.stringify({ v: 1 }));
    expect(await loadDraft()).toEqual({
      v: 1,
      locale: 'it',
      identity_tags: [],
      seeking: [],
      dream: '',
    });
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
    v: 1,
    ...ANSWERS,
    ...over,
  });

  it('null → false', () => {
    expect(hasDraftAnswers(null)).toBe(false);
  });

  it('needs both vocab answers; dream is optional', () => {
    expect(hasDraftAnswers(draft({}))).toBe(true);
    expect(hasDraftAnswers(draft({ dream: '' }))).toBe(true);
    expect(hasDraftAnswers(draft({ identity_tags: [] }))).toBe(false);
    expect(hasDraftAnswers(draft({ seeking: [] }))).toBe(false);
  });
});
