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
  it('parses a valid row', () => {
    expect(
      waitlistEntrySchema.parse({
        id: '00000000-0000-0000-0000-000000000001',
        email: 'a@b.com',
        locale: 'it',
        source: null,
        created_at: '2026-06-14T00:00:00Z',
      }).email,
    ).toBe('a@b.com');
  });
});
