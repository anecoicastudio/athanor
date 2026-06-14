import { describe, expect, it } from 'vitest';
import { handleSchema, publicProfileSchema } from './public-profile';

describe('handleSchema', () => {
  it('accepts a valid handle', () => {
    expect(handleSchema.parse('sole_99')).toBe('sole_99');
  });
  it('rejects uppercase, spaces, too-short, too-long', () => {
    expect(handleSchema.safeParse('Sole').success).toBe(false);
    expect(handleSchema.safeParse('a b').success).toBe(false);
    expect(handleSchema.safeParse('ab').success).toBe(false);
    expect(handleSchema.safeParse('x'.repeat(31)).success).toBe(false);
  });
});

describe('publicProfileSchema', () => {
  it('parses a fully public shaped row', () => {
    const parsed = publicProfileSchema.parse({
      handle: 'sole',
      bio: 'Designer',
      dream: {
        text: 'Aprire uno studio',
        milestones: [{ id: 'm1', body: 'Un logo', status: 'done' }],
      },
    });
    expect(parsed.dream?.milestones[0]?.status).toBe('done');
  });
  it('parses a row with bio blanked and no dream (nullable)', () => {
    const parsed = publicProfileSchema.parse({ handle: 'sole', bio: null, dream: null });
    expect(parsed.bio).toBeNull();
    expect(parsed.dream).toBeNull();
  });
  it('rejects an invalid milestone status', () => {
    expect(
      publicProfileSchema.safeParse({
        handle: 'sole',
        bio: null,
        dream: { text: 'x', milestones: [{ id: 'm1', body: 'y', status: 'bogus' }] },
      }).success,
    ).toBe(false);
  });
});
