import { describe, expect, it } from 'vitest';
import { nameLines, wordLines } from './word-lines';

describe('wordLines — a label never gets a line it could only fill by splitting a word (#754)', () => {
  it('gives a single word one line, so it ellipsizes instead of breaking mid-word', () => {
    expect(wordLines('Notifiche')).toBe(1);
    expect(wordLines('@marco_accardi_the_longest_handle')).toBe(1);
  });

  it('gives two or more words the full allowance', () => {
    expect(wordLines('Impostazioni notifiche')).toBe(2);
    expect(wordLines('Il mio profilo evolutivo')).toBe(2);
    expect(wordLines('a b c d', 3)).toBe(3);
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(wordLines('  Notifiche  ')).toBe(1);
    expect(wordLines('Maria   Rossi')).toBe(2);
  });

  it('never returns 0 — an empty or missing label still owns its one line', () => {
    expect(wordLines('')).toBe(1);
    expect(wordLines('   ')).toBe(1);
    expect(wordLines(undefined)).toBe(1);
    expect(wordLines(null)).toBe(1);
  });

  it('treats a no-break space as part of the word it glues', () => {
    expect(wordLines('Connetti\u00a0✦')).toBe(1);
  });
});

describe('nameLines — the stories row: first name, then the rest (#754)', () => {
  it('splits at the first space', () => {
    expect(nameLines('Maria Rossi')).toEqual(['Maria', 'Rossi']);
    expect(nameLines('Maria De Luca')).toEqual(['Maria', 'De Luca']);
  });

  it('leaves a one-word label on the first line and the second empty', () => {
    expect(nameLines('@luna_dev')).toEqual(['@luna_dev', '']);
    expect(nameLines('Giulietta')).toEqual(['Giulietta', '']);
  });

  it('trims and collapses whitespace so no line starts blank', () => {
    expect(nameLines('  Maria   De  Luca ')).toEqual(['Maria', 'De Luca']);
  });

  it('keeps an empty label empty on both lines', () => {
    expect(nameLines('')).toEqual(['', '']);
  });
});
