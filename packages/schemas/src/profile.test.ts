import { describe, expect, it } from 'vitest';
import { personProfileSchema, profileSchema, profileUpdateSchema } from './profile';

const validRow = {
  id: '3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11',
  handle: 'stella_prima',
  display_name: 'Stella Prima',
  avatar_path: '3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11/3f2f0e5e-6f0a-4b7e-9a4b-0d9d2c1a8e11.jpg',
  bio: null,
  mission: null,
  skills: [],
  profession: null,
  city: null,
  city_geohash: null,
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
    mission: null,
    identity_tags: null,
    seeking: null,
    skills: null,
    profession: null,
    city: null,
    identity_verified: false,
    founding_member: true,
    removed: false,
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

  it('parses the tombstone a banned member projects (#314)', () => {
    // Exactly what get_person_profile returns once banned_at is set: the row RESOLVES, and
    // carries nothing. The flag is what separates it from a row that never came back at all.
    const parsed = personProfileSchema.parse({
      ...personRow,
      handle: null,
      display_name: null,
      avatar_path: null,
      identity_verified: false,
      founding_member: false,
      removed: true,
    });
    expect(parsed.removed).toBe(true);
    expect(parsed.display_name).toBeNull();
    expect(parsed.avatar_path).toBeNull();
    expect(parsed.handle).toBeNull();
  });

  it('rejects a projection with no removed flag — the client must never have to guess', () => {
    const { removed: _omitted, ...withoutFlag } = personRow;
    expect(() => personProfileSchema.parse(withoutFlag)).toThrow();
  });

  it('strips city_geohash — another member’s cell is never client-visible (#149)', () => {
    const parsed = personProfileSchema.parse({ ...personRow, city_geohash: 'u0nd9' });
    expect(parsed).not.toHaveProperty('city_geohash');
  });
});

describe('profileSchema — mission, skills, profession, city (#149)', () => {
  it('parses a full new-field row', () => {
    const parsed = profileSchema.parse({
      ...validRow,
      mission: 'Portare arte nelle scuole',
      skills: ['illustrazione', 'storytelling'],
      profession: 'arte',
      city: 'Milano',
      city_geohash: 'u0nd9',
    });
    expect(parsed.skills).toEqual(['illustrazione', 'storytelling']);
    expect(parsed.city_geohash).toBe('u0nd9');
  });

  it('rejects a malformed geohash — shape mirrors the column CHECK', () => {
    expect(() => profileSchema.parse({ ...validRow, city_geohash: 'u0ndA' })).toThrow();
    expect(() => profileSchema.parse({ ...validRow, city_geohash: 'toolong7' })).toThrow();
  });

  it('rejects more than 10 skills, mirroring the column CHECK', () => {
    expect(() =>
      profileSchema.parse({ ...validRow, skills: Array.from({ length: 11 }, (_, i) => `s${i}`) }),
    ).toThrow();
  });

  it('all five are client-writable through the update schema', () => {
    const parsed = profileUpdateSchema.parse({
      mission: 'm',
      skills: ['seo'],
      profession: 'marketing',
      city: 'Roma',
      city_geohash: 'sr2yk',
    });
    expect(parsed.city_geohash).toBe('sr2yk');
  });

  it('accepts clearing city and geohash back to null (free-text path)', () => {
    const parsed = profileUpdateSchema.parse({ city: 'Atlantide', city_geohash: null });
    expect(parsed.city).toBe('Atlantide');
    expect(parsed.city_geohash).toBeNull();
  });
});

describe('profileUpdateSchema handle reservation (#430)', () => {
  // `handle` carries UPDATE for `authenticated`, so the edit path is a claim path too — a
  // reserved handle refused only at onboarding would be one PATCH away from being claimed.
  it('rejects a reserved handle', () => {
    expect(profileUpdateSchema.safeParse({ handle: 'moderatore' }).success).toBe(false);
  });

  it('rejects a brand-prefixed handle', () => {
    expect(profileUpdateSchema.safeParse({ handle: 'athanorofficial' }).success).toBe(false);
  });

  it('accepts an ordinary handle', () => {
    expect(profileUpdateSchema.safeParse({ handle: 'stella_prima' }).success).toBe(true);
  });

  it('still accepts a null handle', () => {
    // The column is nullable and the read shape stays nullable; the refinement must not turn
    // "no handle yet" into a validation error.
    expect(profileUpdateSchema.safeParse({ handle: null }).success).toBe(true);
  });
});
