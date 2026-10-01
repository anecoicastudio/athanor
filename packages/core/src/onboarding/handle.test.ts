import { describe, expect, test } from 'vitest';
import { RESERVED_HANDLES } from '@athanor/schemas';
import { classifyHandle, normalizeHandleInput, suggestHandles } from './handle';

/**
 * #782 — the @handle is chosen by the person and never derived from the email. What core says of
 * typed text is whether it can be claimed and if not WHY — a refused handle always says why on
 * screen (#769's lesson). Whether it is already somebody's is a database question, answered by the
 * caller.
 *
 * #908 (Marco's ruling, 2026-10-01) relaxed one half: a handle may be SUGGESTED from the name the
 * person already gave — Apple's, Google's, or the sign-up form's — and never from the email.
 * `suggestHandles` is that half; its tests are at the bottom.
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

describe('suggestHandles', () => {
  test('a first and last name give four candidates, most specific first', () => {
    expect(suggestHandles('Elena Rossi')).toEqual([
      'elena_rossi',
      'elenarossi',
      'elena_r',
      'elena',
    ]);
  });

  test('a single name gives that name once — the joined forms are the same word', () => {
    expect(suggestHandles('Luna')).toEqual(['luna']);
  });

  test('folds diacritics to their base letter instead of dropping the letter', () => {
    expect(suggestHandles('Niccolò Però')).toEqual([
      'niccolo_pero',
      'niccolopero',
      'niccolo_p',
      'niccolo',
    ]);
  });

  test('anything outside a–z 0–9 separates words: apostrophes, hyphens, dots, symbols', () => {
    expect(suggestHandles("Anna-Lisa D'Amico")).toEqual([
      'anna_lisa_d_amico',
      'annalisadamico',
      'anna_a',
      'anna',
    ]);
    expect(suggestHandles('Elena ✦ Rossi')).toEqual(suggestHandles('Elena Rossi'));
    expect(suggestHandles('  Elena   Rossi  ')).toEqual(suggestHandles('Elena Rossi'));
  });

  test('the initial is the LAST word’s, and only exists with two words or more', () => {
    expect(suggestHandles('Maria Luisa Bianchi')).toContain('maria_b');
    expect(suggestHandles('Maria Luisa Bianchi')).not.toContain('maria_l');
    expect(suggestHandles('Maria')).toEqual(['maria']);
  });

  test('keeps digits', () => {
    expect(suggestHandles('Luna 99')).toEqual(['luna_99', 'luna99', 'luna_9', 'luna']);
  });

  test('a candidate too short for the column is left out, the others stay', () => {
    expect(suggestHandles('Al Bo')).toEqual(['al_bo', 'albo', 'al_b']);
    expect(suggestHandles('Al')).toEqual([]);
  });

  test('a candidate over 30 characters is cut to 30', () => {
    const [first] = suggestHandles('Maria Antonietta Guglielmina Francesca');
    expect(first).toBe('maria_antonietta_guglielmina_f');
    expect(first).toHaveLength(30);
  });

  test('a cut that lands on an underscore drops it — a handle does not end on a separator', () => {
    // 10 + 1 + 10 + 1 + 7 = 29 characters, so the 30th is the underscore before `dd`.
    const [first] = suggestHandles('aaaaaaaaaa bbbbbbbbbb ccccccc dd');
    expect(first).toBe('aaaaaaaaaa_bbbbbbbbbb_ccccccc');
  });

  test('every candidate is claimable as it stands', () => {
    for (const name of ['Elena Rossi', 'Al Bo', "Anna-Lisa D'Amico", 'Luna 99', 'X Æ A-12']) {
      for (const candidate of suggestHandles(name)) {
        expect(classifyHandle(candidate), `${name} → ${candidate}`).toBe('claimable');
      }
    }
  });

  test('a reserved word is never suggested', () => {
    expect(suggestHandles('Admin')).toEqual([]);
    expect(suggestHandles('Admin Luna')).toEqual(['admin_luna', 'adminluna', 'admin_l']);
  });

  test('nothing built on the brand is suggested', () => {
    expect(suggestHandles('Athanor Team')).toEqual([]);
  });

  test('never suggests the same handle twice', () => {
    const candidates = suggestHandles('Ab Ab');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  test('no name, no suggestion', () => {
    expect(suggestHandles(null)).toEqual([]);
    expect(suggestHandles(undefined)).toEqual([]);
    expect(suggestHandles('')).toEqual([]);
    expect(suggestHandles('   ')).toEqual([]);
  });

  test('a name with no Latin letter or digit in it gives nothing rather than a guess', () => {
    expect(suggestHandles('李雷')).toEqual([]);
    expect(suggestHandles('✦✦✦')).toEqual([]);
  });

  // The email half of #782 stands. A provider can hand back an address where a name belongs, and
  // a handle built from it would publish the local part — the leak the ruling exists to prevent.
  test('a «name» that is an email address is never turned into a handle', () => {
    expect(suggestHandles('elena.rossi@example.com')).toEqual([]);
    expect(suggestHandles('Elena <elena@example.com>')).toEqual([]);
  });
});
