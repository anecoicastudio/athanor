import { describe, expect, test } from 'vitest';
import { dreamInsertSchema } from './dream';

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
