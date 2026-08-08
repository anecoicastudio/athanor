import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './pg-error';

describe('isUniqueViolation', () => {
  it('recognises a PostgrestError-shaped 23505', () => {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value' })).toBe(true);
  });

  it('a bare { code } object is enough — the shape is duck-typed', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('other Postgres codes are not unique violations', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false); // foreign key
    expect(isUniqueViolation({ code: '42501' })).toBe(false); // RLS / insufficient privilege
    expect(isUniqueViolation({ code: 'PGRST116' })).toBe(false);
  });

  it('matches on the string code only — a numeric 23505 does not count', () => {
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });

  it('an error without a code is not a unique violation', () => {
    expect(isUniqueViolation({ message: 'network request failed' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });

  it('null and undefined are safe — no property access on nothing', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('non-object throwables are safe', () => {
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(23505)).toBe(false);
    expect(isUniqueViolation(false)).toBe(false);
  });

  it('an inherited code does not count as own-property duck typing would suggest', () => {
    // `in` walks the prototype chain, so an inherited code IS matched — pinning
    // the actual behaviour rather than an assumption about it.
    const proto = { code: '23505' };
    expect(isUniqueViolation(Object.create(proto))).toBe(true);
  });
});
