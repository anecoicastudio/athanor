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
      displayName: 'Sole Marini',
      avatarUrl: 'https://x.supabase.co/storage/v1/object/sign/avatars/u/u.jpg?token=t',
      bio: 'Designer',
      dream: {
        text: 'Aprire uno studio',
        milestones: [{ id: 'm1', body: 'Un logo', status: 'done' }],
      },
    });
    expect(parsed.dream?.milestones[0]?.status).toBe('done');
    expect(parsed.displayName).toBe('Sole Marini');
  });
  it('parses the bare shell: name/avatar/bio/dream all null (a member who set nothing)', () => {
    const parsed = publicProfileSchema.parse({
      handle: 'sole',
      displayName: null,
      avatarUrl: null,
      bio: null,
      dream: null,
    });
    expect(parsed.displayName).toBeNull();
    expect(parsed.avatarUrl).toBeNull();
    expect(parsed.bio).toBeNull();
    expect(parsed.dream).toBeNull();
  });
  it('rejects an invalid milestone status', () => {
    expect(
      publicProfileSchema.safeParse({
        handle: 'sole',
        displayName: null,
        avatarUrl: null,
        bio: null,
        dream: { text: 'x', milestones: [{ id: 'm1', body: 'y', status: 'bogus' }] },
      }).success,
    ).toBe(false);
  });
  // avatarUrl is a SIGNED url, never a storage key — a bare key here means someone skipped
  // the signing step and the page would render a broken image against a private bucket.
  it('rejects a storage key where the signed avatar URL belongs', () => {
    expect(
      publicProfileSchema.safeParse({
        handle: 'sole',
        displayName: null,
        avatarUrl: 'u/u.jpg',
        bio: null,
        dream: null,
      }).success,
    ).toBe(false);
  });
  it('rejects a blank display name (column CHECK mirrors nonBlankString)', () => {
    expect(
      publicProfileSchema.safeParse({
        handle: 'sole',
        displayName: '   ',
        avatarUrl: null,
        bio: null,
        dream: null,
      }).success,
    ).toBe(false);
  });
});
