import { describe, expect, test } from 'vitest';
import { dreamInsertSchema, dreamSchema, dreamUpdateSchema } from './dream';

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

const dreamRow = {
  id: '11111111-1111-1111-1111-111111111111',
  profile_id: '2e9c0a52-0b1e-4d1f-9c39-1d6a3a111111',
  text: 'Aprire uno studio',
  status: 'active',
  created_at: '2026-06-14T00:00:00Z',
  updated_at: '2026-06-14T00:00:00Z',
  deleted_at: null,
};

describe('dreamSchema', () => {
  test('parses a row unchanged', () => {
    expect(dreamSchema.parse(dreamRow)).toEqual(dreamRow);
  });

  test('status is active | archived — the one live dream and its history', () => {
    expect(dreamSchema.shape.status.options).toEqual(['active', 'archived']);
    expect(dreamSchema.safeParse({ ...dreamRow, status: 'paused' }).success).toBe(false);
  });

  test('carries exactly the dreams columns', () => {
    expect(Object.keys(dreamSchema.shape)).toEqual([
      'id',
      'profile_id',
      'text',
      'status',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('rejects a blank text on the row — the CHECK mirrors nonBlankString', () => {
    expect(dreamSchema.safeParse({ ...dreamRow, text: '   ' }).success).toBe(false);
  });
});

describe('dreamInsertSchema shape', () => {
  test('carries exactly profile_id and text', () => {
    expect(Object.keys(dreamInsertSchema.shape).sort()).toEqual(['profile_id', 'text']);
  });

  test('requires profile_id', () => {
    expect(dreamInsertSchema.safeParse({ text: 'x' }).success).toBe(false);
  });
});
