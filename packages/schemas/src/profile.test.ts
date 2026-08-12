import { describe, expect, it } from 'vitest';
import { personProfileSchema, profileSchema, profileUpdateSchema } from './profile';

const validRow = {
  id: '3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11',
  handle: 'stella_prima',
  display_name: 'Stella Prima',
  avatar_path: '3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11/3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11.jpg',
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

describe('profileSchema — display_name and avatar_path (#75)', () => {
  it('accepts a profile carrying neither — both are optional by product decision', () => {
    const parsed = profileSchema.parse({ ...validRow, display_name: null, avatar_path: null });
    expect(parsed.display_name).toBeNull();
    expect(parsed.avatar_path).toBeNull();
  });

  it('rejects a name longer than the column CHECK allows', () => {
    expect(() => profileSchema.parse({ ...validRow, display_name: 'x'.repeat(61) })).toThrow();
  });

  it('rejects a whitespace-only name, which would render as a blank', () => {
    // Mirrors profiles_display_name_shape: at least one non-whitespace character.
    expect(() => profileSchema.parse({ ...validRow, display_name: '   ' })).toThrow();
  });

  it('both are client-writable, unlike founding_member', () => {
    const parsed = profileUpdateSchema.parse({
      display_name: 'Stella',
      avatar_path: 'a/b.jpg',
    });
    expect(parsed.display_name).toBe('Stella');
    expect(parsed.avatar_path).toBe('a/b.jpg');
  });

  it('reads the stored name back byte-identical — the read shape never trims (#76)', () => {
    // A read schema that trimmed would make the rendered name differ from the column, and
    // a round-tripped row would silently rewrite it. Normalisation belongs to the write side.
    const parsed = profileSchema.parse({ ...validRow, display_name: 'Stella ' });
    expect(parsed.display_name).toBe('Stella ');
  });

  it('trims on write, so a padded name reaches the column normalised (#76)', () => {
    expect(profileUpdateSchema.parse({ display_name: '  Stella  ' }).display_name).toBe('Stella');
  });

  it('accepts clearing the name back to null', () => {
    expect(profileUpdateSchema.parse({ display_name: null }).display_name).toBeNull();
  });

  it('rejects a name that is only padding on write', () => {
    expect(() => profileUpdateSchema.parse({ display_name: '   ' })).toThrow();
  });
});

describe('personProfileSchema — third-person identity (#76)', () => {
  const personRow = {
    id: validRow.id,
    handle: validRow.handle,
    display_name: 'Stella Prima',
    avatar_path: validRow.avatar_path,
    bio: null,
    identity_tags: null,
    seeking: null,
    identity_verified: false,
    founding_member: true,
  };

  it('carries the name and the avatar another member may render', () => {
    const parsed = personProfileSchema.parse(personRow);
    expect(parsed.display_name).toBe('Stella Prima');
    expect(parsed.avatar_path).toBe(validRow.avatar_path);
  });

  it('accepts a member who set neither', () => {
    const parsed = personProfileSchema.parse({
      ...personRow,
      display_name: null,
      avatar_path: null,
    });
    expect(parsed.display_name).toBeNull();
  });

  it('never carries own-only columns, whatever the RPC returns', () => {
    const parsed = personProfileSchema.parse({ ...personRow, locale: 'it', visibility: {} });
    expect(parsed).not.toHaveProperty('locale');
    expect(parsed).not.toHaveProperty('visibility');
  });
});
