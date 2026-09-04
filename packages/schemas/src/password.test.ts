import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENTS,
  passwordSchema,
  unmetPasswordRequirements,
} from './password.ts';

describe('unmetPasswordRequirements', () => {
  it('accepts a password that meets all four rules', () => {
    expect(unmetPasswordRequirements('Abcdefg1')).toEqual([]);
  });

  it('accepts exactly the minimum length', () => {
    expect('Abcdefg1').toHaveLength(PASSWORD_MIN_LENGTH);
    expect(unmetPasswordRequirements('Abcdefg1')).toEqual([]);
  });

  it('reports length one character short', () => {
    expect(unmetPasswordRequirements('Abcdef1')).toEqual(['length']);
  });

  it('reports every missing class at once, in display order', () => {
    expect(unmetPasswordRequirements('abcdefgh')).toEqual(['uppercase', 'digit']);
    expect(unmetPasswordRequirements('abc')).toEqual(['length', 'uppercase', 'digit']);
  });

  it('reports a missing lowercase', () => {
    expect(unmetPasswordRequirements('ABCDEFG1')).toEqual(['lowercase']);
  });

  it('counts only ASCII classes, matching what GoTrue enforces server-side', () => {
    // `È` is uppercase to a unicode-aware check but not to GoTrue's `A-Z` set —
    // accepting it here would hand the user a server-side weak_password error.
    expect(unmetPasswordRequirements('Èbcdefg1')).toEqual(['uppercase']);
  });

  it('lists every requirement for an empty password', () => {
    expect(unmetPasswordRequirements('')).toEqual([...PASSWORD_REQUIREMENTS]);
  });
});

describe('passwordSchema', () => {
  const SAMPLES = [
    'Abcdefg1',
    'Abcdef1',
    'abcdefgh',
    'ABCDEFG1',
    'abc',
    '',
    'Èbcdefg1',
    'Str0ngEnough',
  ];

  it('agrees with unmetPasswordRequirements on every sample', () => {
    for (const sample of SAMPLES) {
      expect(passwordSchema.safeParse(sample).success).toBe(
        unmetPasswordRequirements(sample).length === 0,
      );
    }
  });

  it('surfaces one issue per unmet requirement, identified by message', () => {
    const result = passwordSchema.safeParse('abcdefgh');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toEqual(['uppercase', 'digit']);
  });
});
