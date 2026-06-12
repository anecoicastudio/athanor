import { describe, expect, test } from 'vitest';
import en from './catalogs/en.json';
import it from './catalogs/it.json';
import { t } from './t';

describe('catalog parity', () => {
  test('EN mirrors every IT key (IT is canonical)', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(it).sort());
  });
});

describe('t', () => {
  test('returns Italian copy for it locale', () => {
    expect(t('moment.new', 'it')).toBe('Hai un Momento');
  });

  test('returns English copy for en locale', () => {
    expect(t('moment.new', 'en')).toBe('You have a Moment');
  });
});
