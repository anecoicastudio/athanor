import { describe, expect, it } from 'vitest';
import { waitlistAdminRowSchema, waitlistInsertSchema } from './waitlist.ts';

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

describe('waitlistAdminRowSchema', () => {
  const row = {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'a@b.it',
    locale: 'it',
    source: 'landing-hero',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('accepts the RPC projection, null source included', () => {
    expect(waitlistAdminRowSchema.parse(row)).toEqual(row);
    expect(waitlistAdminRowSchema.parse({ ...row, source: null }).source).toBeNull();
  });

  it('requires the id — it is the keyset tie-break (#335)', () => {
    const { id: _id, ...noId } = row;
    expect(waitlistAdminRowSchema.safeParse(noId).success).toBe(false);
    expect(waitlistAdminRowSchema.safeParse({ ...row, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('mirrors the column CHECK on locale', () => {
    expect(waitlistAdminRowSchema.safeParse({ ...row, locale: 'fr' }).success).toBe(false);
  });

  it('does not re-validate the address shape: a stored row is evidence, not input', () => {
    // The insert schema normalises and `.email()`s; re-applying that on the way out would
    // withhold a signup the database accepted, which on an export reads as a smaller list.
    expect(waitlistAdminRowSchema.safeParse({ ...row, email: 'odd' }).success).toBe(true);
    expect(waitlistAdminRowSchema.safeParse({ ...row, email: 'ab' }).success).toBe(false);
  });

  it('mirrors the column CHECK on length (3..320), not the insert schema', () => {
    const at = (n: number) => `${'a'.repeat(n - 6)}@b.it`.padEnd(n, 'x');
    expect(waitlistAdminRowSchema.safeParse({ ...row, email: at(320) }).success).toBe(true);
    expect(waitlistAdminRowSchema.safeParse({ ...row, email: at(321) }).success).toBe(false);
  });

  it('requires created_at as a string — it is half of the cursor', () => {
    expect(waitlistAdminRowSchema.safeParse({ ...row, created_at: 1700000000 }).success).toBe(
      false,
    );
    const { created_at: _ts, ...noTs } = row;
    expect(waitlistAdminRowSchema.safeParse(noTs).success).toBe(false);
  });
});

describe('waitlist locale', () => {
  // Both shapes take the locale from profile.ts's localeSchema — one vocabulary, not three
  // copies of it; the literal list here is what a dropped member fails.
  it('is it | en on the row and on the insert', () => {
    expect(waitlistAdminRowSchema.shape.locale.options).toEqual(['it', 'en']);
    expect(waitlistInsertSchema.shape.locale.removeDefault().options).toEqual(['it', 'en']);
    expect(waitlistInsertSchema.safeParse({ email: 'a@b.com', locale: 'fr' }).success).toBe(false);
    const enRow = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'a@b.it',
      locale: 'en',
      source: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(waitlistAdminRowSchema.parse(enRow).locale).toBe('en');
  });
});
