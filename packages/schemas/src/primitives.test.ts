import { describe, expect, test } from 'vitest';
import { nonBlankString, trimmedNonBlank } from './primitives.ts';

describe('nonBlankString (read idiom — no transform)', () => {
  const schema = nonBlankString(10, 'must not be blank');

  test('accepts non-blank and preserves the value byte-identical (incl. whitespace)', () => {
    expect(schema.parse('hello')).toBe('hello');
    expect(schema.parse('  padded  ')).toBe('  padded  '); // DB rows round-trip untouched
  });

  test('rejects empty and whitespace-only with the given message', () => {
    for (const bad of ['', '   ', '\n\t']) {
      const r = schema.safeParse(bad);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe('must not be blank');
    }
  });

  test('rejects over max length', () => {
    expect(schema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(schema.safeParse('a'.repeat(10)).success).toBe(true);
  });
});

describe('trimmedNonBlank (write idiom — trims then 1..max)', () => {
  const schema = trimmedNonBlank(5, 'blank!');

  test('trims the value before validating', () => {
    expect(schema.parse('  ok  ')).toBe('ok');
  });

  test('rejects blank-after-trim with the given message', () => {
    const r = schema.safeParse('   ');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('blank!');
  });

  test('max applies AFTER trim', () => {
    expect(schema.safeParse('  12345  ').success).toBe(true); // 5 after trim
    expect(schema.safeParse('123456').success).toBe(false);
  });

  test('message is optional (zod default used)', () => {
    const bare = trimmedNonBlank(5);
    expect(bare.safeParse('').success).toBe(false);
  });
});
