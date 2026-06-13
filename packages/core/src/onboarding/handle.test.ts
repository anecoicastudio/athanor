import { describe, expect, test } from 'vitest';
import { suggestHandle } from './handle';

describe('suggestHandle', () => {
  test('uses the email local part lowercased', () => {
    expect(suggestHandle('Lucia.Ferri@example.com')).toBe('lucia_ferri');
  });

  test('replaces invalid characters with underscore', () => {
    expect(suggestHandle('lucia+kaira@example.com')).toBe('lucia_kaira');
  });

  test('collapses consecutive underscores', () => {
    expect(suggestHandle('l..u@example.com')).toBe('l_u');
  });

  test('pads to minimum 3 chars', () => {
    expect(suggestHandle('ab@example.com')).toBe('ab_');
  });

  test('truncates to 30 chars', () => {
    expect(suggestHandle(`${'a'.repeat(40)}@example.com`)).toBe('a'.repeat(30));
  });

  test('falls back for empty local part', () => {
    expect(suggestHandle('@example.com')).toBe('aura');
  });
});
