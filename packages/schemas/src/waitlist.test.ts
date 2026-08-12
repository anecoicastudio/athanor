import { describe, expect, it } from 'vitest';
import { waitlistInsertSchema } from './waitlist';

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
