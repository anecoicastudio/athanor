import { describe, expect, test } from 'vitest';
import { dreamInsertSchema, dreamUpdateSchema } from './dream';

describe('dreamInsertSchema', () => {
  test('accepts text up to 500 chars', () => {
    expect(
      dreamInsertSchema.parse({
        profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111',
        text: 'x'.repeat(500),
      }),
    ).toBeTruthy();
  });

  test('rejects text over 500 chars', () => {
    expect(() =>
      dreamInsertSchema.parse({
        profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111',
        text: 'x'.repeat(501),
      }),
    ).toThrow();
  });

  test('rejects blank text', () => {
    expect(() =>
      dreamInsertSchema.parse({ profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111', text: '   ' }),
    ).toThrow();
  });
});

describe('dreamUpdateSchema', () => {
  test('accepts and trims a valid dream', () => {
    expect(dreamUpdateSchema.parse({ text: '  Aprire uno studio  ' })).toEqual({
      text: 'Aprire uno studio',
    });
  });

  test('rejects a blank / whitespace-only dream', () => {
    expect(dreamUpdateSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(dreamUpdateSchema.safeParse({ text: '' }).success).toBe(false);
  });

  test('rejects a dream over 500 chars', () => {
    expect(dreamUpdateSchema.safeParse({ text: 'a'.repeat(501) }).success).toBe(false);
  });

  test('accepts exactly 500 chars', () => {
    expect(dreamUpdateSchema.safeParse({ text: 'a'.repeat(500) }).success).toBe(true);
  });
});
