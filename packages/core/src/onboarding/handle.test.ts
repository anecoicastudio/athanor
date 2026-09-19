import { describe, expect, test } from 'vitest';
import { RESERVED_HANDLES } from '@athanor/schemas';
import { classifyHandle, normalizeHandleInput } from './handle';

/**
 * #782 — the @handle is chosen by the person and never derived from the email: no suggestion,
 * not even a prefilled one. What remains for core is to say, of what was typed, whether it can
 * be claimed and if not WHY — a refused handle always says why on screen (#769's lesson). Whether
 * it is already somebody's is a database question, answered by the caller.
 */
describe('normalizeHandleInput', () => {
  test('lowercases what was typed — the column holds lowercase only', () => {
    expect(normalizeHandleInput('Lucia_Ferri')).toBe('lucia_ferri');
  });

  test('drops the @ a person types out of habit', () => {
    expect(normalizeHandleInput('@lucia')).toBe('lucia');
  });

  test('drops only ONE leading @ — a second one is still there to be refused', () => {
    expect(normalizeHandleInput('@@lucia')).toBe('@lucia');
  });

  test('keeps an @ that is not leading, so it is refused rather than silently removed', () => {
    expect(normalizeHandleInput('lu@cia')).toBe('lu@cia');
  });

  test('drops leading whitespace, before the @ is looked for', () => {
    expect(normalizeHandleInput('  @lucia')).toBe('lucia');
  });

  test('keeps trailing whitespace — a typed space is shown and refused, never swallowed', () => {
    expect(normalizeHandleInput('lucia ')).toBe('lucia ');
    expect(normalizeHandleInput('  @lucia  ')).toBe('lucia  ');
  });

  test('keeps inner whitespace — it is malformed, not something to guess around', () => {
    expect(normalizeHandleInput('lucia ferri')).toBe('lucia ferri');
  });

  // The field is CONTROLLED: every keystroke's text goes through this and comes back as the
  // value, so the function runs on each prefix, not on the finished word. Trimming the END of a
  // prefix ate the space before the next letter arrived, and `lucia ferri` typed key by key
  // became `luciaferri` — a valid, free handle nobody typed, claimed silently.
  test('typed one key at a time, a space survives to be refused', () => {
    let value = '';
    for (const key of 'lucia ferri') value = normalizeHandleInput(value + key);
    expect(value).toBe('lucia ferri');
    expect(classifyHandle(value)).toBe('malformed');
  });

  test('typed one key at a time, a leading @ and capitals still normalise', () => {
    let value = '';
    for (const key of '@Lucia') value = normalizeHandleInput(value + key);
    expect(value).toBe('lucia');
  });

  test('never invents a name: nothing typed stays nothing', () => {
    expect(normalizeHandleInput('')).toBe('');
    expect(normalizeHandleInput('   ')).toBe('');
    expect(normalizeHandleInput('@')).toBe('');
  });
});

describe('classifyHandle', () => {
  test('empty when nothing is typed', () => {
    expect(classifyHandle('')).toBe('empty');
  });

  test('claimable for an ordinary handle', () => {
    expect(classifyHandle('lucia_ferri')).toBe('claimable');
  });

  test('claimable at both length bounds — 3 and 30', () => {
    expect(classifyHandle('abc')).toBe('claimable');
    expect(classifyHandle('a'.repeat(30))).toBe('claimable');
  });

  test('malformed under 3 characters', () => {
    expect(classifyHandle('ab')).toBe('malformed');
  });

  test('malformed over 30 characters', () => {
    expect(classifyHandle('a'.repeat(31))).toBe('malformed');
  });

  test('malformed with an uppercase letter — the caller normalises, this does not', () => {
    expect(classifyHandle('Lucia')).toBe('malformed');
  });

  test('malformed with a character outside a–z 0–9 _', () => {
    expect(classifyHandle('lucia.ferri')).toBe('malformed');
    expect(classifyHandle('lucia ferri')).toBe('malformed');
    expect(classifyHandle('lucìa')).toBe('malformed');
  });

  test('reserved for a listed word', () => {
    expect(classifyHandle('admin')).toBe('reserved');
    expect(classifyHandle('supporto')).toBe('reserved');
  });

  test('reserved for anything built on the brand — the prefix rule', () => {
    expect(classifyHandle('athanor_support')).toBe('reserved');
  });

  test('a handle that only contains a reserved word is still claimable', () => {
    expect(classifyHandle('admin_luna')).toBe('claimable');
  });

  test('malformed wins over reserved: a shape the column refuses is named as a shape', () => {
    // `Admin` is on the list once lowercased, but as typed it breaks the character rule — the
    // person needs to hear about the capital, not about a word they did not quite type.
    expect(classifyHandle('Admin')).toBe('malformed');
  });

  test('every listed word classifies as reserved', () => {
    for (const reserved of RESERVED_HANDLES) {
      expect(classifyHandle(reserved), reserved).toBe('reserved');
    }
  });
});
