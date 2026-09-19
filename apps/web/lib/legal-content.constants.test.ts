import { describe, expect, it, vi } from 'vitest';

/**
 * The policy states numbers the code enforces — the minimum age, and how the Aura engine scores
 * and decays — so it must READ them, not restate them: #778 moves the launch age, and rule 10
 * keeps the engine's constants server-tunable. A copied number would keep promising the old
 * value. Mocking each constant to one no sentence would ever carry proves the page follows
 * `@athanor/core` rather than a literal that happens to match it. Its own file, because
 * `vi.mock` is hoisted over every test in the module.
 */
vi.mock('@athanor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@athanor/core')>();
  return {
    ...actual,
    MIN_MEMBER_AGE: 97,
    SCORE_MIN: 3,
    SCORE_MAX: 4321,
    REACTION_AUTHOR_MIN_SCORE: 777,
    DECAY: { ...actual.DECAY, IDLE_DAYS_BEFORE: 61, WEEKLY_FACTOR: 0.93, PEAK_FLOOR_RATIO: 0.29 },
  };
});

const { privacy } = await import('./legal-content');

const section = (loc: 'it' | 'en', starts: string) =>
  privacy[loc].sections.find((s) => s.heading.startsWith(starts))?.body.join('\n') ?? '';

describe('privacy follows @athanor/core', () => {
  it.each([
    ['it', 'Età minima'],
    ['en', 'Minimum age'],
  ] as const)('%s states the age MIN_MEMBER_AGE enforces', (loc, heading) => {
    expect(section(loc, heading)).toContain('97');
  });

  it.each([
    ['it', "Nell'app: Aura", ['da 3 a 4321', '777 punti', '61 giorni', '7%', '29%']],
    ['en', 'In the app: Aura', ['from 3 to 4321', '777 Aura', '61 days', '7%', '29%']],
  ] as const)(
    '%s states the Aura range, star gate and decay the engine uses',
    (loc, heading, parts) => {
      const text = section(loc, heading);
      for (const part of parts) expect(text, part).toContain(part);
    },
  );
});
