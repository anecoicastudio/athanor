import { describe, expect, it, vi } from 'vitest';

/**
 * The policy states the minimum age the code enforces, so it must READ it, not restate it:
 * #778 moves the launch age, and a copied number would keep promising the old one. Mocking the
 * constant to a value no sentence would ever carry proves the page follows `MIN_MEMBER_AGE`
 * rather than a literal that happens to match it. Its own file, because `vi.mock` is hoisted
 * over every test in the module.
 */
vi.mock('@athanor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@athanor/core')>()),
  MIN_MEMBER_AGE: 97,
}));

const { privacy } = await import('./legal-content');

describe('privacy — minimum age', () => {
  it.each(['it', 'en'] as const)('%s states the age MIN_MEMBER_AGE enforces', (loc) => {
    const heading = loc === 'it' ? 'Età minima' : 'Minimum age';
    const section = privacy[loc].sections.find((s) => s.heading === heading);
    expect(section).toBeDefined();
    expect(section!.body.join('\n')).toContain('97');
  });
});
