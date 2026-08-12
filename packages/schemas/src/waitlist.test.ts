import { describe, expect, it } from 'vitest';
import { waitlistEntrySchema, waitlistInsertSchema } from './waitlist';

describe('waitlistInsertSchema', () => {
  it('normalizes email (trim + lowercase) — the dedup contract', () => {
    expect(waitlistInsertSchema.parse({ email: '  Foo.Bar@Example.COM ' }).email).toBe(
      'foo.bar@example.com',
    );
  });
  it('defaults locale to it', () => {
    expect(waitlistInsertSchema.parse({ email: 'a@b.com' }).locale).toBe('it');
  });
  it('accepts en locale + source', () => {
    const parsed = waitlistInsertSchema.parse({
      email: 'a@b.com',
      locale: 'en',
      source: 'landing-hero',
    });
    expect(parsed.locale).toBe('en');
    expect(parsed.source).toBe('landing-hero');
  });
  it('rejects an invalid email', () => {
    expect(() => waitlistInsertSchema.parse({ email: 'not-an-email' })).toThrow();
  });
  it('rejects a source over 80 chars', () => {
    expect(() =>
      waitlistInsertSchema.parse({ email: 'a@b.com', source: 'x'.repeat(81) }),
    ).toThrow();
  });
});

describe('waitlistEntrySchema', () => {
  const validRow = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'a@b.com',
    locale: 'it',
    source: null,
    created_at: '2026-06-14T00:00:00Z',
  };

  it('parses a valid row', () => {
    expect(waitlistEntrySchema.parse(validRow).email).toBe('a@b.com');
  });

  // The insert schema's 80-char source bound is asserted above; the row schema's was not, so it
  // could have been any other bound — including one that rejects every real tag — unnoticed.
  it('bounds source to 80 chars on the row, not only on the insert', () => {
    expect(waitlistEntrySchema.parse({ ...validRow, source: 'landing-hero' }).source).toBe(
      'landing-hero',
    );
    expect(waitlistEntrySchema.parse({ ...validRow, source: 'x'.repeat(80) }).source).toHaveLength(
      80,
    );
    expect(() => waitlistEntrySchema.parse({ ...validRow, source: 'x'.repeat(81) })).toThrow();
  });
});
