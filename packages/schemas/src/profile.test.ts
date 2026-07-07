import { describe, expect, it } from 'vitest';
import { profileSchema, profileUpdateSchema } from './profile';

const validRow = {
  id: '3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11',
  handle: 'stella_prima',
  bio: null,
  locale: 'it',
  visibility: { bio: 'public' },
  identity_tags: [],
  seeking: [],
  identity_verified: false,
  founding_member: true,
  created_at: '2026-07-07T00:00:00Z',
  updated_at: '2026-07-07T00:00:00Z',
};

describe('profileSchema — founding_member (P4.2)', () => {
  it('parses a row with the founding flag', () => {
    expect(profileSchema.parse(validRow).founding_member).toBe(true);
  });

  it('rejects a non-boolean founding_member', () => {
    expect(() => profileSchema.parse({ ...validRow, founding_member: 'yes' })).toThrow();
  });

  it('update schema strips founding_member (client can never write it)', () => {
    const parsed = profileUpdateSchema.parse({ bio: 'ciao', founding_member: true });
    expect(parsed).not.toHaveProperty('founding_member');
  });
});
