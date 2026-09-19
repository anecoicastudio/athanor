import { describe, expect, test } from 'vitest';
import { nextOnboardingStep } from './complete';

/**
 * #782 — the handle is chosen on its own screen AFTER the account exists, never derived from the
 * email. So an incomplete profile has two different ways back: the funnel (no answers yet — a
 * login on a new device, a Google sign-in with no draft) or the handle step (the funnel's answers
 * landed, the name is still missing). The guard routes on this; getting it backwards sends a
 * member who has answered everything back through five questions.
 */
describe('nextOnboardingStep', () => {
  const answered = { handle: null, identity_tags: ['imprenditore'], seeking: ['connessioni'] };

  test('null when the profile is complete — nothing left to ask', () => {
    expect(nextOnboardingStep({ ...answered, handle: 'marco' })).toBeNull();
  });

  test('handle when only the name is missing', () => {
    expect(nextOnboardingStep(answered)).toBe('handle');
  });

  test('funnel when there are no identity tags, even without a handle', () => {
    expect(nextOnboardingStep({ ...answered, identity_tags: [] })).toBe('funnel');
  });

  test('funnel when there is nothing sought, even without a handle', () => {
    expect(nextOnboardingStep({ ...answered, seeking: [] })).toBe('funnel');
  });

  test('funnel when the answers are missing but a handle exists — the answers come first', () => {
    expect(nextOnboardingStep({ handle: 'marco', identity_tags: [], seeking: [] })).toBe('funnel');
  });

  test('an empty-string handle counts as missing', () => {
    expect(nextOnboardingStep({ ...answered, handle: '' })).toBe('handle');
  });
});
