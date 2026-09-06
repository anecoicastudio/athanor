import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingDraft } from './onboarding-draft';

/**
 * Which failures keep the draft and which drop it (#694). The stake is a trap: the guard routes
 * an incomplete profile back to the funnel, the funnel rehydrates the draft, and the flush
 * effect does not re-run on foreground — so a draft the server will refuse the same way every
 * time must be dropped, and only a transport-shaped failure may be retried.
 */
const api = vi.hoisted(() => ({
  updates: [] as unknown[],
  failWith: null as null | { code: string },
}));
const draftState = vi.hoisted(() => ({
  draft: null as OnboardingDraft | null,
  cleared: false,
}));

vi.mock('@athanor/api', () => ({
  updateOnboardingProfileWithHandleFallback: async (
    _client: unknown,
    _userId: string,
    answers: unknown,
  ) => {
    if (api.failWith) throw Object.assign(new Error('refused'), api.failWith);
    api.updates.push(answers);
    return 'handle';
  },
  updateProfile: async () => {},
  upsertActiveDream: async () => {},
}));
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('@/lib/media/avatar-upload', () => ({ uploadAvatarImage: async () => 'k' }));
vi.mock('@/lib/log', () => ({ devWarn: () => {} }));
vi.mock('./onboarding-draft', () => ({
  loadDraft: async () => draftState.draft,
  clearDraft: async () => {
    draftState.cleared = true;
  },
  hasDraftAnswers: (d: OnboardingDraft | null) =>
    !!d && d.identity_tags.length > 0 && d.seeking.length > 0 && d.birth_date !== null,
}));

import { flushOnboardingDraft } from './flush-onboarding';

const valid: OnboardingDraft = {
  v: 3,
  locale: 'it',
  identity_tags: ['coach'],
  seeking: ['connessioni'],
  dream: '',
  avatar_uri: null,
  birth_date: '1990-08-10',
};

beforeEach(() => {
  api.updates = [];
  api.failWith = null;
  draftState.draft = { ...valid };
  draftState.cleared = false;
});

describe('flushOnboardingDraft', () => {
  it('flushes a complete draft, birth_date included, and clears it', async () => {
    await expect(flushOnboardingDraft('u1', 'lucia@example.com')).resolves.toBe('flushed');
    expect(api.updates).toHaveLength(1);
    expect(api.updates[0]).toMatchObject({ birth_date: '1990-08-10', handle: 'lucia' });
    expect(draftState.cleared).toBe(true);
  });

  it('reports nodraft when the draft has no birth date — the funnel gate, not the flush, asks for it', async () => {
    draftState.draft = { ...valid, birth_date: null };
    await expect(flushOnboardingDraft('u1', 'lucia@example.com')).resolves.toBe('nodraft');
    expect(api.updates).toHaveLength(0);
  });

  it('drops a draft the schema refuses (an impossible day) rather than looping on it', async () => {
    draftState.draft = { ...valid, birth_date: '2023-02-29' };
    await expect(flushOnboardingDraft('u1', 'lucia@example.com')).resolves.toBe('error');
    expect(api.updates).toHaveLength(0);
    expect(draftState.cleared).toBe(true);
  });

  it('drops the draft on a check_violation — the 14+ guard or the 1900 floor cannot pass on retry', async () => {
    api.failWith = { code: '23514' };
    await expect(flushOnboardingDraft('u1', 'lucia@example.com')).resolves.toBe('error');
    expect(draftState.cleared).toBe(true);
  });

  it('KEEPS the draft on a transport-shaped failure, so the next foreground retries', async () => {
    api.failWith = { code: '57P01' };
    await expect(flushOnboardingDraft('u1', 'lucia@example.com')).resolves.toBe('error');
    expect(draftState.cleared).toBe(false);
  });

  it('still drops a draft with an off-vocabulary tag (pre-existing rule)', async () => {
    draftState.draft = { ...valid, identity_tags: ['hacker'] };
    await expect(flushOnboardingDraft('u1', 'lucia@example.com')).resolves.toBe('error');
    expect(api.updates).toHaveLength(0);
    expect(draftState.cleared).toBe(true);
  });
});
